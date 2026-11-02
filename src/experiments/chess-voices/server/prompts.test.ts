import { describe, it, expect } from 'vitest';
import { analyzeGame } from './replay.js';
import {
  lifeStory, cardPrompt, fallbackCard, situationLines, intentionLine, historyLines, thoughtPrompt, cleanThought,
  lengthHint, LENGTH_HINTS, hasSquareNames, scrubSquares,
} from './prompts.js';

const RUY = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O'];
const seeds = { temperament: 'patient', preoccupation: 'fairness', habit: 'is blunt' };

describe('lifeStory', () => {
  it('tells a captured piece its whole arc', () => {
    const a = analyzeGame(RUY);
    const s = lifeStory(a.lives.get('b-b8')!, a.totalPlies);
    expect(s).toContain("move 2: Black's knight moved from b8 to c6.");
    expect(s).toContain('On move 4 it is taken by the white bishop.');
  });

  it('says when a piece never moves and survives', () => {
    const a = analyzeGame(RUY);
    const s = lifeStory(a.lives.get('w-a1')!, a.totalPlies);
    expect(s).toContain('It never moves.');
    expect(s).toContain('still on the board');
  });
});

describe('cardPrompt / fallbackCard', () => {
  it('includes the seeds, the life and the ban list', () => {
    const a = analyzeGame(RUY);
    const p = cardPrompt(a, a.lives.get('w-f1')!, seeds);
    expect(p).toContain('character note');
    expect(p).toContain('Temperament: patient');
    expect(p).toContain('the White bishop that starts on f1');
    expect(p).toContain('grumpy old rook');
  });

  it('asks for a concrete WHO / VOICE / SAMPLES card', () => {
    const a = analyzeGame(RUY);
    const p = cardPrompt(a, a.lives.get('w-f1')!, seeds);
    expect(p).toContain('WHO:');
    expect(p).toContain('VOICE:');
    expect(p).toContain('SAMPLES:');
    expect(p).toMatch(/no square names/i);
    expect(p).toMatch(/at most once/i);
    expect(p).toMatch(/Do not use the words quiet, watchful, wait/);
  });

  it('builds a usable card from the seeds alone', () => {
    const a = analyzeGame(RUY);
    expect(fallbackCard(a.lives.get('w-f1')!, seeds)).toBe(
      'The white bishop from f1: patient, preoccupied with fairness; in its head it is blunt.',
    );
  });
});

describe('situationLines', () => {
  it('tells a captured piece it is done', () => {
    const lines = situationLines(analyzeGame(RUY), 7, 'b-b8');
    expect(lines[1]).toBe('You were just captured by the white bishop. This is your last thought.');
  });

  it('lists attackers and defenders by name', () => {
    const lines = situationLines(analyzeGame(RUY), 7, 'w-f1');
    expect(lines).toContain('You are the piece that just moved.');
    expect(lines.find(l => l.startsWith('You are under attack'))).toMatch(/black pawn, the black pawn/);
  });
});

describe('intentionLine', () => {
  it('frames a nearby move as an intention', () => {
    const a = analyzeGame(RUY);
    expect(intentionLine(a, 6, a.lives.get('w-f1')!)).toBe('You are thinking about taking the black knight on c6 soon.');
    expect(intentionLine(a, 7, a.lives.get('b-d7')!)).toBe('You are thinking about taking the white bishop on c6 soon.');
  });

  it('frames castling from the rook side', () => {
    const a = analyzeGame(RUY);
    expect(intentionLine(a, 8, a.lives.get('w-h1')!)).toBe('You expect to be moved to f1 when your king castles.');
  });

  it('says nothing when the next move is far off or never comes', () => {
    const a = analyzeGame(RUY);
    expect(intentionLine(a, 1, a.lives.get('w-a1')!)).toBe('');
  });

  it('has nothing left for a captured piece', () => {
    const a = analyzeGame(RUY);
    expect(intentionLine(a, 7, a.lives.get('b-b8')!)).toBe('There is nothing left for you to do.');
  });
});

