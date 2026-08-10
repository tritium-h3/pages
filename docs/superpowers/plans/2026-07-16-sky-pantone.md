# Sky Pantone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/sky` — a page reporting the current sky as the nearest named Pantone chip, sampled from the Blue Hill Observatory haze cam.

**Architecture:** A pure, network-free color module (`sky-color.ts`) does all the math and is fully unit-tested against a committed fixture frame. A thin Express route (`routes/sky.ts`) handles fetching, a 5-minute cache, and proxying the JPEG. A React page renders a hero swatch plus three gradient bands. Backend does the pixel work because the source serves no CORS headers.

**Tech Stack:** TypeScript, Express, `sharp` (already present), React 19, Vitest (new — the repo has no tests today).

## Global Constraints

- **This project is for fun.** The Pantone *name* is the payload. Colorimetric accuracy is explicitly not a goal.
- **Match against the Pantone FHI (TCX) library only.** Formula Guide chips (`1585 C`) are numeric-only and nameless; using them defeats the entire purpose.
- All color math happens in **CIELAB**. Nearest-neighbor in RGB is perceptually wrong.
- **Never render ΔE on the page.** Computed and returned in JSON for debugging only. With 2310 chips it sits at 1.2–2.9 always — a constant that never informs.
- Source is `https://hazecam.net/images/main/bluehill_left.jpg` — **bare host**, no `www.` (which 301-redirects).
- Attribute "© CAMNET / Blue Hill Observatory" visibly, linking to `https://hazecam.net/camsite.aspx?site=bluehill`.
- Send `User-Agent: pages-sky/1.0 (https://samarkand.hopto.org)` on every outbound fetch (follows `image-hunt.ts`).
- Never poll the source faster than every 5 minutes.
- Backend TS uses **ESM `.js` import specifiers** (e.g. `from './sky-color.js'`) even though sources are `.ts`.
- Backend `tsconfig.json` already sets `strict: true` and `resolveJsonModule: true`.

---

### Task 1: Test infrastructure + sRGB→CIELAB

**Files:**
- Modify: `package.json` (add vitest, add `test` script, move `sharp` to dependencies)
- Create: `vitest.config.ts`
- Create: `src/backend/sky-color.ts`
- Test: `src/backend/sky-color.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `rgbToLab(r: number, g: number, b: number): [number, number, number]` — sRGB 0-255 in, CIELAB (D65) out.

- [ ] **Step 1: Install vitest and move sharp to dependencies**

`sharp` is currently in `devDependencies` (the sprite build uses it at build time). The backend now needs it at runtime, so it must move.

```bash
npm install --save-dev vitest
npm install sharp@^0.34.4          # promotes sharp to dependencies
```

Then add to the `scripts` block in `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Verify `sharp` now appears under `dependencies` and NOT under `devDependencies` in `package.json`.

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/backend/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Write the failing test**

Create `src/backend/sky-color.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rgbToLab } from './sky-color.js';

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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./sky-color.js` / `rgbToLab is not a function`.

- [ ] **Step 5: Write minimal implementation**

Create `src/backend/sky-color.ts`:

```ts
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 4 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/backend/sky-color.ts src/backend/sky-color.test.ts
git commit -m "feat(sky): add vitest + sRGB to CIELAB conversion"
```

---

### Task 2: CIEDE2000 colour difference

**Files:**
- Modify: `src/backend/sky-color.ts`
- Test: `src/backend/sky-color.test.ts`

**Interfaces:**
- Consumes: `Lab` type from Task 1.
- Produces: `deltaE2000(a: Lab, b: Lab): number`

- [ ] **Step 1: Write the failing test**

Append to `src/backend/sky-color.test.ts`. The non-trivial pairs are from Sharma's CIEDE2000 reference dataset, which exists specifically to catch the hue-rotation term everyone gets wrong.

