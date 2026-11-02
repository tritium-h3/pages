import { describe, it, expect } from 'vitest';
import { analyzeGame } from './replay.js';
import { chooseSpeakers, speakerCount, MAX_SPEAKERS } from './speakers.js';

const RUY = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O'];
const SCHOLAR = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];
/** never fires an ambient speaker; ties break the same way every time */
const quiet = () => 0.99;

describe('speakerCount', () => {
  it('scales with how eventful the move is', () => {
    expect(speakerCount(analyzeGame(RUY), 1)).toBe(2);
    expect(speakerCount(analyzeGame(RUY), 7)).toBe(4);
    expect(speakerCount(analyzeGame(SCHOLAR), 7)).toBe(5);
    expect(speakerCount(analyzeGame(SCHOLAR), 7)).toBeLessThanOrEqual(MAX_SPEAKERS);
  });
});

describe('chooseSpeakers', () => {
  it('puts the mover first, then the captured piece where it died', () => {
    const s = chooseSpeakers(analyzeGame(RUY), 7, new Map(), quiet);
    expect(s[0]).toEqual({ pieceId: 'w-f1', square: 'c6', reason: 'moved' });
    expect(s[1]).toEqual({ pieceId: 'b-b8', square: 'c6', reason: 'captured' });
    expect(s.slice(2).map(x => x.pieceId).sort()).toEqual(['b-b7', 'b-d7']);
  });

  it('gives the checked king a voice', () => {
    const s = chooseSpeakers(analyzeGame(SCHOLAR), 7, new Map(), quiet);
    expect(s).toContainEqual({ pieceId: 'b-e8', square: 'e8', reason: 'check' });
    expect(s).toContainEqual({ pieceId: 'b-f7', square: 'f7', reason: 'captured' });
  });

  it('includes the next mover on a quiet move', () => {
    const s = chooseSpeakers(analyzeGame(RUY), 1, new Map(), quiet);
    expect(s).toEqual([
      { pieceId: 'w-e2', square: 'e4', reason: 'moved' },
      { pieceId: 'b-e7', square: 'e7', reason: 'next' },
    ]);
  });

  it('never returns the same piece twice', () => {
    const a = analyzeGame(SCHOLAR);
    for (let ply = 1; ply <= a.totalPlies; ply++) {
      const ids = chooseSpeakers(a, ply, new Map(), Math.random).map(s => s.pieceId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('lets long-silent pieces speak sometimes', () => {
    const a = analyzeGame(RUY);
    const s = chooseSpeakers(a, 9, new Map(), () => 0);
    expect(s.length).toBe(speakerCount(a, 9));
  });
});
