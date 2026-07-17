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