```ts
import { deltaE2000 } from './sky-color.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `deltaE2000 is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/backend/sky-color.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all Task 1 + Task 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/backend/sky-color.ts src/backend/sky-color.test.ts
git commit -m "feat(sky): add CIEDE2000 colour difference"
```

---

### Task 3: Vendored Pantone TCX table + nearest match

**Files:**
- Create: `src/backend/pantone.json` (downloaded)
- Modify: `src/backend/sky-color.ts`
- Test: `src/backend/sky-color.test.ts`

**Interfaces:**
- Consumes: `rgbToLab`, `deltaE2000`, `Lab`.
- Produces:
  - `export type PantoneMatch = { code: string; name: string; hex: string; deltaE: number }`
  - `nearestPantone(lab: Lab): PantoneMatch`
  - `titleCase(slug: string): string`

- [ ] **Step 1: Vendor the dataset**

Download the FHI (TCX) table — keyed by TCX code → `{ name, hex }`, 2310 entries:

```bash
curl -sSL -o src/backend/pantone.json \
  https://raw.githubusercontent.com/Margaret2/pantone-colors/master/pantone-numbers.json
```

Verify it looks right (expect `2310` and the `egret` sample):

```bash
node -e "const d=require('./src/backend/pantone.json'); console.log(Object.keys(d).length); console.log(d['11-0103'])"
```
Expected output:
```
2310
{ name: 'egret', hex: 'f3ece0' }
```

Vendored rather than added as a dependency: it is static data that will never change, and a package for one JSON file is not worth the supply chain.

- [ ] **Step 2: Write the failing test**

Append to `src/backend/sky-color.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `nearestPantone is not a function`.

- [ ] **Step 4: Write minimal implementation**

Append to `src/backend/sky-color.ts`:

```ts
// Plain import, NOT `with { type: 'json' }`. Verified: the import-attribute form
// fails this repo's tsconfig with "TS2823: Import attributes are only supported
// when '--module' is set to esnext/node18/node20/nodenext/preserve" — this
// backend is on `module: ES2020`. The plain form works under tsx, tsc and
// vitest, and tsc copies the .json into dist/ on build.
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
```

This relies on `resolveJsonModule: true`, already set in the backend tsconfig.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/backend/pantone.json src/backend/sky-color.ts src/backend/sky-color.test.ts
git commit -m "feat(sky): vendor Pantone TCX table + nearest-chip matching"
```

---

### Task 4: analyzeSky — crop, downsample, median, bands

**Files:**
- Modify: `src/backend/sky-color.ts`
- Test: `src/backend/sky-color.test.ts`
- Uses (already committed): `src/backend/__fixtures__/bluehill-2026-07-16-dusk.jpg`

**Interfaces:**
- Consumes: `rgbToLab`, `nearestPantone`, `Lab`, `PantoneMatch`.
- Produces:
  - `export type SkyMask = { top: number; bottom: number }`
  - `export type BandLabel = 'zenith' | 'mid' | 'horizon'`
  - `export type SkyReading = { hero: PantoneMatch; bands: Array<{ label: BandLabel } & PantoneMatch> }`
  - `analyzeSky(jpeg: Buffer, mask: SkyMask): Promise<SkyReading>`

**Fixture note:** `bluehill-2026-07-16-dusk.jpg` (md5 `97ebc1ce453f2e13a47c0c5006fcf83e`, 500x250) is already committed. It is the exact frame the design was validated against — the source cam overwrites every ~15 min, so this frame is unrecoverable. Do not regenerate it.

- [ ] **Step 1: Write the failing test**

Append to `src/backend/sky-color.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `analyzeSky is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/backend/sky-color.ts`:

```ts
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

const median = (xs: number[]): number => {
  const s = [...xs].sort((p, q) => p - q);
  return s[s.length >> 1];
};

export async function analyzeSky(jpeg: Buffer, mask: SkyMask): Promise<SkyReading> {
  const meta = await sharp(jpeg).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const bottom = Math.min(mask.bottom, height);
  const region = bottom - mask.top;
  if (width <= 0 || region <= 0) throw new Error('sky mask does not intersect the frame');

  const { data } = await sharp(jpeg)
    .extract({ left: 0, top: mask.top, width, height: region })
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — hero `Icelandic Blue`, bands `Iris` / `Thistle` / `Eventide`.

If the names differ, do NOT edit the expectations to match. That means the pipeline changed (likely a `sharp` resize-kernel difference) and needs investigating — these values were produced by the validated prototype against this exact fixture.

- [ ] **Step 5: Commit**

```bash
git add src/backend/sky-color.ts src/backend/sky-color.test.ts src/backend/__fixtures__/bluehill-2026-07-16-dusk.jpg
git commit -m "feat(sky): analyse sky frame into hero + gradient band Pantones"
```

---

### Task 5: NOAA solar position

**Files:**
- Modify: `src/backend/sky-color.ts`
- Test: `src/backend/sky-color.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `solarPosition(lat: number, lon: number, date: Date): { elevation: number; azimuth: number }` — degrees; elevation negative below horizon, azimuth clockwise from north.

