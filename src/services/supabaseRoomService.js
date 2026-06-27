import { createClient } from '@supabase/supabase-js';

let supabaseClient = null;

function getTabClientId() {
  const key = 'guesscue_tab_client_id';
  try {
    let value = window.sessionStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID();
      window.sessionStorage.setItem(key, value);
    }
    return value;
  } catch {
    return 'default';
  }
}

export function isSupabaseConfigured() {
  return import.meta.env.VITE_SUPABASE_ENABLED === 'true'
    && Boolean(import.meta.env.VITE_SUPABASE_URL)
    && Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (supabaseClient) return supabaseClient;
  supabaseClient = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: `guesscue-auth-${getTabClientId()}`
      }
    }
  );
  return supabaseClient;
}

export async function ensureAnonymousUser(playerName = 'Oyuncu') {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData?.session?.user) return sessionData.session.user;

  const { data, error } = await supabase.auth.signInAnonymously({
    options: { data: { name: playerName || 'Oyuncu' } }
  });
  if (error) throw error;
  return data.user;
}

export async function getCurrentUserId() {
  const user = await ensureAnonymousUser();
  return user?.id || '';
}

function normalizeRoomCode(roomCode) {
  return String(roomCode || '').trim().toUpperCase();
}

function defaultRoomState() {
  return {
    phase: 'lobby',
    round: 1,
    turnIndex: 0,
    turnId: 0,
    started: false,
    updatedAt: new Date().toISOString()
  };
}

const ACTIVE_PLAYER_TTL_MS = 35000;

function isActivePlayer(row) {
  if (row.connected === false) return false;
  const stamp = row.last_seen || row.updated_at || row.joined_at;
  if (!stamp) return true;
  return Date.now() - new Date(stamp).getTime() <= ACTIVE_PLAYER_TTL_MS;
}

function mapPlayers(rows = []) {
  return rows.filter(isActivePlayer).reduce((acc, row) => {
    acc[row.user_id] = {
      name: row.name,
      score: row.score,
      currentRound: row.current_round,
      connected: row.connected,
      joinedAt: row.joined_at,
      lastSeen: row.last_seen || row.updated_at || row.joined_at
    };
    return acc;
  }, {});
}


export async function fetchRoom(roomCode) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const normalizedRoomCode = normalizeRoomCode(roomCode);

  const [{ data: room, error: roomError }, { data: players, error: playersError }] = await Promise.all([
    supabase.from('rooms').select('room_code, created_by, settings, state, locked, created_at').eq('room_code', normalizedRoomCode).maybeSingle(),
    supabase.from('room_players').select('user_id, name, score, current_round, connected, joined_at, updated_at, last_seen').eq('room_code', normalizedRoomCode)
  ]);

  if (roomError) throw roomError;
  if (playersError) throw playersError;
  if (!room) return null;

  return {
    roomCode: room.room_code,
    createdBy: room.created_by,
    settings: room.settings,
    state: room.state || defaultRoomState(),
    locked: room.locked,
    createdAt: room.created_at,
    players: mapPlayers(players)
  };
}

export async function createRoom(roomCode, playerName, settings) {
  const supabase = getSupabaseClient();
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const user = await ensureAnonymousUser(playerName);
  const displayName = (playerName || '').trim() || `Oyuncu ${user.id.slice(0, 4).toUpperCase()}`;

  const { data: existing, error: existingError } = await supabase
    .from('rooms')
    .select('room_code')
    .eq('room_code', normalizedRoomCode)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) throw new Error('Bu oda kodu zaten kullanılıyor.');

  const { error: roomError } = await supabase.from('rooms').insert({
    room_code: normalizedRoomCode,
    created_by: user.id,
    settings,
    state: defaultRoomState(),
    locked: false
  });
  if (roomError) throw roomError;

  const { error: playerError } = await supabase.from('room_players').upsert({
    room_code: normalizedRoomCode,
    user_id: user.id,
    name: displayName,
    score: 0,
    current_round: 1,
    connected: true,
    last_seen: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'room_code,user_id' });
  if (playerError) throw playerError;

  const room = await fetchRoom(normalizedRoomCode);
  return { roomCode: normalizedRoomCode, uid: user.id, settings, room };
}

