import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { analyzeSky } from './sky-frame.js';

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

  // Column bounds must actually crop: a left/right subset of the sky samples a
  // different slice than the full width, so the reading must differ. (This dusk
  // frame brightens left-to-right, so the left third and right third differ.)
  it('applies column bounds, sampling only the requested horizontal slice', async () => {
    const full = await analyzeSky(DUSK, { top: 0, bottom: 175 });
    const leftThird = await analyzeSky(DUSK, { top: 0, bottom: 175, left: 0, right: 166 });
    const rightThird = await analyzeSky(DUSK, { top: 0, bottom: 175, left: 334, right: 500 });
    expect(leftThird.hero.hex).not.toBe(rightThird.hero.hex);
    // And at least one of them differs from the full-width reading.
    expect([leftThird.hero.hex, rightThird.hero.hex]).not.toEqual([full.hero.hex, full.hero.hex]);
  });

  // An out-of-frame column range fails with the domain error, not a raw sharp one.
  it('rejects a column range that does not intersect the frame', async () => {
    await expect(analyzeSky(DUSK, { top: 0, bottom: 175, left: 600, right: 700 }))
      .rejects.toThrow('sky mask does not intersect the frame');
  });
});
