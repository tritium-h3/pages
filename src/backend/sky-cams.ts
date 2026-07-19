import type { SkyMask } from './sky-frame.js';

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

// A curated, hand-vetted set of sky-facing cams. Each entry was checked the same
// way: a stable still-JPEG URL that sends a real Last-Modified, an eyeball of the
// actual frame to hand-tune skyMask (rows, plus columns when overlays sit in the
// sky strip), coordinates for nearest-cam, and visible attribution. Adding a cam
// is one object here — no code change. IDs are kept memorable because, until a
// picker page exists, people reach a cam by typing /sky?cam=<id>.
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
    // than a little missing sky does. (Not included: bluehill_right.jpg — weather
    // instrument towers stab into its sky and it has a burned-in timestamp.)
    skyMask: { top: 0, bottom: 175 },
  },
  {
    id: 'zugspitze',
    name: 'Zugspitze — north from the summit',
    url: 'https://www.foto-webcam.eu/webcam/zugspitze-nord/current/720.jpg',
    lat: 47.4211,
    lon: 10.9853,
    credit: 'Bayerische Zugspitzbahn / foto-webcam.eu',
    creditUrl: 'https://www.foto-webcam.eu/webcam/zugspitze-nord/',
    // 720x405 frame. Overlays (caption top-left, logo top-right) sit above y=80.
    // Kept conservative at bottom:200: this 2962 m summit is often fogged, and the
    // clear-day northern horizon wasn't visible when the mask was set — if a
    // reading ever looks like rock/terrain rather than sky, recheck on a clear day.
    skyMask: { top: 80, bottom: 200 },
  },
  {
    id: 'tekapo',
    name: 'Lake Tekapo — south over the village',
    url: 'https://tekapotourism.nz/webcam/images/south.jpg',
    lat: -44.0043,
    lon: 170.4783,
    credit: 'Tekapo Tourism',
    creditUrl: 'https://tekapotourism.nz/webcam.html',
    // 1920x1080 frame. Deliberately the SOUTH view: in the Southern Hemisphere the
    // sun arcs through the north, so a south-facing cam keeps the sun behind the
    // camera all day — no direct-sun contamination. The timestamp bar is the only
    // overlay (above y=70); bottom:380 stays above the distant mountain ridge.
    skyMask: { top: 70, bottom: 380 },
  },
];

export const getCam = (id: string): SkyCam | undefined =>
  SKY_CAMS.find((c) => c.id === id);

// Great-circle distance in kilometres. Only used to rank cams by proximity, so
// the sphere approximation is more than enough — and it handles the antimeridian
// correctly (unlike naive lat/lon deltas), which matters for a worldwide set.
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * The cam closest to a point by great-circle distance. `cams` defaults to the
 * real list; tests inject a synthetic multi-cam list to prove the ranking. With
 * a single cam it returns that cam from anywhere on Earth — which is exactly the
 * current behaviour until more cams are added.
 */
export function nearestCam(lat: number, lon: number, cams: SkyCam[] = SKY_CAMS): SkyCam {
  let best = cams[0];
  let bestD = Infinity;
  for (const c of cams) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