export async function joinRoom(roomCode, playerName) {
  const supabase = getSupabaseClient();
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const user = await ensureAnonymousUser(playerName);

  const room = await fetchRoom(normalizedRoomCode);
  if (!room) throw new Error('Bu oda bulunamadı. Oda kodunu kontrol et.');
  if (room.locked) throw new Error('Bu oda kilitli.');

  const displayName = (playerName || '').trim() || `Oyuncu ${user.id.slice(0, 4).toUpperCase()}`;

  const { error } = await supabase.from('room_players').upsert({
    room_code: normalizedRoomCode,
    user_id: user.id,
    name: displayName,
    score: 0,
    current_round: 1,
    connected: true,
    last_seen: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'room_code,user_id' });
  if (error) throw error;

  const refreshedRoom = await fetchRoom(normalizedRoomCode);
  return { roomCode: normalizedRoomCode, uid: user.id, settings: room.settings, room: refreshedRoom || room };
}

export function subscribeRoom(roomCode, callback) {
  const supabase = getSupabaseClient();
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!supabase || !normalizedRoomCode) return () => {};

  let active = true;

  const refresh = async () => {
    try {
      const room = await fetchRoom(normalizedRoomCode);
      if (active) callback(room);
    } catch (error) {
      console.error('Supabase room refresh failed:', error);
    }
  };

  refresh();

  const channel = supabase
    .channel(`guesscue-room-${normalizedRoomCode}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `room_code=eq.${normalizedRoomCode}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_code=eq.${normalizedRoomCode}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_events', filter: `room_code=eq.${normalizedRoomCode}` }, refresh)
    .subscribe();

  return () => {
    active = false;
    supabase.removeChannel(channel);
  };
}


export async function touchRoomPresence(roomCode, connected = true) {
  const supabase = getSupabaseClient();
  if (!supabase || !roomCode) return;
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const user = await ensureAnonymousUser();
  const { error } = await supabase
    .from('room_players')
    .update({ connected, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('room_code', normalizedRoomCode)
    .eq('user_id', user.id);
  if (error) throw error;
}

export async function leaveRoom(roomCode) {
  try {
    await touchRoomPresence(roomCode, false);
  } catch (error) {
    console.warn('Room leave update failed:', error);
  }
}

export async function updateRoomState(roomCode, patch) {
  const supabase = getSupabaseClient();
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const room = await fetchRoom(normalizedRoomCode);
  if (!room) throw new Error('Oda bulunamadı.');

  const nextState = {
    ...(room.state || defaultRoomState()),
    ...patch,
    updatedAt: new Date().toISOString()
  };

  const { error } = await supabase
    .from('rooms')
    .update({ state: nextState })
    .eq('room_code', normalizedRoomCode);
  if (error) throw error;
  return nextState;
}

export async function startRoomGame(roomCode) {
  return updateRoomState(roomCode, { phase: 'game', round: 1, turnIndex: 0, turnId: 1, started: true });
}

export async function advanceRoomTurn(roomCode, { phase, round, turnIndex }) {
  const room = await fetchRoom(roomCode);
  const currentTurnId = Number(room?.state?.turnId || 1);
  return updateRoomState(roomCode, { phase, round, turnIndex, turnId: currentTurnId + 1, started: true });
}

export async function finishRoomGame(roomCode) {
  return updateRoomState(roomCode, { phase: 'results', started: true });
}

export async function publishGameEvent(roomCode, event) {
  const supabase = getSupabaseClient();
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const user = await ensureAnonymousUser();

  const { data: existingRoom, error: roomLookupError } = await supabase
    .from('rooms')
    .select('room_code')
    .eq('room_code', normalizedRoomCode)
    .maybeSingle();
  if (roomLookupError) throw roomLookupError;
  if (!existingRoom) {
    throw new Error(`Canlı oda bulunamadı: ${normalizedRoomCode}. Oyunu yeniden başlatıp "Oda oluştur" seçeneğiyle yeni oda oluştur.`);
  }

  const { error: eventError } = await supabase.from('room_events').insert({
    room_code: normalizedRoomCode,
    user_id: user.id,
    action: event.action,
    card_id: event.cardId || null,
    delta: event.delta,
    score: event.score,
    round: event.round || 1
  });
  if (eventError) throw eventError;

  if (typeof event.score === 'number') {
    const { error: playerError } = await supabase
      .from('room_players')
      .update({ score: event.score, current_round: event.round || 1, connected: true, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('room_code', normalizedRoomCode)
      .eq('user_id', user.id);
    if (playerError) throw playerError;
  }

  if (event.cardId) {
    const { error: cardError } = await supabase.from('room_used_cards').insert({
      room_code: normalizedRoomCode,
      card_id: event.cardId,
      user_id: user.id
    });
    if (cardError && cardError.code !== '23505') throw cardError;
  }
}
