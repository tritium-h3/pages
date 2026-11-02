import { describeMove, pieceLabel, sideName, PIECE_NAMES, type Analysis, type Life } from './replay.js';
import type { Seeds } from './seeds.js';

/** Plies more than this far away aren't "intentions" yet. */
export const INTENTION_HORIZON = 8;
const MAX_HISTORY = 8;
const MAX_RECENT_THOUGHTS = 3;
const MAX_LISTED_MOVES = 12;

const moveNo = (ply: number) => Math.ceil(ply / 2);

/** The piece's whole game in plain English, for the voice card. */
export function lifeStory(life: Life, totalPlies: number): string {
  const lines: string[] = [];
  const own = life.moves;
  if (own.length === 0) {
    lines.push('It never moves.');
  } else {
    const listed = own.slice(0, MAX_LISTED_MOVES).map(m => `move ${moveNo(m.ply)}: ${describeMove(m)}`);
    lines.push(`It moves ${own.length} time${own.length === 1 ? '' : 's'}:`, ...listed.map(l => `  - ${l}`));
    if (own.length > MAX_LISTED_MOVES) lines.push(`  - …and ${own.length - MAX_LISTED_MOVES} more.`);
  }
  if (life.checksGiven) lines.push(`It gives check ${life.checksGiven} time${life.checksGiven === 1 ? '' : 's'}.`);
  lines.push(`Its longest wait without moving is about ${Math.ceil(life.longestIdle / 2)} moves.`);
  if (life.promotedTo) lines.push(`It reaches the far side of the board and becomes a ${PIECE_NAMES[life.promotedTo]}.`);
  const e = life.ending;
  if (e.kind === 'captured') lines.push(`On move ${moveNo(e.ply)} it is taken by the ${pieceLabel(life.color === 'w' ? 'b' : 'w', e.byType).toLowerCase()}.`);
  if (e.kind === 'checkmated') lines.push(`On move ${moveNo(e.ply)} it is checkmated, and the game ends.`);
  if (e.kind === 'gave-mate') lines.push(`On move ${moveNo(e.ply)} it delivers checkmate, ending the game.`);
  if (e.kind === 'survived') lines.push(`It is still on the board when the game ends after ${moveNo(totalPlies)} moves.`);
  return lines.join('\n');
}

export function cardPrompt(a: Analysis, life: Life, seeds: Seeds): string {
  return `Write a private character note inventing the inner voice of a chess piece, for a story where the pieces have private inner lives.

The piece: the ${pieceLabel(life.color, life.startType)} that starts on ${life.startSquare}.

Its whole game, which it does not know in advance:
${lifeStory(life, a.totalPlies)}

Build the character around these three traits, and make them concrete:
- Temperament: ${seeds.temperament}
- Preoccupation: ${seeds.preoccupation}
- How its inner speech sounds: ${seeds.habit}

Write exactly this and nothing else:
WHO: one or two sentences. A specific individual with one concrete, slightly odd detail about how it sees things.
VOICE: one or two sentences of concrete rules for how its thoughts sound: sentence length, pet words or turns of phrase, what it would never say. If it has a pet phrase, it uses it at most once per thought.
SAMPLES:
- three short example thoughts in its own voice, about things that have nothing to do with this game, so they show the voice and not the plot. No square names or chess notation.

Avoid stock types (the grumpy old rook, the noble knight, the doomed pawn, the scheming queen, the proud king), literary or poetic narration, medieval or theatrical language, and puns. Do not use the words quiet, watchful, wait, stillness, shadow or weight.`;
}

/** Used when the model can't write a card, so the piece can still speak. */
export function fallbackCard(life: Life, seeds: Seeds): string {
  return `The ${pieceLabel(life.color, life.startType).toLowerCase()} from ${life.startSquare}: ${seeds.temperament}, preoccupied with ${seeds.preoccupation}; in its head it ${seeds.habit}.`;
}

const who = (a: Analysis, ply: number, ids: string[]) =>
  ids
    .map(id => a.track.positions[ply].get(id))
    .filter(p => p !== undefined)
    .map(p => `the ${pieceLabel(p.color, p.type).toLowerCase()}`)
    .join(', ');

/** What this piece can perceive right now. */
export function situationLines(a: Analysis, ply: number, pieceId: string): string[] {
  const m = a.track.moves[ply - 1];
  const lines = [`What just happened: ${describeMove(m)}`];
  if (m.capturedId === pieceId) {
    lines.push(`You were just captured by the ${pieceLabel(m.color, m.moverType).toLowerCase()}. This is your last thought.`);
    return lines;
  }
  if (m.moverId === pieceId) lines.push('You are the piece that just moved.');
  const me = a.track.positions[ply].get(pieceId)!;
  const rel = a.relations[ply].get(pieceId)!;
  lines.push(rel.attackedBy.length ? `You are under attack from ${who(a, ply, rel.attackedBy)}.` : 'Nothing is attacking you.');
  if (rel.defendedBy.length) lines.push(`You are protected by ${who(a, ply, rel.defendedBy)}.`);
  if (rel.defends.length) lines.push(`You are protecting ${who(a, ply, rel.defends)}.`);
  if (me.type === 'k' && m.check && me.color !== m.color) lines.push(m.mate ? 'You are checkmated.' : 'You are in check.');
  return lines;
}

/** The piece's next move as an intention — never its fate. Empty when the
 *  next move is far off: saying so only prompted "I wait" filler. */
