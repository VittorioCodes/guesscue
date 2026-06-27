export default function ScoreBoard({ teams, activeTeamIndex, liveRoom }) {
  return (
    <aside className="score-card">
      <h3>Skor</h3>
      <div className="score-list">
        {teams.map((team, index) => (
          <div className={index === activeTeamIndex ? 'score-row active' : 'score-row'} key={team.id}>
            <span>{team.name}</span>
            <strong>{team.score}</strong>
          </div>
        ))}
      </div>
      {liveRoom && <p className="small-note">Live Room: {liveRoom}</p>}
    </aside>
  );
}
