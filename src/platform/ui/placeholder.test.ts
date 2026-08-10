import { describe, it, expect } from 'vitest';
import { hashId, placeholderStyle } from './placeholder.js';

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
    expect(placeholderStyle('sky').background).toMatch(/^linear-gradient\(/);
  });

  it('is stable for the same id', () => {
    expect(placeholderStyle('sky')).toEqual(placeholderStyle('sky'));
  });

  it('gives every real experiment id a distinct background', () => {
    const backgrounds = ids.map(id => placeholderStyle(id).background);
    expect(new Set(backgrounds).size).toBe(ids.length);
  });
});
