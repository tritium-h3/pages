import { pieceLabel, type Analysis, type Life } from './replay.js';
import { chooseSpeakers } from './speakers.js';
import { drawSeeds } from './seeds.js';
import {
  cardPrompt, fallbackCard, situationLines, intentionLine, historyLines, thoughtPrompt, cleanThought,
  lengthHint, hasSquareNames, scrubSquares, type LlmRequest,
} from './prompts.js';
import type { ChessVoicesEvent } from '../types.js';

/** One completion. The server wires this to Ollama; tests pass a fake. */
export type Llm = (request: LlmRequest, temperature: number, signal: AbortSignal) => Promise<string>;

const SQUARE_RETRY = '\n\nYour last attempt named a square or used chess notation. Write the thought again without any.';

/** How many plies generation may run ahead of what the page has played. */
export const LOOKAHEAD = 4;
/** Consecutive plies with no successful thought before giving up. */
export const MAX_FAILED_PLIES = 3;
const CARD_TEMPERATURE = 0.9;
const THOUGHT_TEMPERATURE = 0.8;

/** The page's playback position, which generation waits on. */
export class Progress {
  private played = 0;
  private waiters: Array<{ ply: number; resolve: () => void }> = [];

  set(ply: number): void {
    this.played = Math.max(this.played, ply);
    this.waiters = this.waiters.filter(w => {
      if (w.ply > this.played) return true;
      w.resolve();
      return false;
    });
  }

  /** Resolves once the page has played `ply`, or on abort. */
  until(ply: number, signal: AbortSignal): Promise<void> {
    if (ply <= this.played || signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      this.waiters.push({ ply, resolve });
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }
}

export interface RunOptions {
  analysis: Analysis;
  result: string;
  llm: Llm;
  emit: (event: ChessVoicesEvent) => void;
  progress: Progress;
  signal: AbortSignal;
  rand?: () => number;
  log?: (message: string, err?: unknown) => void;
}

/** Generates the whole game's thoughts in order, emitting as it goes. Returns
 *  quietly on abort; emits `error` and returns if the model keeps failing. */
export async function runGame(o: RunOptions): Promise<void> {
  const a = o.analysis;
  const rand = o.rand ?? Math.random;
  const log = o.log ?? ((msg, err) => console.warn(`[chess-voices] ${msg}`, err ?? ''));
  const cards = new Map<string, string>();
  const said = new Map<string, string[]>();
  const lastSpoke = new Map<string, number>();
  let failedPlies = 0;

  const writeCard = async (life: Life): Promise<string> => {
    const seeds = drawSeeds(rand);
    try {
      const card = (await o.llm({ prompt: cardPrompt(a, life, seeds) }, CARD_TEMPERATURE, o.signal)).trim();
      if (card) return card;
    } catch (err) {
      if (o.signal.aborted) throw err;
      log(`card for ${life.id} failed; using fallback`, err);
    }
    return fallbackCard(life, seeds);
  };

  for (let ply = 1; ply <= a.totalPlies; ply++) {
    await o.progress.until(ply - LOOKAHEAD, o.signal);
    if (o.signal.aborted) return;

    let spoke = 0;
    for (const s of chooseSpeakers(a, ply, lastSpoke, rand)) {
      const life = a.lives.get(s.pieceId)!;
      // a piece captured this ply is no longer on the board; use how it looked just before
      const piece = a.track.positions[ply].get(s.pieceId) ?? a.track.positions[ply - 1].get(s.pieceId)!;
      try {
        if (!cards.has(s.pieceId)) cards.set(s.pieceId, await writeCard(life));
        const label = pieceLabel(piece.color, piece.type);
        const request = thoughtPrompt({
          label,
          card: cards.get(s.pieceId)!,
          history: historyLines(life, ply),
          recentThoughts: said.get(s.pieceId) ?? [],
          situation: situationLines(a, ply, s.pieceId),
          intention: intentionLine(a, ply, life),
          moveNumber: Math.ceil(ply / 2),
          lengthHint: lengthHint(s.pieceId, ply),
        });
        let text = cleanThought(await o.llm(request, THOUGHT_TEMPERATURE, o.signal));
        // pieces shouldn't think in coordinates: one retry, then a mechanical rewrite
        if (hasSquareNames(text)) {
          const retry = { ...request, prompt: request.prompt + SQUARE_RETRY };
          const again = cleanThought(await o.llm(retry, THOUGHT_TEMPERATURE, o.signal));
          text = scrubSquares(again || text);
        }
        if (!text) throw new Error('empty thought');
        o.emit({ type: 'thought', ply, pieceId: s.pieceId, square: s.square, color: piece.color, pieceType: piece.type, label, text });
        said.set(s.pieceId, [...(said.get(s.pieceId) ?? []), text]);
        lastSpoke.set(s.pieceId, ply);
        spoke++;
      } catch (err) {
        if (o.signal.aborted) return;
        log(`thought for ${s.pieceId} on ply ${ply} failed`, err);
      }
    }

    failedPlies = spoke === 0 ? failedPlies + 1 : 0;
    if (failedPlies >= MAX_FAILED_PLIES) {
      o.emit({ type: 'error', message: 'The pieces have gone quiet — the model keeps failing.' });
      return;
    }
    o.emit({ type: 'ply-ready', ply });
  }
  o.emit({ type: 'done', result: o.result });
}
