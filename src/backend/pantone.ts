// ---------------------------------------------------------------------------
// The Pantone FHI (TCX) palette, expressed as swatches. This is one colour
// system among (eventually) several — the shape to copy for a new one is:
// load a {code -> {name, hex}} table, build a Swatch[], and expose a
// nearest<System>() that delegates to nearestSwatch. Everything Pantone-specific
// (the data file, the kebab-case name format, the TCX code) lives here.
// ---------------------------------------------------------------------------

import { rgbToLab, nearestSwatch, type Lab, type Swatch, type ColorMatch } from './color.js';

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

type RawChip = { name: string; hex: string };

/** "flame-scarlet" -> "Flame Scarlet". Pantone slugs are kebab-case. */
export function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Precomputed once at module load: 2310 Pantone chips as swatches.
const PANTONE_SWATCHES: Swatch[] = Object.entries(pantoneTable as Record<string, RawChip>).map(
  ([code, v]) => {
    const r = parseInt(v.hex.slice(0, 2), 16);
    const g = parseInt(v.hex.slice(2, 4), 16);
    const b = parseInt(v.hex.slice(4, 6), 16);
    return { code, name: titleCase(v.name), hex: `#${v.hex}`, lab: rgbToLab(r, g, b) };
  }
);

/** Nearest Pantone FHI (TCX) chip by CIEDE2000. */
export function nearestPantone(lab: Lab): ColorMatch {
  return nearestSwatch(lab, PANTONE_SWATCHES);
}
