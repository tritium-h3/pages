import { describe, it, expect } from 'vitest';
import { placeBubbles, estimateSize, squareCenter, tailDots, BOARD_ONLY, type Rect, type Bounds } from './placement.js';

const WIDE: Bounds = { left: -3.5, top: 0, right: 11.5, bottom: 8 };
const text = (n: number) => 'x'.repeat(n);
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inside = (r: Rect, b: Bounds) => r.x >= b.left && r.y >= b.top && r.x + r.w <= b.right && r.y + r.h <= b.bottom;
const place = (squares: string[], len: number, bounds: Bounds) =>
  placeBubbles(squares.map(square => ({ square, ...estimateSize(text(len)) })), bounds);

function expectClean(squares: string[], rects: Rect[]) {
  rects.forEach((r, i) => {
    const c = squareCenter(squares[i]);
    expect(overlap(r, { x: c.x - 0.5, y: c.y - 0.5, w: 1, h: 1 })).toBe(0);
    rects.slice(i + 1).forEach(o => expect(overlap(r, o)).toBe(0));
  });
}

describe('squareCenter', () => {
  it('maps a8 to the top-left and h1 to the bottom-right', () => {
    expect(squareCenter('a8')).toEqual({ x: 0.5, y: 0.5 });
    expect(squareCenter('h1')).toEqual({ x: 7.5, y: 7.5 });
  });
});

describe('placeBubbles', () => {
  it.each([
    ['spread out', ['e4', 'e5', 'f3', 'c6', 'g8', 'd1']],
    ['along one edge', ['a1', 'b1', 'c1', 'd1', 'e1', 'f1']],
    ['clustered, two on one square', ['c6', 'c6', 'd7', 'b7', 'e8', 'd8']],
  ])('six long thoughts %s fit cleanly with side margins', (_l, squares) => {
    const rects = place(squares, 180, WIDE);
    rects.forEach(r => expect(inside(r, WIDE)).toBe(true));
    expectClean(squares, rects);
  });

  it('fits a typical capture cleanly on the board alone', () => {
    const squares = ['c6', 'c6', 'd7', 'b7'];
    const rects = place(squares, 83, BOARD_ONLY);
    rects.forEach(r => expect(inside(r, BOARD_ONLY)).toBe(true));
    expectClean(squares, rects);
  });

  it('stays on the board when crowded, even if bubbles must overlap', () => {
    place(['a1', 'b1', 'c1', 'd1', 'e1', 'f1'], 180, BOARD_ONLY).forEach(r => expect(inside(r, BOARD_ONLY)).toBe(true));
  });
});

describe('tailDots', () => {
  it('runs from the piece toward the bubble', () => {
    const [a, b] = tailDots('a1', { x: 2, y: 3, w: 3, h: 1.5 });
    expect(a.x).toBeGreaterThan(0.5);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeLessThan(a.y);
  });
});