- [ ] **Step 1: Write the failing test**

Append to `src/backend/sky-color.test.ts`. These anchors are physically verified: the fixture moment is Boston's visual sunset that evening, and near the solstice at 42°N the sun sets well *north* of west.

```ts
import { solarPosition } from './sky-color.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `solarPosition is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/backend/sky-color.ts`:

```ts
/**
 * NOAA solar position algorithm. Returns degrees; elevation is negative below
 * the horizon, azimuth is clockwise from north. Geometric — no refraction
 * correction, so visual sunset reads at roughly -0.83 rather than 0.
 */
export function solarPosition(
  lat: number,
  lon: number,
  date: Date
): { elevation: number; azimuth: number } {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525.0; // Julian century

  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const eqCtr =
    Math.sin(rad(meanAnom)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * meanAnom)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * meanAnom)) * 0.000289;

  const trueLong = meanLong + eqCtr;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));

  const meanObliq =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos(rad(omega));

  const declin = deg(Math.asin(Math.sin(rad(obliqCorr)) * Math.sin(rad(appLong))));

  const y = Math.pow(Math.tan(rad(obliqCorr / 2)), 2);
  const eqTime =
    4 *
    deg(
      y * Math.sin(2 * rad(meanLong)) -
        2 * eccent * Math.sin(rad(meanAnom)) +
        4 * eccent * y * Math.sin(rad(meanAnom)) * Math.cos(2 * rad(meanLong)) -
        0.5 * y * y * Math.sin(4 * rad(meanLong)) -
        1.25 * eccent * eccent * Math.sin(2 * rad(meanAnom))
    );

  const utcMin =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTime = (utcMin + eqTime + 4 * lon + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;

  const zenith = deg(
    Math.acos(
      Math.sin(rad(lat)) * Math.sin(rad(declin)) +
        Math.cos(rad(lat)) * Math.cos(rad(declin)) * Math.cos(rad(hourAngle))
    )
  );
  const elevation = 90 - zenith;

  // NOTE: denominator is sin(zenith), not cos(zenith). Getting this wrong pins
  // azimuth to exactly 180 at sunrise/sunset and looks plausible elsewhere.
  let azimuth: number;
  const denom = Math.sin(rad(zenith)) * Math.cos(rad(lat));
  if (Math.abs(denom) > 1e-9) {
    const cosAz = (Math.sin(rad(lat)) * Math.cos(rad(zenith)) - Math.sin(rad(declin))) / denom;
    const az = deg(Math.acos(Math.min(1, Math.max(-1, cosAz))));
    azimuth = hourAngle > 0 ? (az + 180) % 360 : (540 - az) % 360;
  } else {
    azimuth = declin > 0 ? 180 : 0;
  }

  return { elevation, azimuth };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/sky-color.ts src/backend/sky-color.test.ts
git commit -m "feat(sky): add NOAA solar position"
```

---

### Task 6: Cam config + testable fetch/cache layer

**Files:**
- Create: `src/backend/sky-cams.ts`
- Create: `src/backend/sky-source.ts`
- Test: `src/backend/sky-source.test.ts`

**Interfaces:**
- Consumes: `analyzeSky`, `SkyMask`, `SkyReading` from `sky-color.js`.
- Produces:
  - `export type SkyCam = { id, name, url, lat, lon, credit, creditUrl, skyMask }`
  - `SKY_CAMS: SkyCam[]`, `getCam(id: string): SkyCam | undefined`
  - `export type CacheEntry = { fetchedAt: number; asOf: string; jpeg: Buffer; etag?: string; lastModified?: string; reading: SkyReading }`
  - `getEntry(cam: SkyCam): Promise<{ entry: CacheEntry; stale: boolean }>`
  - `__clearCache(): void` (test seam)

**Why this is its own module:** the fetch/cache logic (304 reuse, stale fallback) is the most bug-prone part of the feature and the part `curl` cannot verify — you would have to break the network on demand. Splitting it out of the route lets it be tested with a stubbed `fetch`, and leaves the route a thin HTTP layer.

- [ ] **Step 1: Create the cam config**

Create `src/backend/sky-cams.ts`:

```ts
import type { SkyMask } from './sky-color.js';

export type SkyCam = {
  id: string;
  name: string;
  /** Direct JPEG snapshot. Bare host — www. 301-redirects. */
  url: string;
  lat: number;
  lon: number;
  credit: string;
  creditUrl: string;
  skyMask: SkyMask;
};

// Start with one cam and expand. Adding cam #2 is one object, not a code change.
//
// Deliberately NOT included yet: bluehill_right.jpg. It has weather instrument
// towers stabbing into the sky plus a burned-in timestamp, both of which would
// poison an average. It needs its own hand-tuned mask first.
//
// The left/right filenames do NOT map to compass direction (bluehill_right is
// the frame showing the distant city skyline), so this is labelled neutrally
// rather than guessing an orientation.
export const SKY_CAMS: SkyCam[] = [
  {
    id: 'bluehill-1',
    name: 'Blue Hill Observatory',
    url: 'https://hazecam.net/images/main/bluehill_left.jpg',
    lat: 42.2119,
    lon: -71.1144,
    credit: 'CAMNET / Blue Hill Observatory',
    creditUrl: 'https://hazecam.net/camsite.aspx?site=bluehill',
    // 500x250 frame; treeline sits at about y=185. Err high (excluding sky)
    // rather than low (including trees) — dark trees drag a median far harder
    // than a little missing sky does.
    skyMask: { top: 0, bottom: 175 },
  },
];

export const getCam = (id: string): SkyCam | undefined =>
  SKY_CAMS.find((c) => c.id === id);
```

- [ ] **Step 2: Write the failing tests for fetch/cache**

Create `src/backend/sky-source.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { getEntry, __clearCache } from './sky-source.js';
import type { SkyCam } from './sky-cams.js';

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const DUSK = readFileSync(path.join(__dirname_, '__fixtures__', 'bluehill-2026-07-16-dusk.jpg'));

const CAM: SkyCam = {
  id: 'test-cam',
  name: 'Test Cam',
  url: 'https://example.invalid/sky.jpg',
  lat: 42.2119,
  lon: -71.1144,
  credit: 'Test',
  creditUrl: 'https://example.invalid',
  skyMask: { top: 0, bottom: 175 },
};

const LM = 'Fri, 17 Jul 2026 00:16:14 GMT';

const jpegResponse = () =>
  new Response(DUSK, {
    status: 200,
    headers: { 'content-type': 'image/jpeg', 'last-modified': LM, etag: '"abc"' },
  });

beforeEach(() => __clearCache());
afterEach(() => vi.unstubAllGlobals());

describe('getEntry', () => {
  it('fetches, analyses, and reports the source Last-Modified as asOf', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jpegResponse()));
    const { entry, stale } = await getEntry(CAM);
    expect(stale).toBe(false);
    expect(entry.asOf).toBe('2026-07-17T00:16:14.000Z'); // source time, not fetch time
    expect(entry.reading.hero.name).toBe('Icelandic Blue');
  });

  it('serves from cache without a second fetch inside the TTL', async () => {
    const spy = vi.fn(async () => jpegResponse());
    vi.stubGlobal('fetch', spy);
    await getEntry(CAM);
    await getEntry(CAM);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('sends conditional headers and reuses the cached reading on 304', async () => {
    const spy = vi.fn(async (_url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      // First call has no validators; second must send them.
      if (!h['If-None-Match']) return jpegResponse();
      expect(h['If-None-Match']).toBe('"abc"');
      expect(h['If-Modified-Since']).toBe(LM);
      return new Response(null, { status: 304 });
    });
    vi.stubGlobal('fetch', spy);

    await getEntry(CAM);
    vi.setSystemTime(Date.now() + 6 * 60 * 1000); // expire the TTL
    const { entry, stale } = await getEntry(CAM);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(stale).toBe(false);
    expect(entry.reading.hero.name).toBe('Icelandic Blue'); // reused, not re-analysed
    vi.useRealTimers();
  });

  it('falls back to the last good reading when refresh fails', async () => {
    const spy = vi
      .fn()
      .mockImplementationOnce(async () => jpegResponse())
      .mockImplementationOnce(async () => { throw new Error('network down'); });
    vi.stubGlobal('fetch', spy);

    await getEntry(CAM);
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    const { entry, stale } = await getEntry(CAM);

    expect(stale).toBe(true);
    expect(entry.asOf).toBe('2026-07-17T00:16:14.000Z'); // real age, not faked
    expect(entry.reading.hero.name).toBe('Icelandic Blue');
    vi.useRealTimers();
  });

  it('throws when refresh fails and there is nothing cached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(getEntry(CAM)).rejects.toThrow();
  });

  it('throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    await expect(getEntry(CAM)).rejects.toThrow(/500/);
  });
});
```

Note `vi.setSystemTime` requires fake timers. Add at the top of the `describe`:

```ts
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-07-17T00:20:00Z')); });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./sky-source.js`.

