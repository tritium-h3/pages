import type { GameRecord } from '../types.js';

/** Which games from the Lichess dump are worth watching. */
export const MIN_PLIES = 30;
export const MIN_ELO = 1800;
export const MIN_BASE_SECONDS = 180;

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

export function parseHeader(line: string): [string, string] | null {
  const m = /^\[(\w+)\s+"(.*)"\]\s*$/.exec(line);
  return m ? [m[1], m[2]] : null;
}

/** Movetext -> SAN list. Drops {comments} (Lichess clock/eval annotations),
 *  move numbers, NAGs, !?-style marks and the result token. */
export function sanMoves(movetext: string): string[] {
  return movetext
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .split(/\s+/)
    .filter(t => t && !RESULTS.has(t) && !t.startsWith('$'))
    .map(t => t.replace(/[?!]+$/, ''));
}

export function isWatchable(h: Record<string, string>, plies: number): boolean {
  const base = Number.parseInt((h.TimeControl ?? '').split('+')[0], 10);
  return (
    h.Termination === 'Normal' &&
    (h.Variant ?? 'Standard') === 'Standard' &&
    h.Result !== '*' &&
    plies >= MIN_PLIES &&
    Number.isFinite(base) && base >= MIN_BASE_SECONDS &&
    Number(h.WhiteElo) >= MIN_ELO &&
    Number(h.BlackElo) >= MIN_ELO
  );
}

export function toRecord(h: Record<string, string>, movetext: string): GameRecord | null {
  const moves = sanMoves(movetext);
  if (!isWatchable(h, moves.length)) return null;
  return {
    id: (h.Site ?? '').split('/').pop() ?? '',
    white: h.White ?? '?',
    black: h.Black ?? '?',
    whiteElo: Number(h.WhiteElo),
    blackElo: Number(h.BlackElo),
    result: h.Result,
    opening: h.Opening ?? '',
    moves,
  };
}

export interface PgnGame {
  headers: Record<string, string>;
  movetext: string;
}

/** Splits a PGN stream fed line by line. A game is complete when the next
 *  game's first header arrives (or at flush, for the last one). */
export class PgnSplitter {
  private headers: Record<string, string> = {};
  private movetext: string[] = [];

  push(line: string): PgnGame | null {
    const header = parseHeader(line);
    if (header) {
      const done = this.movetext.length ? this.take() : null;
      this.headers[header[0]] = header[1];
      return done;
    }
    if (line.trim()) this.movetext.push(line.trim());
    return null;
  }

  flush(): PgnGame | null {
    return this.movetext.length ? this.take() : null;
  }

  private take(): PgnGame {
    const game = { headers: this.headers, movetext: this.movetext.join(' ') };
    this.headers = {};
    this.movetext = [];
    return game;
  }
}
