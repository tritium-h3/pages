import { describe, it, expect } from 'vitest';
import { rgbToLab } from './color.js';
import { nearestPantone, titleCase } from './pantone.js';

describe('titleCase', () => {
  it('humanises kebab-case Pantone slugs', () => {
    expect(titleCase('flame-scarlet')).toBe('Flame Scarlet');
    expect(titleCase('woodsmoke')).toBe('Woodsmoke');
    expect(titleCase('blanc-de-blanc')).toBe('Blanc De Blanc');
  });
});

describe('nearestPantone', () => {
  it('returns the exact chip at ~zero distance when given its own hex', () => {
    // 17-1462 "flame" = #f2552c
    const m = nearestPantone(rgbToLab(0xf2, 0x55, 0x2c));
    expect(m.code).toBe('17-1462');
    expect(m.name).toBe('Flame');
    expect(m.hex).toBe('#f2552c');
    expect(m.deltaE).toBeCloseTo(0, 4);
  });

  it('returns a display-ready title-cased name', () => {
    const m = nearestPantone(rgbToLab(0xf3, 0xec, 0xe0)); // egret
    expect(m.name).toBe('Egret');
  });

  it('always finds some chip within a small distance (2310-chip table is dense)', () => {
    const m = nearestPantone(rgbToLab(120, 140, 180));
    expect(m.deltaE).toBeLessThan(5);
  });

  it('emits hex with a leading hash', () => {
    expect(nearestPantone(rgbToLab(10, 10, 10)).hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});
