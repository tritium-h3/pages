// ---------------------------------------------------------------------------
// Shared colour maths and the palette-matching engine. Pure — no network, no
// Express, no filesystem. Every colour-naming system (Pantone today, others
// later) depends on this leaf module; it depends on nothing, so there is no
// import cycle between a palette and its consumers.
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

// ---------------------------------------------------------------------------
// Palette matching. A "colour system" is just a table of named swatches with
// precomputed Lab; matching is nearest-by-CIEDE2000. Pantone is the only palette
// today, but any future one (RAL, Copic, CSS names, ...) is a Swatch[] plus a
// one-line call to nearestSwatch — no change needed here.
// ---------------------------------------------------------------------------

/** One named colour in a palette, with its Lab precomputed for matching. */
export type Swatch = { code: string; name: string; hex: string; lab: Lab };

/** The result of naming a colour: which swatch, and how far off it was. */
export type ColorMatch = {
  /** System-specific code, e.g. Pantone TCX "17-1462" */
  code: string;
  /** Display-ready name, e.g. "Flame Scarlet" */
  name: string;
  /** "#rrggbb" */
  hex: string;
  /** CIEDE2000 distance to the input. Debug only — never rendered. */
  deltaE: number;
};

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
