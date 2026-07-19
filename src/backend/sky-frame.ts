// ---------------------------------------------------------------------------
// Sky frame analysis. Turns a webcam JPEG into a hero colour plus three gradient
// bands (zenith/mid/horizon), each named via a colour palette. Colour maths
// comes from ./color.js; the naming comes from ./pantone.js.
// ---------------------------------------------------------------------------

import sharp from 'sharp';
import { rgbToLab, type Lab, type ColorMatch } from './color.js';
import { nearestPantone } from './pantone.js';

/** Rows only — full frame width is always used. */
export type SkyMask = { top: number; bottom: number };

export type BandLabel = 'zenith' | 'mid' | 'horizon';

export type SkyReading = {
  hero: ColorMatch;
  bands: Array<{ label: BandLabel } & ColorMatch>;
};

const BAND_LABELS: BandLabel[] = ['zenith', 'mid', 'horizon'];

// Downsample target. Small on purpose: averages out JPEG blocking artefacts and
// makes the whole analysis trivially cheap.
const SAMPLE_W = 100;
const SAMPLE_H = 35;

// Upper median for even-length input rather than averaging the two middle
// values. Intentional, and not worth "fixing": a per-channel median is already
// a synthetic colour rather than any real pixel, and changing it would perturb
// the validated fixture readings for no perceptual gain.
const median = (xs: number[]): number => {
  const s = [...xs].sort((p, q) => p - q);
  return s[s.length >> 1];
};

export async function analyzeSky(jpeg: Buffer, mask: SkyMask): Promise<SkyReading> {
  const meta = await sharp(jpeg).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  // Clamp both bounds, not just bottom: an out-of-frame mask should fail with a
  // domain error, never leak sharp's internal extract() complaint.
  const top = Math.max(0, mask.top);
  const bottom = Math.min(mask.bottom, height);
  const region = bottom - top;
  if (width <= 0 || region <= 0) throw new Error('sky mask does not intersect the frame');

  const { data } = await sharp(jpeg)
    .extract({ left: 0, top, width, height: region })
    .resize(SAMPLE_W, SAMPLE_H, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const labs: Lab[] = [];
  for (let i = 0; i < SAMPLE_W * SAMPLE_H; i++) {
    labs.push(rgbToLab(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]));
  }

  // Hero: per-channel median. Median not mean, so a bright cloud edge or a bird
  // cannot drag the answer; under full overcast the median correctly IS the grey.
  const heroLab: Lab = [0, 1, 2].map((c) => median(labs.map((l) => l[c]))) as Lab;

  // Bands: mean of each horizontal third. The horizon band is where smoke shows
  // up first, which is the reason bands exist at all.
  const bands = BAND_LABELS.map((label, bi) => {
    const y0 = Math.floor((SAMPLE_H * bi) / 3);
    const y1 = Math.floor((SAMPLE_H * (bi + 1)) / 3);
    const sub = labs.slice(y0 * SAMPLE_W, y1 * SAMPLE_W);
    const meanLab: Lab = [0, 1, 2].map(
      (c) => sub.reduce((s, l) => s + l[c], 0) / sub.length
    ) as Lab;
    return { label, ...nearestPantone(meanLab) };
  });

  return { hero: nearestPantone(heroLab), bands };
}
