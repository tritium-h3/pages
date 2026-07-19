import { describe, it, expect } from 'vitest';
import { nearestCam, SKY_CAMS, type SkyCam } from './sky-cams.js';

const cam = (id: string, lat: number, lon: number): SkyCam => ({
  id,
  name: id,
  url: '',
  lat,
  lon,
  credit: '',
  creditUrl: '',
  skyMask: { top: 0, bottom: 1 },
});

describe('nearestCam', () => {
  const world = [
    cam('boston', 42.36, -71.06),
    cam('london', 51.51, -0.13),
    cam('tokyo', 35.68, 139.69),
  ];

  it('picks the cam nearest to a point', () => {
    expect(nearestCam(42.2, -71.1, world).id).toBe('boston');
    expect(nearestCam(51.4, -0.1, world).id).toBe('london');
    expect(nearestCam(35.7, 139.7, world).id).toBe('tokyo');
  });

  it('handles the antimeridian correctly (haversine, not naive lon delta)', () => {
    // A point just east of the dateline is nearest the cam just west of it,
    // even though their raw longitude difference (~358.5) looks enormous.
    const antimeridian = [cam('west-pacific', 0, 170), cam('dateline', 0, -179)];
    expect(nearestCam(0, 179.5, antimeridian).id).toBe('dateline');
  });

  it('routes real-world points to the nearest cam in the actual set', () => {
    expect(nearestCam(42.36, -71.06).id).toBe('bluehill-1'); // Boston, US
    expect(nearestCam(48.14, 11.58).id).toBe('zugspitze');   // Munich, near the Alps
    expect(nearestCam(-43.53, 172.63).id).toBe('tekapo');    // Christchurch, NZ
    expect(SKY_CAMS.length).toBeGreaterThanOrEqual(3);
  });
});
