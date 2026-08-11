import type { SkyMask } from './sky-frame.js';

/**
 * How to obtain a cam's current frame. Absent = `static` (fetch `url` directly),
 * which is what every cam uses unless it can't. Add a new `kind` here and a
 * matching handler in frame-sources.ts to teach the fetch layer a new pattern
 * (e.g. a future gif/video frame grab) — nothing else needs to change.
 */
export type FrameSourceConfig =
  | { kind: 'static' }
  | {
      // Institutional cams (e.g. the Icelandic Met Office) that publish frames at
      // timestamped URLs with no stable "latest" alias. We read the listing page
      // and take the newest matching image URL.
      kind: 'latestFromPage';
      /** The page that lists the available frames. */
      pageUrl: string;
      /** Origin to resolve the (relative) image paths against. */
      imageBase: string;
      /** Regex (as a string) matching this cam's frame paths; newest sorts last. */
      pattern: string;
    };

export type SkyCam = {
  id: string;
  name: string;
  /** Short place label for the map hover card, e.g. "Lake Tekapo, New Zealand". */
  location: string;
  /** Direct JPEG snapshot for `static` sources. Omitted when `source` resolves it. */
  url?: string;
  /** How to fetch the current frame. Absent = static, using `url`. */
  source?: FrameSourceConfig;
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
    location: 'Milton, Massachusetts, USA',
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
    location: 'Zugspitze, Germany',
    url: 'https://www.foto-webcam.eu/webcam/zugspitze-nord/current/720.jpg',
    lat: 47.4211,
    lon: 10.9853,
    credit: 'Bayerische Zugspitzbahn / foto-webcam.eu',
    creditUrl: 'https://www.foto-webcam.eu/webcam/zugspitze-nord/',
    // 720x405 frame, looking north and DOWNWARD off the summit, so the horizon
    // sits high — at ~y95, with dark terrain and valley town-lights below it. (The
    // first mask, {80,200}, was set during fog and unknowingly read that
    // landscape, not sky — hero came out "Black Beauty".) The real sky is a thin
    // strip between the caption (top-left, tails to ~y32) and the horizon. Columns
    // exclude the "Zugspitze" logo, which fills the top-right down to ~y80.
    skyMask: { top: 34, bottom: 88, left: 0, right: 590 },
  },
  {
    id: 'tekapo',
    name: 'Lake Tekapo — south over the village',
    location: 'Lake Tekapo, New Zealand',
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
  {
    id: 'hongkong',
    name: 'Hong Kong Observatory — east over Kowloon',
    location: 'Hong Kong',
    // Official met-agency cam serving a static JPEG with a real Last-Modified
    // (many East-Asian cams are dynamic PHP endpoints that send none — unusable).
    url: 'https://www.hko.gov.hk/wxinfo/aws/hko_mica/hko/latest_HKO.jpg',
    lat: 22.3019,
    lon: 114.1742,
    credit: 'Hong Kong Observatory',
    creditUrl: 'https://www.hko.gov.hk/en/wxinfo/ts/webcam/HKO_photo.htm',
    // 720x405 frame. Overlays (timestamp top-left, credit top-right) sit above
    // y=28; the Kowloon skyline starts around y=235, so top:30/bottom:200 keeps
    // the sample in open sky.
    skyMask: { top: 30, bottom: 200 },
  },
  {
    id: 'chajnantor',
    name: 'APEX — Chajnantor Plateau, Atacama',
    location: 'Atacama Desert, Chile',
    // Fixed (non-PTZ) site cam at 5100 m — the driest, clearest sky on Earth, an
    // intense high-altitude blue. NB there's a *second* APEX cam at .../10.0.6.84/
    // that IS a movable PTZ — do not use it; this one (10.0.6.218) is fixed.
    url: 'https://www.apex-telescope.org/camera/images/10.0.6.218/image1.jpg',
    lat: -23.0058,
    lon: -67.7592,
    credit: 'APEX (MPIfR / ESO / OSO)',
    creditUrl: 'https://www.apex-telescope.org/ns/the-project/apex-chajnantor-camera/',
    // 1920x1080 frame. A tall region of the open plateau sky to the RIGHT of the
    // antenna and buildings, from the deep zenith blue down to the pale sky just
    // above the plateau horizon (~y505) — so the horizon band catches that near-
    // horizon sky. Columns x1050-1880 stay right of the antenna; bottom:490 stays
    // above the plateau and the solar panels below it. Sun-flare artifacts drift
    // through this sky when the sun is out; we deliberately DON'T dodge them — they
    // can't be avoided in general, and against this much sky the median shrugs them
    // off (the reading is byte-identical with or without them). Cameras aren't eyes.
    skyMask: { top: 45, bottom: 490, left: 1050, right: 1880 },
  },
  {
    id: 'capetown',
    name: 'Table Mountain over Table Bay',
    location: 'Cape Town, South Africa',
    // Fixed, iconic view (Table Mountain, Lion's Head, Devil's Peak across the
    // bay). The live feed is on the German sister host kapstadt.de; the plain
    // capetown-webcam.com/webcam.jpg is stale (frozen 2020). credit links to the
    // brand site, url points at the host that actually updates.
    url: 'https://www.kapstadt.de/webcam.jpg',
    lat: -33.90,
    lon: 18.47,
    credit: 'Capetown-webcam.com / Kapstadt.de',
    creditUrl: 'https://www.capetown-webcam.com/',
    // 1280x720 frame. A TALL band in the clean column to the RIGHT of Lion's Head
    // (the western horizon — the view faces ~south, so west is frame-right). Tall
    // on purpose: its top catches the brilliant zenith blue, its bottom catches the
    // warm horizon glow where the late-day sun sets, and the wide mid band spans the
    // transition. Columns clear the Lion's Head silhouette (x>910) and the far
    // coastal hills (x<1120); top:88 clears the title/flag watermark; bottom:320
    // sits just above the city/bay skyline (~y335).
    skyMask: { top: 88, bottom: 320, left: 910, right: 1120 },
  },
  {
    id: 'hofn',
    name: 'Höfn — Vatnajökull glacier & fjord',
    location: 'Höfn í Hornafirði, Iceland',
    // Icelandic Met Office cam by Vatnajökull — a moody Nordic skyscape (a glacier
    // tongue is visible on the far shore). No static "latest" URL: frames live at
    // timestamped paths, so this uses the latestFromPage source to read the newest
    // off the listing page. (`url` is intentionally omitted — the source resolves it.)
    source: {
      kind: 'latestFromPage',
      pageUrl: 'https://en.vedur.is/weather/observations/webcams/hofn/',
      imageBase: 'https://www.vedur.is',
      pattern: '/photos/camN_hofn/\\d{8}_\\d{4}\\.jpg',
    },
    lat: 64.2539,
    lon: -15.2082,
    credit: 'Veðurstofa Íslands (Icelandic Met Office)',
    creditUrl: 'https://en.vedur.is/weather/observations/webcams/hofn/',
    // 704x528 frame. Overlays (logo top-left ~y18) and a weather mast (right, from
    // x~555) are the obstructions; the glacier and mountains sit on the horizon at
    // ~y240. top:28/bottom:228 with right:540 keeps the sample in the open storm sky
    // above the mountains and left of the mast.
    skyMask: { top: 28, bottom: 228, left: 0, right: 540 },
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
