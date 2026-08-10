# Color-systems split — extract pantone.ts, add a palette seam

Date: 2026-07-17

Splits the backend's `sky-color.ts` into three honestly-named modules, so that
adding more named-swatch color systems later (RAL, Copic, Crayola, CSS/X11,
xkcd — **future work, not built here**) is a drop-in rather than a surgery.

## Motivation

`sky-color.ts` currently carries three unrelated concerns: shared color math,
the Pantone palette, and sky-frame analysis. Two independent reviewers flagged
this during the feature build. The user wants Pantone pulled out with an eye to
future color systems.

The user confirmed the future systems all share Pantone's mechanism: **a table
of named swatches, matched by nearest CIEDE2000 (ΔE)**. So the seam is *data plus
one generic function* — no `ColorNamer` interface, no per-system classes. YAGNI.

## Why three modules, not two

A naive extraction creates a **circular import**. Pantone needs `Lab`,
`rgbToLab`, and `deltaE2000` (to build and match its chips); those live in
`sky-color.ts`, which also holds `analyzeSky`, which needs `nearestPantone`. So
`pantone.ts → sky-color.ts` and `sky-color.ts → pantone.ts` would form a cycle —
and a load-order-sensitive one, because `pantone.ts` calls `rgbToLab` at module
load to precompute its chip table. If the other module is mid-initialization,
that call sees `undefined`.

The fix is to pull the shared math into a leaf module both sides import:

| module | holds | depends on |
|---|---|---|
| **`color.ts`** (new) | `Lab`, `srgbToLinear`, `rgbToLab`, `rad`, `deg`, `deltaE2000`, `Swatch`, `ColorMatch`, `nearestSwatch` | nothing |
| **`pantone.ts`** (new) | `pantone.json` import, `titleCase`, `PANTONE_SWATCHES`, `nearestPantone` | `color.ts` |
| **`sky-frame.ts`** (rename of `sky-color.ts`) | `SkyMask`, `BandLabel`, `SkyReading`, `BAND_LABELS`, `SAMPLE_W/H`, `median`, `analyzeSky` | `color.ts`, `pantone.ts` |

Acyclic: `color.ts` is a leaf; both others point down into it.

## The seam (all the "future work" lives here)

`color.ts` gains two types and one function — the generic palette engine:

```ts
export type Swatch = { code: string; name: string; hex: string; lab: Lab };
export type ColorMatch = { code: string; name: string; hex: string; deltaE: number };

/** Nearest swatch in an arbitrary palette by CIEDE2000. Palette-agnostic. */
export function nearestSwatch(lab: Lab, swatches: Swatch[]): ColorMatch {
  let best = swatches[0];
  let bestD = Infinity;
  for (const s of swatches) {
    const d = deltaE2000(lab, s.lab);
    if (d < bestD) { bestD = d; best = s; }
  }
  return { code: best.code, name: best.name, hex: best.hex, deltaE: bestD };
}
```

`pantone.ts` becomes just "the Pantone palette, expressed as swatches":

```ts
import { rgbToLab, nearestSwatch, type Lab, type Swatch, type ColorMatch } from './color.js';
import pantoneTable from './pantone.json';   // keep the existing dist-runnability comment verbatim

type RawChip = { name: string; hex: string };

/** "flame-scarlet" -> "Flame Scarlet". Pantone slugs are kebab-case. */
export function titleCase(slug: string): string { /* unchanged */ }

// Precomputed once at module load: 2310 Pantone chips as swatches.
const PANTONE_SWATCHES: Swatch[] = Object.entries(pantoneTable as Record<string, RawChip>)
  .map(([code, v]) => {
    const r = parseInt(v.hex.slice(0, 2), 16);
    const g = parseInt(v.hex.slice(2, 4), 16);
    const b = parseInt(v.hex.slice(4, 6), 16);
    return { code, name: titleCase(v.name), hex: `#${v.hex}`, lab: rgbToLab(r, g, b) };
  });