- [ ] **Step 4: Implement the fetch/cache module**

Create `src/backend/sky-source.ts`:

```ts
import { analyzeSky, type SkyReading } from './sky-color.js';
import type { SkyCam } from './sky-cams.js';

const USER_AGENT = 'pages-sky/1.0 (https://samarkand.hopto.org)';
// Source publishes every ~15 min; never poll faster than this.
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

export type CacheEntry = {
  fetchedAt: number;
  /** Source Last-Modified — the real "as of", not our fetch time. */
  asOf: string;
  jpeg: Buffer;
  etag?: string;
  lastModified?: string;
  reading: SkyReading;
};

const cache = new Map<string, CacheEntry>();

/** Test seam. Not used in production. */
export function __clearCache(): void {
  cache.clear();
}

async function refresh(cam: SkyCam): Promise<CacheEntry> {
  const prev = cache.get(cam.id);

  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  // Conditional request: don't re-download a frame that hasn't changed.
  if (prev?.etag) headers['If-None-Match'] = prev.etag;
  if (prev?.lastModified) headers['If-Modified-Since'] = prev.lastModified;

  const resp = await fetch(cam.url, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (resp.status === 304 && prev) {
    const touched = { ...prev, fetchedAt: Date.now() };
    cache.set(cam.id, touched);
    return touched;
  }
  if (!resp.ok) throw new Error(`cam fetch failed: ${resp.status}`);

  const jpeg = Buffer.from(await resp.arrayBuffer());
  const lastModified = resp.headers.get('last-modified') ?? undefined;
  const entry: CacheEntry = {
    fetchedAt: Date.now(),
    asOf: lastModified ? new Date(lastModified).toISOString() : new Date().toISOString(),
    jpeg,
    etag: resp.headers.get('etag') ?? undefined,
    lastModified,
    reading: await analyzeSky(jpeg, cam.skyMask),
  };
  cache.set(cam.id, entry);
  return entry;
}

/** Cached entry if fresh; otherwise refresh. Falls back to stale on failure. */
export async function getEntry(cam: SkyCam): Promise<{ entry: CacheEntry; stale: boolean }> {
  const cached = cache.get(cam.id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { entry: cached, stale: false };
  }
  try {
    return { entry: await refresh(cam), stale: false };
  } catch (err) {
    // Serve the last good reading with its real age rather than a spinner or a
    // fabricated colour. If we have nothing at all, the caller 503s.
    if (cached) {
      console.error(`sky: refresh failed for ${cam.id}, serving stale:`, err);
      return { entry: cached, stale: true };
    }
    throw err;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 6 `getEntry` tests plus everything from Tasks 1–5.

- [ ] **Step 6: Commit**

```bash
git add src/backend/sky-cams.ts src/backend/sky-source.ts src/backend/sky-source.test.ts
git commit -m "feat(sky): add cam config + cached conditional frame fetching"
```

---

### Task 7: Backend route

**Files:**
- Create: `src/backend/routes/sky.ts`
- Modify: `src/backend/index.ts` (import at ~line 12, mount at ~line 61)

**Interfaces:**
- Consumes: `SKY_CAMS`, `getCam` from `sky-cams.js`; `getEntry` from `sky-source.js`; `solarPosition` from `sun.js`.
- Produces: default-export Express `Router` — `GET /api/sky/cams`, `GET /api/sky?cam=<id>`, `GET /api/sky/frame/:camId`.

- [ ] **Step 1: Create the route**

Create `src/backend/routes/sky.ts`. It is deliberately thin — all fetching and caching lives in `sky-source.ts`.

```ts
import { Router, Request, Response } from 'express';
import { solarPosition } from '../sun.js';
import { SKY_CAMS, getCam } from '../sky-cams.js';
import { getEntry } from '../sky-source.js';