export function intentionLine(a: Analysis, ply: number, life: Life): string {
  if (a.track.moves[ply - 1].capturedId === life.id) return 'There is nothing left for you to do.';
  const next = life.moves.find(m => m.ply > ply);
  if (!next || next.ply - ply > INTENTION_HORIZON) return '';
  if (next.rookId === life.id) return `You expect to be moved to ${next.rookTo} when your king castles.`;
  if (next.capturedType) {
    const other = sideName(life.color === 'w' ? 'b' : 'w').toLowerCase();
    return `You are thinking about taking the ${other} ${PIECE_NAMES[next.capturedType]} on ${next.captureSquare} soon.`;
  }
  return `You are thinking about moving to ${next.to} soon.`;
}

export function historyLines(life: Life, ply: number): string[] {
  return life.moves
    .filter(m => m.ply <= ply)
    .slice(-MAX_HISTORY)
    .map(m => `Move ${moveNo(m.ply)}: ${describeMove(m)}`);
}

/** Varied shapes, so thoughts don't all fall into the same three beats. */
export const LENGTH_HINTS = [
  'One sentence.',
  'Two sentences.',
  'A fragment, under ten words.',
  'Up to three short sentences.',
  'One sentence.',
];

/** Stable per piece and ply, so a replayed game asks for the same shapes. */
export function lengthHint(pieceId: string, ply: number): string {
  const h = [...`${pieceId}${ply}`].reduce((acc, ch) => (Math.imul(acc, 31) + ch.charCodeAt(0)) | 0, 7) >>> 0;
  return LENGTH_HINTS[h % LENGTH_HINTS.length];
}

export interface ThoughtInput {
  label: string;
  card: string;
  history: string[];
  recentThoughts: string[];
  situation: string[];
  /** empty when there's nothing to intend */
  intention: string;
  moveNumber: number;
  lengthHint: string;
}

export interface LlmRequest {
  system?: string;
  prompt: string;
}

/** The card is the persona (system); the moment is the request. */
export function thoughtPrompt(t: ThoughtInput): LlmRequest {
  const bullets = (xs: string[], empty: string) => (xs.length ? xs.map(x => `- ${x}`).join('\n') : `- ${empty}`);
  const recent = t.recentThoughts.slice(-MAX_RECENT_THOUGHTS);
  const parts = [
    `Move ${t.moveNumber}.`,
    `What you have done so far:\n${bullets(t.history, 'Nothing yet. You are where you started.')}`,
    `Right now:\n${bullets(t.situation, '')}`,
  ];
  if (t.intention) parts.push(t.intention);
  if (recent.length) parts.push(`Your recent thoughts, whose images and phrasing you must not repeat:\n${bullets(recent, '')}`);
  parts.push(`Start from what just happened, from your own angle, and think one thought about whatever this particular character would fixate on: the move, a neighbour, a grudge, a small detail. ${t.lengthHint}`);

  return {
    system: `You voice the private thoughts of one chess piece, the ${t.label.toLowerCase()}. Stay strictly in this character:

${t.card}

Rules: the thought is overheard inner speech, first person, in this character's voice. It is not narration and not a summary of the position. Use any pet phrase at most once. No chess notation or square names, no quotation marks, no labels, no stage directions.`,
    prompt: parts.join('\n\n'),
  };
}

// either case: models capitalize a square that starts a sentence ("E7 is next")
const SQUARE = '[a-hA-H][1-8]';

/** Square names or piece notation, which pieces shouldn't think in. */
export function hasSquareNames(text: string): boolean {
  return new RegExp(`\\b${SQUARE}\\b|\\b[NBRQK]x?${SQUARE}\\b`).test(text);
}

/** Last-resort rewrite when a regenerated thought still names squares. */
export function scrubSquares(text: string): string {
  return text
    .replace(new RegExp(`\\b[NBRQK]x?${SQUARE}\\b`, 'g'), 'that move')
    .replace(new RegExp(`\\b(T|t)he ${SQUARE} square\\b`, 'g'), (_m, t: string) => (t === 'T' ? 'That square' : 'that square'))
    .replace(new RegExp(` (on|at) ${SQUARE}\\b`, 'g'), '')
    .replace(new RegExp(`\\b(to|towards|into) ${SQUARE}\\b`, 'g'), 'there')
    .replace(new RegExp(`\\b${SQUARE}\\b`, 'g'), 'there')
    .replace(/^that move/, 'That move')
    .replace(/^there/, 'There')
    .replace(/\s+([.,!?;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, '').trim();

/** qwen hammers pet phrases however it's asked ("I'm ready. I'm ready. I'm
 *  ready."), so: drop a clause that repeats the one before it, and a sentence
 *  that repeats an earlier one. */
function collapseRepeats(text: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const end = /[.!?…]+$/.exec(sentence)?.[0] ?? '';
    const clauses = sentence.slice(0, sentence.length - end.length).split(/,\s*/);
    const body = clauses.filter((c, i) => i === 0 || normalize(c) !== normalize(clauses[i - 1])).join(', ');
    const key = normalize(body);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(body + end);
  }
  return out.join(' ');
}

/** Strips the things models add despite being asked not to. */
export function cleanThought(raw: string): string {
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
    .replace(/^\*{0,2}[A-Za-z' ]{1,30}:\*{0,2}\s+/, '')
    .replace(/^["“”']+|["“”']+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return collapseRepeats(text);
}
