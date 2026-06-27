export default function Header({ theme, onThemeToggle }) {
  return (
    <header className="app-header">
      <div>
        <p className="eyebrow">tabu ruhunda, modern kelime oyunu</p>
        <h1>Guesscue</h1>
      </div>
      <button className="ghost-button" onClick={onThemeToggle} type="button">
        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
      </button>
    </header>
  );
}