const router = Router();

router.get('/sky/cams', (_req: Request, res: Response) => {
  res.json(
    SKY_CAMS.map(({ id, name, credit, creditUrl }) => ({ id, name, credit, creditUrl }))
  );
});

router.get('/sky', async (req: Request, res: Response) => {
  const id = typeof req.query.cam === 'string' ? req.query.cam : SKY_CAMS[0].id;
  const cam = getCam(id);
  if (!cam) return res.status(404).json({ error: `unknown cam: ${id}` });

  try {
    const { entry, stale } = await getEntry(cam);
    const sun = solarPosition(cam.lat, cam.lon, new Date(entry.asOf));
    res.json({
      cam: { id: cam.id, name: cam.name, credit: cam.credit, creditUrl: cam.creditUrl },
      asOf: entry.asOf,
      stale,
      sun: {
        elevation: Number(sun.elevation.toFixed(1)),
        azimuth: Number(sun.azimuth.toFixed(1)),
      },
      hero: entry.reading.hero,
      bands: entry.reading.bands,
    });
  } catch (err) {
    console.error('sky: no reading available:', err);
    res.status(503).json({ error: 'sky reading unavailable' });
  }
});

router.get('/sky/frame/:camId', async (req: Request, res: Response) => {
  const cam = getCam(req.params.camId);
  if (!cam) return res.status(404).json({ error: 'unknown cam' });
  try {
    const { entry } = await getEntry(cam);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(entry.jpeg);
  } catch {
    res.status(503).end();
  }
});

