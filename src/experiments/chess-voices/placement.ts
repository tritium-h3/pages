/** Where thought bubbles go. All units are board squares: x 0..8 left to right
 *  (file a..h), y 0..8 top to bottom (rank 8..1), so the page can turn them
 *  into percentages of the board. */

export interface Rect { x: number; y: number; w: number; h: number }
/** The area bubbles may occupy, in board squares; wider than the board when
 *  the page has room beside it. */
export interface Bounds { left: number; top: number; right: number; bottom: number }
export const BOARD_ONLY: Bounds = { left: 0, top: 0, right: 8, bottom: 8 };
export interface Point { x: number; y: number }

export const BUBBLE_WIDTH = 3.2;
const CHARS_PER_LINE = 26;
const LINE_HEIGHT = 0.36;
const PADDING = 0.6; // label + inner padding

export function squareCenter(square: string): Point {
  return { x: square.charCodeAt(0) - 97 + 0.5, y: 8 - Number(square[1]) + 0.5 };
}

/** Rough size, good enough to keep bubbles apart; the real height is CSS's. */
export function estimateSize(text: string): { w: number; h: number } {
  return { w: BUBBLE_WIDTH, h: PADDING + Math.ceil(text.length / CHARS_PER_LINE) * LINE_HEIGHT };
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const squareRect = (p: Point): Rect => ({ x: p.x - 0.5, y: p.y - 0.5, w: 1, h: 1 });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const centerOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

const STEP = 0.25;

/** Every position inside the bounds on a quarter-square grid. */
function candidates(w: number, h: number, b: Bounds): Rect[] {
  const out: Rect[] = [];
  for (let x = b.left; x <= b.right - w + 1e-9; x += STEP) {
    for (let y = b.top; y <= b.bottom - h + 1e-9; y += STEP) out.push({ x, y, w, h });
  }
  return out;
}

/** Places bubbles in order, each avoiding earlier ones and every speaker's
 *  square, staying inside the bounds and leaning toward the board's middle.
 *  When there isn't room, overlap is minimized rather than avoided — the page
 *  draws newer bubbles on top. */
export function placeBubbles(
  items: Array<{ square: string; w: number; h: number }>,
  bounds: Bounds = BOARD_ONLY,
): Rect[] {
  const anchors = items.map(i => squareCenter(i.square));
  const placed: Rect[] = [];
  const middle = { x: 4, y: 4 };
  items.forEach((item, i) => {
    let best: Rect | null = null;
    let bestScore = Infinity;
    for (const r of candidates(item.w, item.h, bounds)) {
      const hits = placed.reduce((s, p) => s + overlap(r, p), 0);
      const covers = anchors.reduce((s, a) => s + overlap(r, squareRect(a)), 0);
      const score = hits * 100 + covers * 30 + dist(centerOf(r), anchors[i]) + dist(centerOf(r), middle) * 0.3;
      if (score < bestScore) { bestScore = score; best = r; }
    }
    placed.push(best!);
  });
  return placed;
}

/** Two trailing-dot positions from the piece toward the bubble's nearest edge. */
export function tailDots(square: string, r: Rect): [Point, Point] {
  const c = squareCenter(square);
  const near = { x: clamp(c.x, r.x, r.x + r.w), y: clamp(c.y, r.y, r.y + r.h) };
  const at = (t: number) => ({ x: c.x + (near.x - c.x) * t, y: c.y + (near.y - c.y) * t });
  return [at(0.4), at(0.72)];
}
