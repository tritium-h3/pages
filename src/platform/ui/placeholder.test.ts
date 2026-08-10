import { describe, it, expect } from 'vitest';
import { hashId, placeholderStyle, primaryHue } from './placeholder.js';

describe('hashId', () => {
  it('is deterministic', () => {
    expect(hashId('sky')).toBe(hashId('sky'));
  });

  it('differs between ids', () => {
    expect(hashId('sky')).not.toBe(hashId('todo'));
  });

  it('returns a non-negative 32-bit integer', () => {
    for (const id of ['sky', 'todo', 'colony', 'a', '']) {
      const h = hashId(id);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe('placeholderStyle', () => {
  const ids = ['sky', 'todo', 'colony', 'weather', 'transit', 'sprites', 'wikistory', 'image-hunt', 'llm-duo-chat'];

  it('produces a css gradient background', () => {
    expect(placeholderStyle('sky', 0).background).toMatch(/^linear-gradient\(/);
  });

  it('is stable for the same id', () => {
    expect(placeholderStyle('sky', 0)).toEqual(placeholderStyle('sky', 0));
  });

  it('gives every real experiment id a distinct background', () => {
    const backgrounds = ids.map((id, i) => placeholderStyle(id, i).background);
    expect(new Set(backgrounds).size).toBe(ids.length);
  });

  it('keeps every pair of cards at least 15 degrees apart in hue', () => {
    const hues = ids.map((_, i) => primaryHue(i));
    for (let a = 0; a < hues.length; a++) {
      for (let b = a + 1; b < hues.length; b++) {
        const raw = Math.abs(hues[a] - hues[b]);
        const circular = Math.min(raw, 360 - raw);
        expect(circular).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('separates hues regardless of how many cards there are', () => {
    for (const count of [3, 6, 12, 20]) {
      const hues = Array.from({ length: count }, (_, i) => primaryHue(i));
      expect(new Set(hues).size).toBe(count);
    }
  });
});