export default router;
```

- [ ] **Step 2: Mount the route**

In `src/backend/index.ts`, add alongside the other route imports (after line 12):

```ts
import skyRouter from './routes/sky.js';
```

And alongside the other mounts (after `app.use('/api', imageHuntRouter);`, ~line 61):

```ts
app.use('/api', skyRouter);
```

No init function is needed — the cache is in-memory and starts empty.

- [ ] **Step 3: Verify the endpoints against the live cam**

```bash
npm run dev:restart
sleep 3
curl -s "http://localhost:5174/api/sky/cams"
echo
curl -s "http://localhost:5174/api/sky" | head -c 600
echo
curl -s -o /dev/null -w "frame: %{http_code} %{content_type} %{size_download} bytes\n" \
  "http://localhost:5174/api/sky/frame/bluehill-1"
```

Expected: `cams` returns one object with `id: "bluehill-1"`. `/api/sky` returns JSON with `hero.name` a title-cased Pantone name, `bands` of length 3 labelled zenith/mid/horizon, an `asOf` timestamp, and `stale: false`. `frame` returns `200 image/jpeg` with a non-zero size.

Note: the live sky will NOT read `Icelandic Blue` — that was dusk on 2026-07-16. Any plausible name is a pass.

- [ ] **Step 4: Verify the cache actually holds against the real source**

```bash
curl -s "http://localhost:5174/api/sky" > /dev/null
time curl -s "http://localhost:5174/api/sky" > /dev/null
```
Expected: the second call returns in a few milliseconds (no outbound fetch). Task 6 proves the cache logic in isolation; this proves it is wired up.

- [ ] **Step 5: Commit**

```bash
git add src/backend/routes/sky.ts src/backend/index.ts
git commit -m "feat(sky): add /api/sky route"
```

---

### Task 8: Frontend page

**Files:**
- Create: `src/frontend/SkyPantone.tsx`
- Create: `src/frontend/SkyPantone.css`
- Modify: `src/frontend/App.jsx` (import ~line 9, route branch ~line 122, menu button ~line 157)

**Interfaces:**
- Consumes: `GET /api/sky`, `GET /api/sky/frame/:camId` from Task 7; `apiUrl` from `./backendApi`.
- Produces: default-export `SkyPantone` React component.

**No cam picker yet.** There is one cam, so a picker would be a dropdown with a single entry. The spec defers it until a second cam exists; `GET /api/sky/cams` is the API surface it will use.

- [ ] **Step 1: Create the page component**

Create `src/frontend/SkyPantone.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { apiUrl } from './backendApi';
import './SkyPantone.css';

