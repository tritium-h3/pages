import { SECTIONS } from '../manifest.js';
import { REGISTRY } from '../../registry.js';
import { Plate } from './Plate.js';
import styles from './Gallery.module.css';

export function Gallery({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Experiments</h1>
      {SECTIONS.map(section => {
        const entries = REGISTRY.filter(entry => entry.section === section.id);
        if (entries.length === 0) return null;
        return (
          <section key={section.id} className={styles.band} data-section={section.id}>
            <h2 className={styles.sectionTitle}>{section.title}</h2>
            <p className={styles.sectionBlurb}>{section.blurb}</p>
            <div className={styles.grid}>
              {entries.map(entry => (
                <Plate
                  key={entry.id}
                  entry={entry}
                  index={REGISTRY.indexOf(entry)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
