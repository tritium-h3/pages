import { Chess } from 'chess.js';
import type { Color, PieceType } from './types.js';

/** A piece at one moment. `id` is `<color>-<starting square>` and never changes,
 *  even through promotion, so a piece stays the same character all game. */
export interface TrackedPiece {
  id: string;
  color: Color;
  type: PieceType;
  square: string;
}

export interface TrackedMove {
  /** 1-based */
  ply: number;
  san: string;
  color: Color;
  moverId: string;
  /** the mover's type before the move (a promoting pawn is still 'p' here) */
  moverType: PieceType;
  from: string;
  to: string;
  capturedId?: string;
  capturedType?: PieceType;
  /** differs from `to` only for en passant */
  captureSquare?: string;
  castle?: 'king' | 'queen';
  rookId?: string;
  rookTo?: string;
  promotion?: PieceType;
  check: boolean;
  mate: boolean;
}

export interface Track {
  /** positions[p] = pieces on the board after ply p, keyed by id; positions[0] is the start */
  positions: Map<string, TrackedPiece>[];
  /** moves[p - 1] is ply p */
  moves: TrackedMove[];
  /** fens[p] = FEN after ply p */
  fens: string[];
}

/** Replays SAN moves, following every piece by identity. Throws on an illegal move. */
export function trackGame(sans: string[]): Track {
  const chess = new Chess();
  const at = new Map<string, TrackedPiece>();
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq) at.set(sq.square, { id: `${sq.color}-${sq.square}`, color: sq.color, type: sq.type, square: sq.square });
    }
  }

  // Always in starting order: `at` reshuffles as pieces move, and a reordered
  // list makes React re-insert the moving <img>, which kills its slide.
  const order = [...at.values()].map(p => p.id);
  const snapshot = () => {
    const live = new Map([...at.values()].map(p => [p.id, p]));
    return new Map(order.filter(id => live.has(id)).map(id => [id, { ...live.get(id)! }]));
  };
  const positions = [snapshot()];
  const fens = [chess.fen()];
  const moves: TrackedMove[] = [];

  sans.forEach((san, i) => {
    const m = chess.move(san);
    const mover = at.get(m.from)!;
    const move: TrackedMove = {
      ply: i + 1,
      san: m.san,
      color: m.color,
      moverId: mover.id,
      moverType: mover.type,
      from: m.from,
      to: m.to,
      check: chess.isCheck(),
      mate: chess.isCheckmate(),
    };

    if (m.captured) {
      const captureSquare = m.flags.includes('e') ? m.to[0] + m.from[1] : m.to;
      const victim = at.get(captureSquare)!;
      Object.assign(move, { capturedId: victim.id, capturedType: victim.type, captureSquare });
      at.delete(captureSquare);
    }

    at.delete(m.from);
    mover.square = m.to;
    at.set(m.to, mover);

    if (m.promotion) {
      mover.type = m.promotion;
      move.promotion = m.promotion;
    }

    if (m.flags.includes('k') || m.flags.includes('q')) {
      const kingside = m.flags.includes('k');
      const rank = m.from[1];
      const rookFrom = (kingside ? 'h' : 'a') + rank;
      const rookTo = (kingside ? 'f' : 'd') + rank;
      const rook = at.get(rookFrom)!;
      at.delete(rookFrom);
      rook.square = rookTo;
      at.set(rookTo, rook);
      Object.assign(move, { castle: kingside ? 'king' : 'queen', rookId: rook.id, rookTo });
    }

    moves.push(move);
    positions.push(snapshot());
    fens.push(chess.fen());
  });

  return { positions, moves, fens };
}