/** Nearest Pantone FHI (TCX) chip by CIEDE2000. */
export function nearestPantone(lab: Lab): ColorMatch {
  return nearestSwatch(lab, PANTONE_SWATCHES);
}
```

Adding RAL later = a new `ral.ts` that builds its own `Swatch[]` from its own
data and calls the same `nearestSwatch`. No change to `color.ts` or `sky-frame.ts`.

`titleCase` and the TCX code format stay in `pantone.ts` — each palette owns
producing its own display-ready names; the engine only carries the `name` string
it is handed.

## What stays Pantone-specific vs. generic

- **Generic** (`color.ts`): the ΔE match loop, the `Swatch`/`ColorMatch` shapes.
- **Pantone-specific** (`pantone.ts`): the data file, kebab→Title Case, the chip
  precompute, the `nearestPantone` entry point.

The old `PantoneMatch` type is replaced by the identically-shaped `ColorMatch`
from `color.ts`. Nothing imports `PantoneMatch` by name today (only `analyzeSky`
and `SkyReading` cross module lines, plus tests), so this rename is safe.

## Invariant: nothing observable changes

`ColorMatch` has the exact fields `PantoneMatch` has today — `{ code, name, hex,
deltaE }` — so:

- The `/api/sky` JSON is **byte-identical**. The frontend needs **zero changes**.
- The validated fixture reading (hero `Icelandic Blue`; bands `Iris` / `Thistle`
  / `Eventide`) must still pass **unchanged** — it is the proof the refactor
  preserved behavior.
- No `system` field is added. That is the one change that *would* ripple into the
  JSON and the frontend, so it waits until a real second palette exists.

This is a pure, behavior-preserving refactor. The whole existing suite passing
unchanged is the safety net.

## Files

- **`src/backend/color.ts`** (new) — shared math + palette engine (above).
- **`src/backend/pantone.ts`** (new) — Pantone palette (above).
- **`src/backend/sky-color.ts` → `src/backend/sky-frame.ts`** (rename) — the
  `analyzeSky` code, now importing `rgbToLab` from `color.js` and `nearestPantone`
  from `pantone.js`. `SkyReading.hero`/`bands` typed as `ColorMatch`.
- **`src/backend/sky-source.ts`** (edit) — import `analyzeSky`, `SkyReading` from
  `./sky-frame.js` instead of `./sky-color.js`.
- **`src/backend/sky-cams.ts`** (edit) — import `type SkyMask` from `./sky-frame.js`.
- **`CLAUDE.md`** (edit) — the dist-runnability note currently says "see the
  comment in `sky-color.ts`"; the `pantone.json` import moved, so point it at
  `pantone.ts`.

Confirmed non-importers (no edit needed): `routes/sky.ts` (imports `solarPosition`
from `sun.js`, `getEntry`/cams from their modules — never from `sky-color.ts`),
and the frontend (has its own `Match` type, imports no backend module).

## Testing

Test files mirror source. The existing `sky-color.test.ts` (18 tests) splits:

- **`color.test.ts`** — the moved `rgbToLab` and `deltaE2000` blocks, **plus** new
  `nearestSwatch` tests against a tiny synthetic 2–3 entry palette: exact-hex input
  returns that swatch at ΔE ≈ 0, and an off-color input picks the nearer of two.
- **`pantone.test.ts`** — the moved `titleCase` and `nearestPantone` blocks
  (exact chip `17-1462` → "Flame" at ΔE ≈ 0; `egret` title-cased; dense-table
  match < 5; hex format `/^#[0-9a-f]{6}$/`).
- **`sky-frame.test.ts`** (rename of `sky-color.test.ts`) — the `analyzeSky`
  block, unchanged, still asserting Icelandic Blue / Iris / Thistle / Eventide
  against the committed dusk fixture.

`sun.test.ts` and `sky-source.test.ts` are untouched. The 18 tests currently in
`sky-color.test.ts` are redistributed (not deleted) across the three new test
files, so the suite goes from 29 to **29 + the new `nearestSwatch` tests** — no
existing assertion is lost, and `npx tsc -p src/backend/tsconfig.json --noEmit`
stays clean.

## Out of scope

The second palette itself; any `system` field; an interface/class abstraction;
letting `analyzeSky` choose among multiple palettes; any frontend change. The
whole point is to make those cheap *later*, not to do them now.
