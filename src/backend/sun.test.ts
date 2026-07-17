import { describe, it, expect } from 'vitest';
import { solarPosition } from './sun.js';

const BLUE_HILL = { lat: 42.2119, lon: -71.1144 };

describe('solarPosition', () => {
  it('puts the sun on the horizon at the fixture moment (Boston sunset)', () => {
    const p = solarPosition(BLUE_HILL.lat, BLUE_HILL.lon, new Date('2026-07-17T00:16:14Z'));
    expect(p.elevation).toBeCloseTo(-0.5, 1);
    expect(p.azimuth).toBeCloseTo(299.8, 0); // WNW — correct for mid-July at 42N
  });

  it('puts the sun high and south-south-east at noon EDT', () => {
    const p = solarPosition(BLUE_HILL.lat, BLUE_HILL.lon, new Date('2026-07-16T16:00:00Z'));
    expect(p.elevation).toBeCloseTo(66.5, 0);
    expect(p.azimuth).toBeCloseTo(149.2, 0);
  });

  it('puts the sun well below the northern horizon at local midnight', () => {
    const p = solarPosition(BLUE_HILL.lat, BLUE_HILL.lon, new Date('2026-07-17T04:00:00Z'));
    expect(p.elevation).toBeLessThan(-20);
    expect(p.azimuth).toBeGreaterThan(330);
  });
});
