import type { ReactNode } from 'react';
import type { TrackedPiece } from './track.js';
import { squareCenter } from './placement.js';
import { PIECE_IMAGES } from './pieces/index.js';
import styles from './chess-voices.module.css';

const FILES = 'abcdefgh';

interface BoardProps {
  pieces: Map<string, TrackedPiece>;
  lastMove?: { from: string; to: string };
  /** overlays (bubbles), positioned in board-square units */
  children?: ReactNode;
}

/** Pieces are keyed by identity, so a move is a CSS transform transition. */
export function Board({ pieces, lastMove, children }: BoardProps) {
  const squares: ReactNode[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    for (let f = 0; f < 8; f++) {
      const sq = `${FILES[f]}${rank}`;
      const light = (f + rank) % 2 === 1;
      const moved = lastMove && (sq === lastMove.from || sq === lastMove.to);
      squares.push(
        <div key={sq} className={`${styles.square} ${light ? styles.light : styles.dark} ${moved ? styles.lastMove : ''}`} />,
      );
    }
  }

  return (
    <div className={styles.board}>
      <div className={styles.squares}>{squares}</div>
      {[...pieces.values()].map(p => {
        const { x, y } = squareCenter(p.square);
        return (
          <img
            key={p.id}
            className={styles.piece}
            src={PIECE_IMAGES[p.color + p.type]}
            alt=""
            style={{ transform: `translate(${(x - 0.5) * 100}%, ${(y - 0.5) * 100}%)` }}
          />
        );
      })}
      {children}
    </div>
  );
}
