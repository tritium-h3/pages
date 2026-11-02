import { Chess } from 'chess.js';
import { trackGame, type Track, type TrackedMove, type TrackedPiece } from '../track.js';
import type { Color, PieceType } from '../types.js';

export const PIECE_NAMES: Record<PieceType, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};

export const sideName = (c: Color) => (c === 'w' ? 'White' : 'Black');
export const pieceLabel = (c: Color, t: PieceType) => `${sideName(c)} ${PIECE_NAMES[t]}`;

export type Ending =
  | { kind: 'captured'; ply: number; byId: string; byType: PieceType }
  | { kind: 'checkmated'; ply: number }
  | { kind: 'gave-mate'; ply: number }
  | { kind: 'survived' };

/** A piece's whole game, computed up front. */
export interface Life {
  id: string;
  color: Color;
  startType: PieceType;
  startSquare: string;
  /** its own moves, including being moved as the rook in a castle */
  moves: TrackedMove[];
  captures: TrackedMove[];
  checksGiven: number;
  /** most plies between its own moves (from the start, and up to its end) */
  longestIdle: number;
  promotedTo?: PieceType;
  ending: Ending;
}

export interface Relations {
  attackedBy: string[];
  defendedBy: string[];
  defends: string[];
}

export interface Analysis {
  track: Track;
  totalPlies: number;
  lives: Map<string, Life>;
  /** relations[p].get(id): who attacks and defends each piece after ply p */
  relations: Map<string, Relations>[];
}

/** "White's bishop took Black's knight on c6, giving check." */
export function describeMove(m: TrackedMove): string {
  const side = sideName(m.color);
  const other = sideName(m.color === 'w' ? 'b' : 'w');
  let s: string;
  if (m.castle) {
    s = `${side} castled ${m.castle}side, the king to ${m.to} and the rook to ${m.rookTo}`;
  } else if (m.capturedType) {
    const ep = m.captureSquare !== m.to ? ' en passant' : '';
    s = `${side}'s ${PIECE_NAMES[m.moverType]} took ${other}'s ${PIECE_NAMES[m.capturedType]} on ${m.captureSquare}${ep}`;
  } else {
    s = `${side}'s ${PIECE_NAMES[m.moverType]} moved from ${m.from} to ${m.to}`;
  }
  if (m.promotion) s += ` and became a ${PIECE_NAMES[m.promotion]}`;
  if (m.mate) s += ', checkmate';
  else if (m.check) s += ', giving check';
  return `${s}.`;
}

function relationsAt(fen: string, pieces: Map<string, TrackedPiece>): Map<string, Relations> {
  const chess = new Chess(fen);
  const idAt = new Map([...pieces.values()].map(p => [p.square, p.id]));
  const ids = (squares: string[]) => squares.map(sq => idAt.get(sq)!).filter(Boolean);

  const out = new Map<string, Relations>();
  for (const p of pieces.values()) out.set(p.id, { attackedBy: [], defendedBy: [], defends: [] });
  for (const p of pieces.values()) {
    const enemy: Color = p.color === 'w' ? 'b' : 'w';
    const rel = out.get(p.id)!;
    rel.attackedBy = ids(chess.attackers(p.square as never, enemy));
    rel.defendedBy = ids(chess.attackers(p.square as never, p.color));
    for (const d of rel.defendedBy) out.get(d)!.defends.push(p.id);
  }
  return out;
}

function lifeOf(piece: TrackedPiece, track: Track): Life {
  const total = track.moves.length;
  const moves = track.moves.filter(m => m.moverId === piece.id || m.rookId === piece.id);
  const own = moves.filter(m => m.moverId === piece.id);
  const promotion = own.find(m => m.promotion);
  const last = track.moves.at(-1);

  let ending: Ending = { kind: 'survived' };
  const death = track.moves.find(m => m.capturedId === piece.id);
  if (death) {
    ending = { kind: 'captured', ply: death.ply, byId: death.moverId, byType: death.moverType };
  } else if (last?.mate && piece.type === 'k' && piece.color !== last.color) {
    ending = { kind: 'checkmated', ply: last.ply };
  } else if (last?.mate && last.moverId === piece.id) {
    ending = { kind: 'gave-mate', ply: last.ply };
  }

  const endPly = ending.kind === 'captured' ? ending.ply : total;
  const marks = [0, ...moves.map(m => m.ply), endPly];
  let longestIdle = 0;
  for (let i = 1; i < marks.length; i++) longestIdle = Math.max(longestIdle, marks[i] - marks[i - 1]);

  return {
    id: piece.id,
    color: piece.color,
    startType: piece.type,
    startSquare: piece.square,
    moves,
    captures: own.filter(m => m.capturedId),
    checksGiven: own.filter(m => m.check).length,
    longestIdle,
    promotedTo: promotion?.promotion,
    ending,
  };
}

/** Everything the generator needs about a game, computed once. Throws on an illegal move. */
export function analyzeGame(sans: string[]): Analysis {
  const track = trackGame(sans);
  const lives = new Map([...track.positions[0].values()].map(p => [p.id, lifeOf(p, track)]));
  const relations = track.positions.map((pieces, i) => relationsAt(track.fens[i], pieces));
  return { track, totalPlies: track.moves.length, lives, relations };
}
