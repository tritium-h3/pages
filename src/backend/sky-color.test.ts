import { describe, it, expect } from 'vitest';
import { rgbToLab, deltaE2000 } from './sky-color.js';

describe('rgbToLab', () => {
  it('maps pure white to L=100, a=0, b=0', () => {
    const [L, a, b] = rgbToLab(255, 255, 255);
    expect(L).toBeCloseTo(100, 1);
    expect(a).toBeCloseTo(0, 1);
    expect(b).toBeCloseTo(0, 1);
  });

  it('maps pure black to L=0', () => {
    const [L] = rgbToLab(0, 0, 0);
    expect(L).toBeCloseTo(0, 1);
  });

  it('maps mid grey to L~53.6 with no chroma', () => {
    const [L, a, b] = rgbToLab(128, 128, 128);
    expect(L).toBeCloseTo(53.6, 0);
    expect(a).toBeCloseTo(0, 1);
    expect(b).toBeCloseTo(0, 1);
  });

  it('maps pure red to its known Lab value', () => {
    const [L, a, b] = rgbToLab(255, 0, 0);
    expect(L).toBeCloseTo(53.24, 1);
    expect(a).toBeCloseTo(80.09, 1);
    expect(b).toBeCloseTo(67.20, 1);
  });
});

describe('deltaE2000', () => {
  it('returns 0 for identical colours', () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 2.6772, -79.7751])).toBeCloseTo(0, 4);
  });

  // Sharma et al. reference pairs
  it('matches reference pair 1', () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
  });

  it('matches reference pair 2', () => {
    expect(deltaE2000([50, 3.1571, -77.2803], [50, 0, -82.7485])).toBeCloseTo(2.8615, 3);
  });

  it('matches reference pair 3 (large hue rotation)', () => {
    expect(deltaE2000([50, -1.3802, -84.2814], [50, 0, -82.7485])).toBeCloseTo(1.0000, 3);
  });

  it('matches reference pair 4 (RT term dominant)', () => {
    expect(deltaE2000([50, 2.4900, -0.0010], [50, -2.4900, 0.0009])).toBeCloseTo(7.1792, 3);
  });

  it('is symmetric', () => {
    const p: [number, number, number] = [60, 20, -30];
    const q: [number, number, number] = [55, -10, 25];
    expect(deltaE2000(p, q)).toBeCloseTo(deltaE2000(q, p), 6);
  });
});

import { nearestPantone, titleCase } from './sky-color.js';

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

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { analyzeSky } from './sky-color.js';

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const DUSK = readFileSync(path.join(__dirname_, '__fixtures__', 'bluehill-2026-07-16-dusk.jpg'));
const MASK = { top: 0, bottom: 175 };

describe('analyzeSky', () => {
  it('reproduces the validated dusk reading', async () => {
    const r = await analyzeSky(DUSK, MASK);
    expect(r.hero.name).toBe('Icelandic Blue');
    expect(r.bands.map((b) => b.label)).toEqual(['zenith', 'mid', 'horizon']);
    expect(r.bands.map((b) => b.name)).toEqual(['Iris', 'Thistle', 'Eventide']);
  });

  it('matches every band closely (dense table)', async () => {
    const r = await analyzeSky(DUSK, MASK);
    for (const b of r.bands) expect(b.deltaE).toBeLessThan(5);
    expect(r.hero.deltaE).toBeLessThan(5);
  });

  // The mask is the whole reason the reading is about sky and not trees.
  it('gives a darker reading when the treeline is wrongly included', async () => {
    const masked = await analyzeSky(DUSK, MASK);
    const unmasked = await analyzeSky(DUSK, { top: 0, bottom: 250 });
    expect(unmasked.hero.hex).not.toBe(masked.hero.hex);
  });
});