describe('historyLines / thoughtPrompt', () => {
  it('only includes moves up to now', () => {
    const a = analyzeGame(RUY);
    expect(historyLines(a.lives.get('w-f1')!, 6)).toEqual(["Move 3: White's bishop moved from f1 to b5."]);
  });

  it('puts the card in the system prompt and the moment in the user prompt', () => {
    const p = thoughtPrompt({
      label: 'White bishop', card: 'CARD', history: [], recentThoughts: ['one', 'two', 'three', 'four'],
      situation: ['SIT'], intention: 'INTENT', moveNumber: 4, lengthHint: 'One sentence.',
    });
    expect(p.system).toContain('the white bishop');
    expect(p.system).toContain('CARD');
    expect(p.system).toMatch(/at most once/i);
    expect(p.prompt).toContain('Move 4.');
    expect(p.prompt).toContain('Nothing yet.');
    expect(p.prompt).not.toContain('- one');
    expect(p.prompt).toContain('- four');
    expect(p.prompt).toMatch(/must not repeat/);
    expect(p.prompt).toContain('- SIT');
    expect(p.prompt).toContain('INTENT');
    expect(p.prompt).toMatch(/Start from what just happened/);
    expect(p.prompt).toMatch(/One sentence\.$/);
  });

  it('leaves out an empty intention', () => {
    const p = thoughtPrompt({
      label: 'White bishop', card: 'CARD', history: [], recentThoughts: [],
      situation: ['SIT'], intention: '', moveNumber: 4, lengthHint: 'One sentence.',
    });
    expect(p.prompt).not.toMatch(/\n\n\n/);
    expect(p.prompt).not.toMatch(/must not repeat/);
  });
});

describe('lengthHint', () => {
  it('is stable per piece and ply, and drawn from the list', () => {
    expect(lengthHint('w-f1', 7)).toBe(lengthHint('w-f1', 7));
    expect(LENGTH_HINTS).toContain(lengthHint('w-f1', 7));
    const seen = new Set(Array.from({ length: 40 }, (_, i) => lengthHint('b-g8', i + 1)));
    expect(seen.size).toBeGreaterThan(2);
  });
});

describe('hasSquareNames / scrubSquares', () => {
  it.each([
    ['The knight on f6 is watching.', true],
    ["I'm at b2 now.", true],
    ['Nf3 was a mistake.', true],
    ['A pawn, again.', false],
    ['I count to 3 and go.', false],
    ['F3. It should have moved earlier.', true],
    ['E7 is next, but not yet.', true],
  ])('detects squares in %s', (text, leaks) => expect(hasSquareNames(text)).toBe(leaks));

  it.each([
    ['The knight on f6 is watching.', 'The knight is watching.'],
    ['I will go to e6 soon.', 'I will go there soon.'],
    ['The c5 square tastes sweet.', 'That square tastes sweet.'],
    ['I can taste the c5 square.', 'I can taste that square.'],
    ['Nf3 was a mistake.', 'That move was a mistake.'],
    ['The bishop on e7 is yours, and d5 is next.', 'The bishop is yours, and there is next.'],
    ['E7 is next, but not yet.', 'There is next, but not yet.'],
    ['Off to E6 now.', 'Off there now.'],
  ])('scrubs %s', (raw, clean) => {
    expect(scrubSquares(raw)).toBe(clean);
    expect(hasSquareNames(scrubSquares(raw))).toBe(false);
  });
});

describe('cleanThought', () => {
  it.each([
    ['"Someone has to go first."', 'Someone has to go first.'],
    ['White bishop: Someone has to go first.', 'Someone has to go first.'],
    ['**Thought:** Someone\n has to go first.', 'Someone has to go first.'],
    ['<think>hmm</think>\nSomeone has to go first.', 'Someone has to go first.'],
    ['Fine. Someone has to go first.', 'Fine. Someone has to go first.'],
    ["I'm ready. I'm ready. I'm ready. The pressure grows.", "I'm ready. The pressure grows."],
    ["That's not quite it, that's not quite it. The path is too clean.", "That's not quite it. The path is too clean."],
    ['Forward, forward, forward.', 'Forward.'],
    ["The bishop's eye is on me. Again. Again.", "The bishop's eye is on me. Again."],
    ['I moved. What then? The queen watches. What then?', 'I moved. What then? The queen watches.'],
    ['Now the bishop burns. Now the rook holds.', 'Now the bishop burns. Now the rook holds.'],
  ])('%s', (raw, clean) => expect(cleanThought(raw)).toBe(clean));
});
