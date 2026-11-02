import { describe, it, expect } from 'vitest';
import { analyzeGame } from './replay.js';
import { runGame, Progress, LOOKAHEAD, MAX_FAILED_PLIES, type Llm } from './generator.js';
import type { ChessVoicesEvent } from '../types.js';

const SCHOLAR = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];
const isCard = (prompt: string) => prompt.includes('character note');
const fakeLlm: Llm = async ({ prompt }) => (isCard(prompt) ? 'A careful piece.' : '"I see it."');
const flush = () => new Promise(r => setTimeout(r, 0));

function setup(llm: Llm = fakeLlm, played = 1000) {
  const events: ChessVoicesEvent[] = [];
  const progress = new Progress();
  progress.set(played);
  const abort = new AbortController();
  const run = runGame({
    analysis: analyzeGame(SCHOLAR), result: '1-0', llm, progress, signal: abort.signal,
    emit: e => events.push(e), rand: () => 0.99, log: () => {},
  });
  return { events, progress, abort, run };
}

const readyPlies = (events: ChessVoicesEvent[]) =>
  events.flatMap(e => (e.type === 'ply-ready' ? [e.ply] : []));

describe('runGame', () => {
  it('emits cleaned thoughts, a ready marker per ply, then done', async () => {
    const { events, run } = setup();
    await run;
    expect(readyPlies(events)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(events.at(-1)).toEqual({ type: 'done', result: '1-0' });
    const first = events[0];
    expect(first).toMatchObject({ type: 'thought', ply: 1, pieceId: 'w-e2', square: 'e4', label: 'White pawn', text: 'I see it.' });
  });

  it('labels a captured piece as it was', async () => {
    const { events, run } = setup();
    await run;
    expect(events).toContainEqual(expect.objectContaining({ type: 'thought', ply: 7, pieceId: 'b-f7', label: 'Black pawn', square: 'f7' }));
  });

  it(`stays at most ${LOOKAHEAD} plies ahead of playback`, async () => {
    const { events, progress, abort } = setup(fakeLlm, 0);
    await flush(); await flush();
    expect(readyPlies(events).at(-1)).toBe(LOOKAHEAD);
    progress.set(1);
    await flush(); await flush();
    expect(readyPlies(events).at(-1)).toBe(LOOKAHEAD + 1);
    abort.abort();
  });

  it('falls back to a seed-only card when the card call fails', async () => {
    const systems: string[] = [];
    const llm: Llm = async ({ system, prompt }) => {
      if (system) systems.push(system);
      if (isCard(prompt)) throw new Error('boom');
      return 'Still here.';
    };
    const { events, run } = setup(llm);
    await run;
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(systems[0]).toMatch(/preoccupied with/);
  });

  it(`gives up after ${MAX_FAILED_PLIES} plies with no thoughts`, async () => {
    const llm: Llm = async ({ prompt }) => {
      if (isCard(prompt)) return 'card';
      throw new Error('down');
    };
    const { events, run } = setup(llm);
    await run;
    // failed plies still play (silently) until the limit is hit
    expect(readyPlies(events)).toEqual([1, 2]);
    expect(events.some(e => e.type === 'thought')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });

  it('regenerates a thought that names a square, then scrubs if it still does', async () => {
    const asked: string[] = [];
    const llm: Llm = async ({ prompt }) => {
      if (isCard(prompt)) return 'card';
      asked.push(prompt);
      return 'The knight on f6 is watching.';
    };
    const { events, run } = setup(llm);
    await run;
    const first = events.find(e => e.type === 'thought');
    expect(first).toMatchObject({ text: 'The knight is watching.' });
    expect(asked[1]).toMatch(/named a square/);
  });

  it('keeps the regenerated thought when it comes back clean', async () => {
    let n = 0;
    const llm: Llm = async ({ prompt }) => {
      if (isCard(prompt)) return 'card';
      return n++ % 2 === 0 ? 'Off to e6 I go.' : 'Off I go.';
    };
    const { events, run } = setup(llm);
    await run;
    expect(events.find(e => e.type === 'thought')).toMatchObject({ text: 'Off I go.' });
  });

  it('stops quietly on abort', async () => {
    const { events, progress, abort, run } = setup(fakeLlm, 0);
    await flush();
    abort.abort();
    progress.set(1000);
    await run;
    expect(events.some(e => e.type === 'done' || e.type === 'error')).toBe(false);
  });
});
