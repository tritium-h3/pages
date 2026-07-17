// ---------------------------------------------------------------------------
// Colour maths. Pure — no network, no Express, no filesystem beyond the
// vendored Pantone table. Everything here is unit-tested offline.
// ---------------------------------------------------------------------------

export type Lab = [number, number, number];

const srgbToLinear = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** sRGB (0-255) -> CIELAB, D65 reference white. */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);

  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / 1.0;
  const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;

  const f = (t: number): number =>
    t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29;

  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** CIEDE2000 colour difference. */
export function deltaE2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const kL = 1, kC = 1, kH = 1;

  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));

  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);

  let h1p = deg(Math.atan2(b1, a1p)); if (h1p < 0) h1p += 360;
  let h2p = deg(Math.atan2(b2, a2p)); if (h2p < 0) h2p += 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);

  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;

  let hbp: number;
  if (C1p * C2p === 0) {
    hbp = h1p + h2p;
  } else {
    hbp = (h1p + h2p) / 2;
    if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 180 : -180;
  }

  const T =
    1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp))
      + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.20 * Math.cos(rad(4 * hbp - 63));

  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));

  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;

  return Math.sqrt(
    Math.pow(dLp / (kL * Sl), 2) +
    Math.pow(dCp / (kC * Sc), 2) +
    Math.pow(dHp / (kH * Sh), 2) +
    Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh))
  );
}

// Plain import, NOT `with { type: 'json' }`. The import-attribute form fails
// this backend's `module: ES2020` with TS2823, and switching module kinds to
// allow it would change resolution for every backend file.
//
// Tradeoff, accepted deliberately: tsc emits pantone.json into dist/, but the
// compiled dist/backend then throws ERR_IMPORT_ATTRIBUTE_MISSING under plain
// node, which requires the attribute for JSON regardless of what tsc emitted.
// That costs nothing today — dev and prod both run this via `tsx` (the
// pages.service systemd unit is `npm run dev`), and nothing executes
// dist/backend. If that ever changes, load the table with createRequire and
// copy the .json into dist as a build step.
import pantoneTable from './pantone.json';

export type PantoneMatch = {
  /** TCX code, e.g. "17-1462" */
  code: string;
  /** Display-ready name, e.g. "Flame Scarlet" */
  name: string;
  /** "#rrggbb" */
  hex: string;
  /** CIEDE2000 distance. Debug only — never rendered. */
  deltaE: number;
};

/** "flame-scarlet" -> "Flame Scarlet" */
export function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

type RawChip = { name: string; hex: string };

// Precomputed once at module load: 2310 chips x Lab.
const CHIPS: Array<{ code: string; name: string; hex: string; lab: Lab }> =
  Object.entries(pantoneTable as Record<string, RawChip>).map(([code, v]) => {
    const r = parseInt(v.hex.slice(0, 2), 16);
    const g = parseInt(v.hex.slice(2, 4), 16);
    const b = parseInt(v.hex.slice(4, 6), 16);
    return { code, name: titleCase(v.name), hex: `#${v.hex}`, lab: rgbToLab(r, g, b) };
  });

/** Nearest Pantone FHI (TCX) chip by CIEDE2000. */
export function nearestPantone(lab: Lab): PantoneMatch {
  let best = CHIPS[0];
  let bestD = Infinity;
  for (const chip of CHIPS) {
    const d = deltaE2000(lab, chip.lab);
    if (d < bestD) { bestD = d; best = chip; }
  }
  return { code: best.code, name: best.name, hex: best.hex, deltaE: bestD };
}

// ---------------------------------------------------------------------------
// Sky frame analysis. Turns a webcam JPEG into a hero Pantone plus three
// gradient bands (zenith/mid/horizon).
// ---------------------------------------------------------------------------

import sharp from 'sharp';

/** Rows only — full frame width is always used. */
export type SkyMask = { top: number; bottom: number };

export type BandLabel = 'zenith' | 'mid' | 'horizon';

export type SkyReading = {
  hero: PantoneMatch;
  bands: Array<{ label: BandLabel } & PantoneMatch>;
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
