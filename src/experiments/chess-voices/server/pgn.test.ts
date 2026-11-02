import { describe, it, expect } from 'vitest';
import { sanMoves, isWatchable, toRecord, PgnSplitter, MIN_PLIES } from './pgn.js';

const headers = (over: Record<string, string> = {}) => ({
  Site: 'https://lichess.org/AbCd1234',
  White: 'alice', Black: 'bob',
  WhiteElo: '2100', BlackElo: '1950',
  Result: '1-0', Termination: 'Normal', TimeControl: '300+3',
  Opening: 'Ruy Lopez',
  ...over,
});

describe('sanMoves', () => {
  it('strips numbers, clock comments, marks and the result', () => {
    const text = '1. e4 { [%clk 0:05:00] } 1... e5 { [%eval 0.2] [%clk 0:05:00] } 2. Nf3?! Nc6!! 3. O-O-O+ $1 1-0';
    expect(sanMoves(text)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'O-O-O+']);
  });
});

describe('isWatchable', () => {
  it('accepts a normal, long, rated blitz game between strong players', () => {
    expect(isWatchable(headers(), MIN_PLIES)).toBe(true);
  });

  it.each([
    ['timeouts', { Termination: 'Time forfeit' }],
    ['abandoned games', { Termination: 'Abandoned' }],
    ['bullet', { TimeControl: '60+0' }],
    ['correspondence', { TimeControl: '-' }],
    ['a weak white player', { WhiteElo: '1799' }],
    ['an unrated black player', { BlackElo: '?' }],
    ['unfinished games', { Result: '*' }],
    ['variants', { Variant: 'Chess960' }],
  ])('rejects %s', (_label, over) => {
    expect(isWatchable(headers(over), MIN_PLIES)).toBe(false);
  });

  it('rejects short games', () => {
    expect(isWatchable(headers(), MIN_PLIES - 1)).toBe(false);
  });
});

describe('toRecord', () => {
  it('takes the id from the Site url', () => {
    const movetext = Array.from({ length: 16 }, (_, i) => `${i + 1}. Nf3 Nf6 ${i + 1}... Ng1 Ng8`).join(' ');
    expect(toRecord(headers(), movetext)).toMatchObject({ id: 'AbCd1234', whiteElo: 2100, opening: 'Ruy Lopez' });
  });

  it('returns null for an unwatchable game', () => {
    expect(toRecord(headers(), '1. e4 e5 1-0')).toBeNull();
  });
});

describe('PgnSplitter', () => {
  it('emits each game when the next one starts, and the last at flush', () => {
    const s = new PgnSplitter();
    const out = [
      '[Event "a"]', '[Site "x/1"]', '', '1. e4 e5 1-0', '',
      '[Event "b"]', '[Site "x/2"]', '', '1. d4 d5', '2. c4 0-1', '',
    ].map(l => s.push(l)).filter(Boolean);
    expect(out).toEqual([{ headers: { Event: 'a', Site: 'x/1' }, movetext: '1. e4 e5 1-0' }]);
    expect(s.flush()).toEqual({ headers: { Event: 'b', Site: 'x/2' }, movetext: '1. d4 d5 2. c4 0-1' });
  });
});
