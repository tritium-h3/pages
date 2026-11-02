import type { Analysis } from './replay.js';

export type Reason = 'moved' | 'captured' | 'check' | 'attacked' | 'next' | 'defended' | 'ambient';

const WEIGHT: Record<Reason, number> = {
  moved: 100, captured: 90, check: 70, attacked: 50, next: 40, defended: 25, ambient: 10,
};

export const MAX_SPEAKERS = 6;
/** Chance per ply of silence that an uninvolved piece pipes up, capped. */
const AMBIENT_PER_PLY = 0.01;
const AMBIENT_CAP = 0.15;

export interface Speaker {
  pieceId: string;
  /** where its bubble anchors */
  square: string;
  reason: Reason;
}

/** 2 on a quiet move, more for captures, checks and promotions. */
export function speakerCount(a: Analysis, ply: number): number {
  const m = a.track.moves[ply - 1];
  return Math.min(MAX_SPEAKERS, 2 + (m.capturedId ? 2 : 0) + (m.check ? 1 : 0) + (m.promotion ? 1 : 0));
}

/** Who speaks on this ply, in bubble order: the mover first, then by relevance.
 *  `lastSpoke` maps piece id -> the last ply it spoke on. */
export function chooseSpeakers(
  a: Analysis,
  ply: number,
  lastSpoke: Map<string, number>,
  rand: () => number = Math.random,
): Speaker[] {
  const m = a.track.moves[ply - 1];
  const now = a.track.positions[ply];
  const before = a.relations[ply - 1];
  const after = a.relations[ply];
  const best = new Map<string, Speaker & { score: number }>();

  const offer = (pieceId: string, square: string, reason: Reason) => {
    const score = WEIGHT[reason] + rand();
    const cur = best.get(pieceId);
    if (!cur || score > cur.score) best.set(pieceId, { pieceId, square, reason, score });
  };

  offer(m.moverId, m.to, 'moved');
  if (m.capturedId) offer(m.capturedId, m.captureSquare!, 'captured');

  for (const p of now.values()) {
    if (p.id === m.moverId) continue;
    if (p.type === 'k' && m.check && p.color !== m.color) offer(p.id, p.square, 'check');
    const rel = after.get(p.id)!;
    const prev = before.get(p.id);
    const wasAttacking = new Set(prev?.attackedBy ?? []);
    if (rel.attackedBy.some(id => !wasAttacking.has(id))) offer(p.id, p.square, 'attacked');
    const wasDefending = new Set(prev?.defendedBy ?? []);
    if (rel.defendedBy.some(id => !wasDefending.has(id))) offer(p.id, p.square, 'defended');
    const silent = ply - (lastSpoke.get(p.id) ?? 0);
    if (rand() < Math.min(AMBIENT_CAP, silent * AMBIENT_PER_PLY)) offer(p.id, p.square, 'ambient');
  }

  const next = a.track.moves[ply];
  if (next && next.moverId !== m.moverId && now.has(next.moverId)) {
    offer(next.moverId, now.get(next.moverId)!.square, 'next');
  }

  const ranked = [...best.values()].sort((x, y) => y.score - x.score);
  return ranked.slice(0, speakerCount(a, ply)).map(({ pieceId, square, reason }) => ({ pieceId, square, reason }));
}
