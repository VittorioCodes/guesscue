import { useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/layout/Header.jsx';
import GameCard from './components/game/GameCard.jsx';
import Timer from './components/game/Timer.jsx';
import ActionButtons from './components/game/ActionButtons.jsx';
import ScoreBoard from './components/game/ScoreBoard.jsx';
import { CATEGORIES } from './constants/categories.js';
import { LANGUAGES } from './constants/languages.js';
import { SCORING } from './constants/scoring.js';
import { loadCards, loadCategoryCounts } from './logic/cardLoader.js';
import { seededShuffle } from './logic/seededShuffle.js';
import { createRoomCode } from './logic/roomCode.js';
import {
  advanceRoomTurn,
  createRoom,
  finishRoomGame,
  getCurrentUserId,
  isSupabaseConfigured,
  joinRoom,
  leaveRoom,
  publishGameEvent,
  startRoomGame,
  subscribeRoom,
  touchRoomPresence,
  updateRoomState
} from './services/supabaseRoomService.js';
import { loadPreferences, savePreferences } from './services/localStorageService.js';

const DEFAULT_SETTINGS = {
  playMode: 'remote',
  language: 'tr',
  category: 'movie-series',
  roundDuration: 60,
  roundsMode: 'preset',
  rounds: 6,
  customRounds: 6,
  passEnabled: true,
  passMode: 'auto',
  customPassesPerRound: 3,
  seed: '',
  teamCount: 2,
  playerName: '',
  liveEnabled: false,
  liveAction: 'create',
  roomCode: ''
};

function getPlayerName(settings) {
  return (settings.playerName || '').trim() || 'Oyuncu';
}

function createTeams(settings) {
  if (settings.playMode === 'remote') {
    return [{ id: 'player', name: getPlayerName(settings), score: 0 }];
  }
  return Array.from({ length: Number(settings.teamCount || 2) }, (_, index) => ({
    id: `team-${index + 1}`,
    name: `Takım ${index + 1}`,
    score: 0
  }));
}

function passesPerRound(settings) {
  if (!settings.passEnabled) return 0;
  if (settings.passMode === 'unlimited') return Infinity;
  return Number(settings.customPassesPerRound || 3);
}

function maxRounds(settings) {
  if (settings.roundsMode === 'infinite') return Infinity;
  if (settings.roundsMode === 'custom') return Number(settings.customRounds || 1);
  return Number(settings.rounds || 6);
}

function sortPlayersForTurns(players) {
  return [...players].sort((a, b) => {
    const dateCompare = String(a.joinedAt || '').localeCompare(String(b.joinedAt || ''));
    if (dateCompare !== 0) return dateCompare;
    return a.name.localeCompare(b.name, 'tr');
  });
}

export default function App() {
  const [theme, setTheme] = useState(() => loadPreferences().theme || 'light');
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...loadPreferences().settings }));
  const [screen, setScreen] = useState('setup');
  const [cards, setCards] = useState([]);
  const [deck, setDeck] = useState([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [teams, setTeams] = useState([]);
  const [activeTeamIndex, setActiveTeamIndex] = useState(0);
  const [round, setRound] = useState(1);
  const [roundStats, setRoundStats] = useState({ correct: 0, taboo: 0, pass: 0 });
  const [passLeft, setPassLeft] = useState(3);
  const [timerKey, setTimerKey] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [roomStatus, setRoomStatus] = useState('');
  const [liveRoomData, setLiveRoomData] = useState(null);
  const [currentUserId, setCurrentUserId] = useState('');
  const [categoryCounts, setCategoryCounts] = useState({});
  const lastLiveTurnKey = useRef('');
  const lastAutoAdvanceKey = useRef('');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    savePreferences({ theme, settings });
  }, [theme, settings]);

  useEffect(() => {
    let active = true;
    loadCategoryCounts(settings.language)
      .then((counts) => { if (active) setCategoryCounts(counts); })
      .catch((err) => console.warn('Kategori kart sayıları yüklenemedi:', err));
    return () => { active = false; };
  }, [settings.language]);

  useEffect(() => {
    if (!settings.roomCode || !isSupabaseConfigured()) return undefined;
    return subscribeRoom(settings.roomCode, setLiveRoomData);
  }, [settings.roomCode]);

  useEffect(() => {
    if (!settings.liveEnabled || !settings.roomCode || !currentUserId || !isSupabaseConfigured()) return undefined;
    let active = true;
    const beat = () => {
      if (!active) return;
      touchRoomPresence(settings.roomCode, true).catch((err) => console.warn('Presence heartbeat failed:', err));
    };
    beat();
    const interval = window.setInterval(beat, 10000);
    const handleBeforeUnload = () => {
      active = false;
      leaveRoom(settings.roomCode);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [settings.liveEnabled, settings.roomCode, currentUserId]);

  const currentCard = deck[cardIndex % Math.max(deck.length, 1)];
  const category = CATEGORIES.find((item) => item.id === settings.category);
  const totalRounds = maxRounds(settings);
  const liveConfigured = isSupabaseConfigured();
  const liveState = liveRoomData?.state || { phase: 'lobby', round: 1, turnIndex: 0, turnId: 0 };

  const livePlayers = useMemo(() => {
    if (!liveRoomData?.players) return [];
    return Object.entries(liveRoomData.players)
      .map(([id, player]) => ({
        id,
        name: player.name || 'Oyuncu',
        score: Number(player.score || 0),
        currentRound: Number(player.currentRound || 1),
        connected: player.connected,
        joinedAt: player.joinedAt
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'tr'));
  }, [liveRoomData]);

  const liveTurnPlayers = useMemo(() => sortPlayersForTurns(livePlayers), [livePlayers]);
  const activeLivePlayer = liveTurnPlayers[liveTurnPlayers.length ? Number(liveState.turnIndex || 0) % liveTurnPlayers.length : 0];
  const isLiveMode = settings.liveEnabled && settings.roomCode && liveRoomData;
  const isHost = Boolean(isLiveMode && currentUserId && liveRoomData?.createdBy === currentUserId);
  const isMyLiveTurn = Boolean(isLiveMode && activeLivePlayer?.id === currentUserId);
  const canAdvanceLiveTurn = Boolean(isLiveMode && (isHost || isMyLiveTurn));
  const liveSelf = livePlayers.find((player) => player.id === currentUserId);
  const displayedScoreRows = settings.liveEnabled && livePlayers.length > 0 ? livePlayers : teams;

  const setupValid = useMemo(() => settings.language === 'tr' && settings.category, [settings.language, settings.category]);

  useEffect(() => {
    if (!isLiveMode || cards.length === 0) return;
    const nextRound = Number(liveState.round || 1);
    const nextTurnIndex = Number(liveState.turnIndex || 0);
    setRound(nextRound);
    setActiveTeamIndex(nextTurnIndex);

    if (liveState.phase === 'lobby') {
      setRunning(false);
      setScreen('lobby');
      return;
    }

    if (liveState.phase === 'results') {
      setRunning(false);
      setScreen('results');
      return;
    }

    if (liveState.phase === 'summary') {
      setRunning(false);
      setScreen('round-summary');
      return;
    }

    if (liveState.phase === 'game') {
      const key = `${liveState.round}-${liveState.turnIndex}-${liveState.turnId}-${activeLivePlayer?.id || 'none'}`;
      if (lastLiveTurnKey.current !== key) {
        lastLiveTurnKey.current = key;
        setRoundStats({ correct: 0, taboo: 0, pass: 0 });
        setPassLeft(passesPerRound(settings));
        setTimerKey((value) => value + 1);
      }
      setRunning(isMyLiveTurn);
      setScreen('game');
    }
  }, [isLiveMode, cards.length, liveState.phase, liveState.round, liveState.turnIndex, liveState.turnId, isMyLiveTurn, settings, activeLivePlayer?.id]);

  useEffect(() => {
    if (!isLiveMode || !isHost) return;
    if (!['game', 'summary'].includes(liveState.phase)) return;
    if (liveTurnPlayers.length === 0) return;
    const normalizedTurnIndex = Number(liveState.turnIndex || 0) % liveTurnPlayers.length;
    if (normalizedTurnIndex === Number(liveState.turnIndex || 0)) return;
    const key = `${liveState.phase}-${liveState.round}-${liveState.turnIndex}-${liveTurnPlayers.length}`;
    if (lastAutoAdvanceKey.current === key) return;
    lastAutoAdvanceKey.current = key;
    advanceRoomTurn(settings.roomCode, {
      phase: liveState.phase,
      round: Number(liveState.round || 1),
      turnIndex: normalizedTurnIndex
    }).catch((err) => console.warn('Disconnected turn normalization failed:', err));
  }, [isLiveMode, isHost, liveState.phase, liveState.round, liveState.turnIndex, liveTurnPlayers.length, settings.roomCode]);

  function updateSettings(patch) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  async function setupLiveRoom(nextSettings) {
    if (!nextSettings.liveEnabled) return nextSettings;
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase yapılandırması eksik. .env.local dosyasını doldurup VITE_SUPABASE_ENABLED=true yapmalısın.');
    }

    const normalizedAction = nextSettings.liveAction === 'join' ? 'join' : 'create';
    const playerName = getPlayerName(nextSettings);

    if (normalizedAction === 'create') {
      const code = (nextSettings.roomCode || createRoomCode()).trim().toUpperCase();
      const roomSettings = {
        ...nextSettings,
        playerName,
        liveEnabled: true,
        liveAction: 'create',
        roomCode: code
      };
      const result = await createRoom(code, playerName, roomSettings);
      setCurrentUserId(result.uid || await getCurrentUserId());
      if (result.room) setLiveRoomData(result.room);
      setRoomStatus(`Oda oluşturuldu: ${result.roomCode}. Oyuncular katılınca lobiden oyunu başlatabilirsin.`);
      return { ...roomSettings, roomCode: result.roomCode };
    }

    if (!nextSettings.roomCode) throw new Error('Odaya katılmak için oda kodu gerekli.');
    const result = await joinRoom(nextSettings.roomCode, playerName);
    setCurrentUserId(result.uid || await getCurrentUserId());
    if (result.room) setLiveRoomData(result.room);
    const hostSettings = result.settings || {};
    const syncedSettings = {
      ...nextSettings,
      ...hostSettings,
      playerName,
      liveEnabled: true,
      liveAction: 'join',
      roomCode: result.roomCode
    };
    setRoomStatus(`Odaya katıldın: ${result.roomCode}. Oyun ayarları oda kurucusundan alındı.`);
    return syncedSettings;
  }

  async function prepareGameData(nextSettings) {
    const loaded = await loadCards(nextSettings.language, nextSettings.category);
    const seed = `${nextSettings.seed || nextSettings.roomCode || crypto.randomUUID()}-${nextSettings.playMode}-${nextSettings.playerName || 'anon'}`;
    const shuffled = seededShuffle(loaded, seed);
    setCards(loaded);
    setDeck(shuffled);
    setCardIndex(0);
    setTeams(createTeams(nextSettings));
    setActiveTeamIndex(0);
    setRound(1);
    setRoundStats({ correct: 0, taboo: 0, pass: 0 });
    setPassLeft(passesPerRound(nextSettings));
    setTimerKey((value) => value + 1);
  }

  async function startGame() {
    setError('');
    try {
      const nextSettings = await setupLiveRoom(settings);
      setSettings(nextSettings);
      await prepareGameData(nextSettings);
      if (nextSettings.liveEnabled) {
        setRunning(false);
        setScreen('lobby');
      } else {
        setRunning(true);
        setScreen('game');
      }
    } catch (err) {
      console.error('Start game failed:', err);
      setError(err.message || 'Oyun başlatılamadı.');
    }
  }

  async function beginLiveGame() {
    setError('');
    try {
      if (livePlayers.length < 1) throw new Error('Oyunu başlatmak için en az bir oyuncu odada görünmeli.');
      await startRoomGame(settings.roomCode);
    } catch (err) {
      console.error('Live game start failed:', err);
      setError(err.message || 'Canlı oyun başlatılamadı.');
    }
  }

  async function recordAction(action) {
    const delta = SCORING[action];
    if (isLiveMode && !isMyLiveTurn) return;
    if (action === 'pass' && passLeft <= 0) return;
    if (action === 'pass' && passLeft !== Infinity) setPassLeft((value) => value - 1);
    setRoundStats((stats) => ({ ...stats, [action]: stats[action] + 1 }));

    let nextScore = 0;
    if (isLiveMode) {
      nextScore = Number(liveSelf?.score || 0) + delta;
    } else {
      const currentScore = teams[activeTeamIndex]?.score || 0;
      nextScore = currentScore + delta;
      setTeams((current) => current.map((team, index) => index === activeTeamIndex ? { ...team, score: nextScore } : team));
    }

    if (settings.liveEnabled && settings.roomCode && isSupabaseConfigured()) {
      try {
        await publishGameEvent(settings.roomCode, { action, cardId: currentCard?.id, delta, score: nextScore, round });
      } catch (err) {
        console.error('Live score event publish failed:', err);
        setError(err.message || 'Canlı skor güncellenemedi.');
      }
    }
    setCardIndex((value) => value + 1);
  }

  async function finishRound() {
    setRunning(false);
    if (isLiveMode) {
      await updateRoomState(settings.roomCode, { phase: 'summary' });
      return;
    }
    setScreen('round-summary');
  }

  async function nextRound() {
    if (isLiveMode) {
      if (!canAdvanceLiveTurn) return;
      const playerCount = Math.max(liveTurnPlayers.length, 1);
      const currentTurnIndex = Number(liveState.turnIndex || 0);
      const nextTurnIndex = (currentTurnIndex + 1) % playerCount;
      const completedCycle = nextTurnIndex === 0;
      const nextRoundNumber = completedCycle ? Number(liveState.round || round) + 1 : Number(liveState.round || round);
      if (nextRoundNumber > totalRounds) {
        await finishRoomGame(settings.roomCode);
        return;
      }
      await advanceRoomTurn(settings.roomCode, { phase: 'game', round: nextRoundNumber, turnIndex: nextTurnIndex });
      return;
    }

    const nextTeamIndex = (activeTeamIndex + 1) % teams.length;
    const completedCycle = nextTeamIndex === 0;
    const nextRoundNumber = completedCycle ? round + 1 : round;
    if (nextRoundNumber > totalRounds) {
      setScreen('results');
      return;
    }
    setActiveTeamIndex(nextTeamIndex);
    setRound(nextRoundNumber);
    setRoundStats({ correct: 0, taboo: 0, pass: 0 });
    setPassLeft(passesPerRound(settings));
    setTimerKey((value) => value + 1);
    setRunning(true);
    setScreen('game');
  }

  async function endGameNow() {
    setRunning(false);
    if (isLiveMode) {
      await finishRoomGame(settings.roomCode);
      return;
    }
    setScreen('results');
  }

  function copyResult() {
    const rows = displayedScoreRows.length ? displayedScoreRows : teams;
    const text = [`Guesscue sonucu`, ...rows.map((team) => `${team.name}: ${team.score}`), `Kategori: ${category?.label || ''}`].join('\n');
    navigator.clipboard?.writeText(text);
  }

  function resetToSetup() {
    if (settings.liveEnabled && settings.roomCode) {
      leaveRoom(settings.roomCode);
    }
    setRunning(false);
    setScreen('setup');
    setLiveRoomData(null);
    setRoomStatus('');
    setError('');
    updateSettings({ liveEnabled: false, roomCode: '', liveAction: 'create' });
  }

  const narratorName = isLiveMode ? activeLivePlayer?.name : teams[activeTeamIndex]?.name;

  return (
    <main className="app-shell">
      <Header theme={theme} onThemeToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />

      {screen === 'setup' && (
        <section className="setup-grid">
          <div className="panel hero-panel">
            <p className="eyebrow">setup</p>
            <h2>Oyunu kur</h2>
            <p>Önce cihaz düzenini, sonra kategori ve tur ayarlarını seç. Canlı oda açılırsa oyun önce lobiye alınır.</p>
            {roomStatus && <p className="success-note">{roomStatus}</p>}
            {error && <p className="error-note">{error}</p>}
          </div>

          <div className="panel">
            <h3>Nasıl oynayacaksınız?</h3>
            <div className="choice-row">
              <button className={settings.playMode === 'remote' ? 'choice selected' : 'choice'} onClick={() => updateSettings({ playMode: 'remote' })}>Herkes kendi cihazından</button>
              <button className={settings.playMode === 'shared' ? 'choice selected' : 'choice'} onClick={() => updateSettings({ playMode: 'shared' })}>Herkes aynı cihazdan</button>
            </div>
            {settings.playMode === 'shared' && (
              <label className="field">Takım sayısı
                <input type="number" min="2" max="8" value={settings.teamCount} onChange={(event) => updateSettings({ teamCount: event.target.value })} />
              </label>
            )}
            <label className="field">Oyuncu adı
              <input value={settings.playerName} onChange={(event) => updateSettings({ playerName: event.target.value })} placeholder="Örn. Vittorio" />
            </label>
          </div>

          <div className="panel">
            <h3>Dil</h3>
            <div className="choice-row wrap">
              {LANGUAGES.map((lang) => <button key={lang.id} disabled={!lang.enabled} className={settings.language === lang.id ? 'choice selected' : 'choice'} onClick={() => updateSettings({ language: lang.id })}>{lang.label} {lang.note ? `· ${lang.note}` : ''}</button>)}
            </div>
          </div>

          <div className="panel wide">
            <h3>Kategori</h3>
            <div className="category-grid">
              {CATEGORIES.map((item) => (
                <button key={item.id} className={settings.category === item.id ? 'category-card selected' : 'category-card'} onClick={() => updateSettings({ category: item.id })}>
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                  <em>{categoryCounts[item.id] ?? '...'} kart</em>
                </button>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3>Tur</h3>
            <label className="field">Tur süresi
              <select value={settings.roundDuration} onChange={(event) => updateSettings({ roundDuration: Number(event.target.value) })}>
                <option value="30">30 saniye</option><option value="45">45 saniye</option><option value="60">60 saniye</option><option value="90">90 saniye</option>
              </select>
            </label>
            <label className="field">Tur sayısı
              <select value={settings.roundsMode} onChange={(event) => updateSettings({ roundsMode: event.target.value })}>
                <option value="preset">Preset</option><option value="custom">Custom</option><option value="infinite">Sınırsız</option>
              </select>
            </label>
            {settings.roundsMode === 'preset' && <select value={settings.rounds} onChange={(event) => updateSettings({ rounds: Number(event.target.value) })}><option>4</option><option>6</option><option>8</option><option>10</option><option>12</option></select>}
            {settings.roundsMode === 'custom' && <input type="number" min="1" max="99" value={settings.customRounds} onChange={(event) => updateSettings({ customRounds: event.target.value })} />}
          </div>

          <div className="panel">
            <h3>Pas ve puanlama</h3>
            <label className="check"><input type="checkbox" checked={settings.passEnabled} onChange={(event) => updateSettings({ passEnabled: event.target.checked })} /> Pas hakkı aktif</label>
            <label className="field">Pas modu
              <select value={settings.passMode} onChange={(event) => updateSettings({ passMode: event.target.value })} disabled={!settings.passEnabled}>
                <option value="auto">Tur başı 3 pas</option><option value="custom">Custom</option><option value="unlimited">Sınırsız</option>
              </select>
            </label>
            {settings.passMode === 'custom' && <input type="number" min="0" max="20" value={settings.customPassesPerRound} onChange={(event) => updateSettings({ customPassesPerRound: event.target.value })} />}
            <p className="small-note">Doğru +1 · Tabu -1 · Pas 0</p>
          </div>

          <div className="panel">
            <h3>Oyun kodu ve canlı oda</h3>
            <label className="field">Seed / oyun kodu
              <input value={settings.seed} onChange={(event) => updateSettings({ seed: event.target.value })} placeholder="Boş kalırsa rastgele" />
            </label>
            <label className="check"><input type="checkbox" checked={settings.liveEnabled} onChange={(event) => updateSettings({ liveEnabled: event.target.checked, liveAction: event.target.checked ? (settings.liveAction === 'off' ? 'create' : settings.liveAction) : 'off' })} /> Supabase canlı oda</label>
            {settings.liveEnabled && (
              <>
                <p className="small-note">Supabase durumu: {liveConfigured ? 'hazır' : 'env eksik'}</p>
                <p className="small-note">Canlı odada ayarlar kurucudan alınır; oyun lobiden başlatılır ve herkes sırayla anlatır.</p>
                <select value={settings.liveAction} onChange={(event) => updateSettings({ liveAction: event.target.value })}>
                  <option value="create">Oda oluştur</option><option value="join">Odaya katıl</option>
                </select>
                <input value={settings.roomCode} onChange={(event) => updateSettings({ roomCode: event.target.value.toUpperCase() })} placeholder="Oda kodu" />
              </>
            )}
          </div>

          <button className="start-button" disabled={!setupValid} onClick={startGame}>{settings.liveEnabled ? 'Lobiye geç' : 'Oyunu Başlat'}</button>
        </section>
      )}

      {screen === 'lobby' && (
        <section className="game-layout">
          <div className="panel summary-panel">
            <p className="eyebrow">Canlı lobi</p>
            <h2>Oda {settings.roomCode}</h2>
            <p>Oyuncular hazır olduğunda kurucu oyunu başlatır. Oyun başladıktan sonra her turda herkes sırayla anlatıcı olur.</p>
            {error && <p className="error-note">{error}</p>}
            <div className="live-players">
              <p className="small-note">Odadaki oyuncular</p>
              {liveTurnPlayers.length === 0 && <span>Aktif oyuncu bekleniyor...</span>}
              {liveTurnPlayers.map((player, index) => <span key={player.id}>{index + 1}. {player.name}: {player.score}</span>)}
            </div>
            {isHost ? <button className="start-button" onClick={beginLiveGame}>Oyunu başlat</button> : <p className="success-note">Kurucunun oyunu başlatması bekleniyor.</p>}
            <button className="ghost-button" onClick={resetToSetup}>Ana sayfaya dön</button>
          </div>
          <ScoreBoard teams={displayedScoreRows} activeTeamIndex={-1} liveRoom={settings.roomCode} />
        </section>
      )}

      {screen === 'game' && (
        <section className="game-layout">
          <div className="game-main">
            <div className="round-bar">
              <div><p className="eyebrow">{narratorName}</p><h2>Tur {round}{totalRounds !== Infinity ? ` / ${totalRounds}` : ''}</h2></div>
              {(!isLiveMode || isMyLiveTurn) ? <Timer seconds={settings.roundDuration} running={running} onFinish={finishRound} resetKey={timerKey} /> : <strong className="timer-display">Bekliyor</strong>}
            </div>
            {isLiveMode && !isMyLiveTurn ? (
              <div className="panel waiting-panel">
                <p className="eyebrow">Tahmin sırası sende</p>
                <h2>{activeLivePlayer?.name || 'Sıradaki oyuncu'} anlatıyor</h2>
                <p>Bu turda kart ve yasaklı kelimeler sadece anlatıcıda görünür. Tur bitince özet ekranı herkese gelir.</p>
              </div>
            ) : (
              <>
                <GameCard card={currentCard} />
                <ActionButtons onCorrect={() => recordAction('correct')} onTaboo={() => recordAction('taboo')} onPass={() => recordAction('pass')} passDisabled={!settings.passEnabled || passLeft <= 0} />
                <div className="game-footer"><span>Pas: {passLeft === Infinity ? 'Sınırsız' : passLeft}</span><button className="ghost-button" onClick={endGameNow}>Oyunu bitir</button></div>
              </>
            )}
          </div>
          <ScoreBoard teams={displayedScoreRows} activeTeamIndex={settings.liveEnabled && livePlayers.length > 0 ? -1 : activeTeamIndex} liveRoom={settings.liveEnabled ? settings.roomCode : ''} />
        </section>
      )}

      {screen === 'round-summary' && (
        <section className="panel summary-panel">
          <p className="eyebrow">Tur özeti</p>
          <h2>{isLiveMode ? `${activeLivePlayer?.name || 'Oyuncu'} anlattı` : teams[activeTeamIndex]?.name}</h2>
          <div className="summary-grid"><span>Doğru: {isMyLiveTurn || !isLiveMode ? roundStats.correct : '-'}</span><span>Tabu: {isMyLiveTurn || !isLiveMode ? roundStats.taboo : '-'}</span><span>Pas: {isMyLiveTurn || !isLiveMode ? roundStats.pass : '-'}</span></div>
          {settings.liveEnabled && livePlayers.length > 0 && (
            <div className="live-players">
              <p className="small-note">Odadaki oyuncular</p>
              {livePlayers.map((player) => <span key={player.id}>{player.name}: {player.score}</span>)}
            </div>
          )}
          {isLiveMode && !canAdvanceLiveTurn ? <p className="success-note">Sıradaki tura geçmek için oda kurucusu veya anlatıcının devam etmesi bekleniyor.</p> : <button className="start-button" onClick={nextRound}>Sıradaki tur</button>}
        </section>
      )}

      {screen === 'results' && (
        <section className="panel summary-panel">
          <p className="eyebrow">Oyun bitti</p>
          <h2>Sonuçlar</h2>
          <ScoreBoard teams={displayedScoreRows} activeTeamIndex={-1} liveRoom={settings.liveEnabled ? settings.roomCode : ''} />
          {liveRoomData?.players && <p className="small-note">Canlı odada {Object.keys(liveRoomData.players).length} oyuncu görünüyor.</p>}
          <div className="choice-row"><button className="start-button" onClick={copyResult}>Sonucu kopyala</button><button className="ghost-button" onClick={resetToSetup}>Yeni oyun</button></div>
        </section>
      )}
    </main>
  );
}
