import { describe, it, expect } from 'vitest';
import { rgbToLab, deltaE2000, nearestSwatch, type Swatch } from './color.js';

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

describe('nearestSwatch', () => {
  const swatch = (code: string, name: string, r: number, g: number, b: number): Swatch => ({
    code,
    name,
    hex: `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`,
    lab: rgbToLab(r, g, b),
  });

  const palette: Swatch[] = [
    swatch('R', 'Red', 255, 0, 0),
    swatch('G', 'Green', 0, 255, 0),
    swatch('B', 'Blue', 0, 0, 255),
  ];

  it('returns the exact swatch at ~zero distance for its own colour', () => {
    const m = nearestSwatch(rgbToLab(255, 0, 0), palette);
    expect(m.code).toBe('R');
    expect(m.name).toBe('Red');
    expect(m.deltaE).toBeCloseTo(0, 4);
  });

  it('picks the nearer of several swatches', () => {
    // A slightly-off red must resolve to Red, not Green or Blue.
    const m = nearestSwatch(rgbToLab(240, 20, 20), palette);
    expect(m.code).toBe('R');
  });

  it('carries the matched swatch hex and a non-negative deltaE', () => {
    const m = nearestSwatch(rgbToLab(10, 250, 10), palette);
    expect(m.code).toBe('G');
    expect(m.hex).toBe('#00ff00');
    expect(m.deltaE).toBeGreaterThanOrEqual(0);
  });
});
