import { describe, it, expect } from 'vitest';
import { solarPosition, solarPhase, subsolarPoint } from './sun.js';

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

describe('subsolarPoint', () => {
  it('sits over the equator at an equinox', () => {
    // Sep 2026 equinox is ~22 Sep; declination is near zero there.
    const p = subsolarPoint(new Date('2026-09-22T12:00:00Z'));
    expect(p.lat).toBeCloseTo(0, 0);
  });

  it('reaches the Tropic of Cancer at the June solstice', () => {
    const p = subsolarPoint(new Date('2026-06-21T12:00:00Z'));
    expect(p.lat).toBeCloseTo(23.4, 0); // ~+23.44°
  });

  it('dips to the Tropic of Capricorn at the December solstice', () => {
    const p = subsolarPoint(new Date('2026-12-21T12:00:00Z'));
    expect(p.lat).toBeCloseTo(-23.4, 0);
  });

  it('places the subsolar longitude near Greenwich at 12:00 UTC', () => {
    // At solar noon UTC the sun is overhead near 0° longitude (± equation of time,
    // a few degrees). Well within 5°.
    const p = subsolarPoint(new Date('2026-03-20T12:00:00Z'));
    expect(Math.abs(p.lon)).toBeLessThan(5);
  });

  it('marches the subsolar longitude ~15°/hour westward', () => {
    const noon = subsolarPoint(new Date('2026-03-20T12:00:00Z'));
    const later = subsolarPoint(new Date('2026-03-20T18:00:00Z')); // +6h
    // 6 hours -> ~90° further west (more negative), wrapping aside.
    expect(later.lon).toBeCloseTo(noon.lon - 90, 0);
  });

  it('sits near the antimeridian at 00:00 UTC (noon at 180°)', () => {
    const p = subsolarPoint(new Date('2026-03-20T00:00:00Z'));
    expect(Math.abs(p.lon)).toBeGreaterThan(175); // ~±180
  });
});

const EAST = 90;   // rising / morning side (azimuth < 180)
const WEST = 270;  // setting / evening side (azimuth >= 180)

describe('solarPhase', () => {
  it('names every rising-side phase', () => {
    expect(solarPhase(-20, EAST)).toBe('Night');
    expect(solarPhase(-15, EAST)).toBe('Morning astronomical twilight');
    expect(solarPhase(-9, EAST)).toBe('Early dawn');
    expect(solarPhase(-3, EAST)).toBe('Dawn');
    expect(solarPhase(3, EAST)).toBe('Sunrise');
    expect(solarPhase(30, EAST)).toBe('Morning');
  });

  it('names every setting-side phase', () => {
    expect(solarPhase(30, WEST)).toBe('Afternoon');
    expect(solarPhase(10, WEST)).toBe('Evening');
    expect(solarPhase(3, WEST)).toBe('Sunset');
    expect(solarPhase(-3, WEST)).toBe('Dusk');
    expect(solarPhase(-9, WEST)).toBe('Twilight');
    expect(solarPhase(-15, WEST)).toBe('Evening astronomical twilight');
  });

  it('calls deep night "Night" on both sides of the sky', () => {
    expect(solarPhase(-20, EAST)).toBe('Night');
    expect(solarPhase(-20, WEST)).toBe('Night');
  });

  it('places phases correctly on their lower-inclusive boundaries', () => {
    expect(solarPhase(-18, EAST)).toBe('Morning astronomical twilight'); // not Night
    expect(solarPhase(-12, EAST)).toBe('Early dawn');
    expect(solarPhase(-6, EAST)).toBe('Dawn');
    expect(solarPhase(0, EAST)).toBe('Sunrise');   // horizon crossing
    expect(solarPhase(6, EAST)).toBe('Morning');   // golden hour ends
    expect(solarPhase(15, WEST)).toBe('Afternoon'); // afternoon/evening split
    expect(solarPhase(14.9, WEST)).toBe('Evening');
  });

  it('treats solar noon (azimuth 180) as the afternoon side', () => {
    expect(solarPhase(45, 180)).toBe('Afternoon');
    expect(solarPhase(45, 179.9)).toBe('Morning');
  });

  it('labels the validated dusk fixture moment as Dusk', () => {
    // The committed fixture: elevation -0.5, azimuth 299.8 (setting, civil twilight).
    const p = solarPhase(-0.5, 299.8);
    expect(p).toBe('Dusk');
  });
});
