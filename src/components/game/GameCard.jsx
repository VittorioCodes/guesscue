export default function GameCard({ card }) {
  if (!card) return <div className="game-card">Kart yükleniyor...</div>;
  return (
    <section className="game-card" aria-live="polite">
      <p className="eyebrow">Anlatılacak</p>
      <h2>{card.answer}</h2>
      <div className="forbidden-list">
        {card.forbidden.map((word) => <span className="chip" key={word}>{word}</span>)}
      </div>
      <p className="card-meta">{card.type} · nişlik {card.difficulty}/5</p>
    </section>
  );
}
