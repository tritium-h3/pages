import styles from './Colophon.module.css';

export function Colophon({ count, onNavigate }: { count: number; onNavigate: (path: string) => void }) {
  return (
    <footer className={styles.colophon}>
      <a
        className={styles.link}
        href="/"
        onClick={event => { event.preventDefault(); onNavigate('/'); }}
      >
        ◇ pages
      </a>
      {` — one of ${count} experiments · `}
      <kbd className={styles.kbd}>esc</kbd>
    </footer>
  );
}
