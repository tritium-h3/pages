import { useMemo } from 'react';
import type { Thought } from './types.js';
import { placeBubbles, estimateSize, squareCenter, tailDots, type Bounds } from './placement.js';
import styles from './chess-voices.module.css';

const pct = (squares: number) => `${(squares / 8) * 100}%`;

interface BubblesProps {
  /** every thought for the ply, so placement doesn't shift as more appear */
  thoughts: Thought[];
  /** how many are revealed so far */
  shown: number;
  bounds: Bounds;
}

export function Bubbles({ thoughts, shown, bounds }: BubblesProps) {
  const rects = useMemo(
    () => placeBubbles(thoughts.map(t => ({ square: t.square, ...estimateSize(t.label + t.text) })), bounds),
    [thoughts, bounds],
  );

  return (
    <div className={styles.overlay}>
      {thoughts.slice(0, shown).map((t, i) => {
        const r = rects[i];
        const latest = i === shown - 1;
        const dots = tailDots(t.square, r);
        return (
          <div key={`${t.ply}-${t.pieceId}`} className={`${styles.bubbleGroup} ${latest ? '' : styles.dim}`} style={{ zIndex: 10 + i }}>
            {dots.map((d, j) => (
              <span key={j} className={`${styles.dot} ${j === 0 ? styles.dotSmall : ''}`} style={{ left: pct(d.x), top: pct(d.y) }} />
            ))}
            <div className={styles.bubble} style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w) }}>
              <div className={styles.bubbleLabel}>{t.label}</div>
              {t.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The small "…" over the next mover while its thoughts are still coming. */
export function WaitingBubble({ square }: { square: string }) {
  const c = squareCenter(square);
  return (
    <div className={styles.overlay}>
      <div className={styles.waiting} style={{ left: pct(Math.min(c.x + 0.2, 7.1)), top: pct(Math.max(c.y - 1.1, 0)) }}>
        …
      </div>
    </div>
  );
}
