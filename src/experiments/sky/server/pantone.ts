// ---------------------------------------------------------------------------
// The Pantone FHI (TCX) palette, expressed as swatches. This is one colour
// system among (eventually) several — the shape to copy for a new one is:
// load a {code -> {name, hex}} table, build a Swatch[], and expose a
// nearest<System>() that delegates to nearestSwatch. Everything Pantone-specific
// (the data file, the kebab-case name format, the TCX code) lives here.
// ---------------------------------------------------------------------------

import { rgbToLab, nearestSwatch, type Lab, type Swatch, type ColorMatch } from './color.js';

// Plain import, resolved under tsconfig.server.json's `moduleResolution:
// bundler` + `resolveJsonModule`; that config is `noEmit`, so this never has
// to survive a tsc emit — only `tsx` (dev) or the bundler ever load it.
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