type Match = { code: string; name: string; hex: string; deltaE: number };
type Band = Match & { label: 'zenith' | 'mid' | 'horizon' };

type Reading = {
  cam: { id: string; name: string; credit: string; creditUrl: string };
  asOf: string;
  stale: boolean;
  sun: { elevation: number; azimuth: number };
  hero: Match;
  bands: Band[];
};

const compass = (az: number): string => {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(az / 22.5) % 16];
};

const sunLabel = (sun: Reading['sun']): string => {
  const dir = compass(sun.azimuth);
  return sun.elevation >= 0
    ? `☉ ${sun.elevation.toFixed(0)}° above horizon, ${dir}`
    : `☉ ${Math.abs(sun.elevation).toFixed(0)}° below horizon, ${dir}`;
};

export default function SkyPantone() {
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const resp = await fetch(apiUrl('/sky'));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as Reading;
        if (!cancelled) { setReading(data); setError(''); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'failed to load');
      }
    };
    load();
    const timer = setInterval(load, 5 * 60 * 1000); // matches backend cache TTL
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (error && !reading) return <div className="sky-page sky-page--error">Sky unavailable: {error}</div>;
  if (!reading) return <div className="sky-page sky-page--loading">Reading the sky…</div>;

  const asOf = new Date(reading.asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="sky-page" style={{ background: reading.hero.hex }}>
      <div className="sky-hero">
        <div className="sky-hero__code">PANTONE {reading.hero.code}</div>
        <h1 className="sky-hero__name">{reading.hero.name}</h1>
        <div className="sky-hero__asof">
          the sky, as of {asOf}{reading.stale ? ' (cached — source unreachable)' : ''}
        </div>
      </div>

      <div className="sky-bands">
        {reading.bands.map((b) => (
          <div className="sky-band" key={b.label} style={{ background: b.hex }}>
            <span className="sky-band__label">{b.label}</span>
            <span className="sky-band__name">{b.name}</span>
            <span className="sky-band__code">{b.code}</span>
          </div>
        ))}
      </div>

      <img className="sky-frame" src={apiUrl(`/sky/frame/${reading.cam.id}`)} alt="Live sky camera frame" />

      <footer className="sky-footer">
        <span className="sky-badge">{sunLabel(reading.sun)}</span>
        <span className="sky-credit">
          {reading.cam.name} · © <a href={reading.cam.creditUrl} target="_blank" rel="noreferrer">{reading.cam.credit}</a>
        </span>
        <span className="sky-note">Closest chip to what the camera saw. Cameras are not eyes.</span>
      </footer>
    </div>
  );
}
```

Note the `sky-note` line: this is the spec's "one wry line, not a disclaimer wall". Keep it to one line.

- [ ] **Step 2: Create the stylesheet**

Create `src/frontend/SkyPantone.css`:

```css
.sky-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  padding: 3rem 1rem 2rem;
  transition: background 1.2s ease;
  font-family: system-ui, sans-serif;
  /* The page is flooded with the sky colour, so text must not assume a theme. */
  color: #111;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.45);
}

