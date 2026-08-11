import type { MouseEvent } from 'react';
import type { RegistryEntry } from '../../registry.js';
import { placeholderStyle } from './placeholder.js';
import styles from './Plate.module.css';

interface PlateProps {
  entry: RegistryEntry;
  /** position in REGISTRY — sets the placeholder hue, so it must be the
   *  gallery-wide index, not the index within a section */
  index: number;
  onNavigate: (path: string) => void;
}

export function Plate({ entry, index, onNavigate }: PlateProps) {
  const art = entry.art
    ? { backgroundImage: `url(${entry.art})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : placeholderStyle(entry.id, index);

  const handleClick = (event: MouseEvent) => {
    if (entry.external) return;          // let the browser follow the href
    event.preventDefault();
    onNavigate(entry.route);
  };

  return (
    <a
      className={styles.plate}
      href={entry.external ?? entry.route}
      onClick={handleClick}
      {...(entry.external ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      <div className={styles.art} style={art} />
      <div className={styles.caption}>
        <span className={styles.title}>
          {entry.title}
          {entry.external && <span className={styles.mark} aria-label="external"> ↗</span>}
        </span>
        <span className={styles.blurb}>{entry.blurb}</span>
      </div>
    </a>
  );
}
