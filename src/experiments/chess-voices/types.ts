/** Shared between the chess-voices server and page. */

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

/** One line of data/chess-voices/games.jsonl. */
export interface GameRecord {
  id: string;
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  result: string;
  opening: string;
  /** SAN, one entry per ply */
  moves: string[];
}

/** Everything the page needs up front. The result is held back until `done`. */
export interface GameInfo {
  session: string;
  id: string;
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  opening: string;
  moves: string[];
}

export interface Thought {
  /** 1-based; ply 1 is White's first move */
  ply: number;
  pieceId: string;
  /** where the bubble anchors — a captured piece anchors where it died */
  square: string;
  color: Color;
  pieceType: PieceType;
  label: string;
  text: string;
}

export type ChessVoicesEvent =
  | ({ type: 'game' } & GameInfo)
  | ({ type: 'thought' } & Thought)
  | { type: 'ply-ready'; ply: number }
  | { type: 'done'; result: string }
  | { type: 'error'; message: string };