.sky-page--loading,
.sky-page--error { justify-content: center; background: #dfe4ec; }

.sky-hero { text-align: center; }
.sky-hero__code {
  font-size: 0.8rem; letter-spacing: 0.22em; text-transform: uppercase; opacity: 0.75;
}
.sky-hero__name {
  font-size: clamp(2.5rem, 9vw, 5.5rem); font-weight: 700; margin: 0.2em 0; line-height: 1;
}
.sky-hero__asof { font-size: 0.9rem; opacity: 0.75; }

.sky-bands {
  display: flex; width: min(680px, 100%);
  border-radius: 12px; overflow: hidden; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
}
.sky-band {
  flex: 1; padding: 1.1rem 0.6rem; display: flex; flex-direction: column; gap: 0.15rem;
  align-items: center; text-align: center;
}
.sky-band__label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.12em; opacity: 0.7; }
.sky-band__name { font-weight: 600; font-size: 0.95rem; }
.sky-band__code { font-size: 0.7rem; opacity: 0.65; }

.sky-frame {
  width: min(500px, 100%); border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.22);
}

.sky-footer {
  display: flex; flex-direction: column; align-items: center; gap: 0.4rem;
  font-size: 0.78rem; opacity: 0.8; text-align: center; margin-top: auto; padding-top: 1rem;
}
.sky-badge {
  background: rgba(255, 255, 255, 0.5); border-radius: 999px; padding: 0.25rem 0.75rem;
}
.sky-credit a { color: inherit; }
.sky-note { font-style: italic; opacity: 0.75; }
```

- [ ] **Step 3: Wire up routing**

In `src/frontend/App.jsx`:

Add the import after the `ImageHunt` import (line 9):

```jsx
import SkyPantone from './SkyPantone'
```

Add the route branch after the `/imagehunt` block (after line 122):

```jsx
  if (pathname === '/sky') {
    return (
      <div>
        <button className="back-btn" onClick={() => navigateTo('/')}>
          ← Back to Menu
        </button>
        <SkyPantone />
      </div>
    )
  }
```

Add the menu button after the Image Hunt button (after line 157):

```jsx
      <button className="menu-btn" onClick={() => navigateTo('/sky')}>
        🌇 Sky Pantone
      </button>
```

- [ ] **Step 4: Verify in the real app**

```bash
npm run dev:restart
sleep 4
npm run dev:status
```

Then load `https://localhost:5173/sky` in a browser and confirm:
- A large Pantone name headlines the page, and the page background IS that colour.
- Three bands read zenith / mid / horizon, left to right, each with its own name.
- The camera frame renders (proving the proxy works — the raw hazecam URL could not be read cross-origin).
- The footer shows the sun badge, the CAMNET credit linking to hazecam.net, and the one-line note.
- **No ΔE appears anywhere on the page.**

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no new errors from `SkyPantone.tsx` or `App.jsx`.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/SkyPantone.tsx src/frontend/SkyPantone.css src/frontend/App.jsx
git commit -m "feat(sky): add /sky page"
```

---

### Task 9: Full verification

**Files:** none modified.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — all tests across Tasks 1–6.

- [ ] **Step 2: Backend typecheck**

Run: `npx tsc -p src/backend/tsconfig.json --noEmit`
Expected: no errors. (This is what `npm run build` runs for the backend; catches ESM `.js` specifier mistakes.)

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: succeeds. Confirms `sharp`-in-`dependencies` and the JSON import both survive the real build.

- [ ] **Step 4: Confirm the mask by eye**

Fetch a current frame and the current reading together:

```bash
curl -s "http://localhost:5174/api/sky" | head -c 400
curl -s -o /tmp/sky-now.jpg "http://localhost:5174/api/sky/frame/bluehill-1"
```

Open `/tmp/sky-now.jpg` and confirm the treeline sits below y≈175. If trees intrude, lower `skyMask.bottom` in `src/backend/sky-cams.ts` and re-verify — err high (excluding sky) rather than low (including trees).

- [ ] **Step 5: Commit any mask tuning**

```bash
git add src/backend/sky-cams.ts
git commit -m "fix(sky): tune Blue Hill sky mask"
```

Skip this commit if no tuning was needed.
