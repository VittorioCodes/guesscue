export default function ActionButtons({ onCorrect, onTaboo, onPass, passDisabled }) {
  return (
    <div className="action-grid">
      <button className="action correct" onClick={onCorrect} type="button">Doğru +1</button>
      <button className="action taboo" onClick={onTaboo} type="button">Tabu -1</button>
      <button className="action pass" onClick={onPass} disabled={passDisabled} type="button">Pas</button>
    </div>
  );
}
