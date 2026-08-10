# Sky Pantone — current sky color as the nearest Pantone chip

Date: 2026-07-16

A page (`/sky`) that reports the current sky as the closest Pantone color match,
sampled from a public sky-facing webcam.

## Concept

This project is **for fun**. The payload is the *name*: when wildfire smoke turns
the sky alarming, the page should say so with a straight face — "Woodsmoke",
"Emberglow", "Flame Scarlet". Colorimetric accuracy is explicitly not the goal.

That priority drives the single most important decision here: **match against
Pantone's Fashion, Home + Interiors (TCX) library, not the Formula Guide.**
Formula Guide chips (`1585 C`) are numeric-only and have no names — a page built
on them would headline "PANTONE 1585 C" and deliver no levity at all. The FHI
library's ~2,310 chips all carry evocative names, which is the whole point.

## Validated by prototype

The full pipeline was run against live frames on 2026-07-16 at ~20:15 EDT before
this spec was written. Results:

| Cam | Hero | zenith | mid | horizon |
|---|---|---|---|---|
| `bluehill_left` | Icelandic Blue | Iris | Thistle | Eventide |
| `bluehill_right` | Serenity | Placid Blue | Vista Blue | Lavender Lustre |

All matches landed at ΔE 1.2–2.9. The concept works; the names are good.

## Source camera

**CAMNET / Blue Hill Observatory** (`hazecam.net`) — a haze-monitoring camera
network built to photograph sky and horizon for visibility and air-quality
assessment. This is the right instrument rather than a repurposed scenic cam:
wildfire smoke is precisely what it exists to see.

- Snapshot: `https://hazecam.net/images/main/bluehill_left.jpg` (use the bare
  host; `www.` 301-redirects). Verified: HTTP 200, `image/jpeg`, 500×250.
- Updates every ~15 minutes. `Last-Modified` is accurate and is the authoritative
  "as of" time — needed because `bluehill_left` has no burned-in clock.
- Serves **no CORS headers**, confirming the browser cannot read these pixels.
  The backend proxy is a requirement, not a preference.

**Start with one cam** (`bluehill_left`) and expand. It is unobstructed: sky fills
the top ~75% of frame over a low treeline, with no hardware and no overlay.
`bluehill_right` is deliberately deferred — it has weather instrument towers
stabbing into the sky and a burned-in timestamp, both of which would poison an
average. That contrast is exactly why masks are hand-tuned per cam.

Note: `bluehill_right.jpg` is the frame showing the distant city skyline, so the
left/right filenames do **not** map to compass direction. Verify orientation
before writing a directional label into config; do not guess.

## Attribution & politeness

Images are "© CAMNET" with an automated-data disclaimer and no explicit reuse
policy. Therefore: attribute visibly on the page, link back to hazecam.net, send
a descriptive User-Agent (following `image-hunt.ts`'s `USER_AGENT` pattern), and
never poll faster than they publish.

## Files

- **`src/backend/sky-cams.ts`** (new) — cam config array. One entry to start:

  ```ts
  { id: 'bluehill-1',
    name: 'Blue Hill Observatory',        // verify orientation before labeling
    url: 'https://hazecam.net/images/main/bluehill_left.jpg',
    lat: 42.2119, lon: -71.1144,
    credit: 'CAMNET / Blue Hill Observatory',
    creditUrl: 'https://hazecam.net/camsite.aspx?site=bluehill',
    skyMask: { top: 0, bottom: 175 } }   // 500×250 frame; treeline ≈ y185
  ```

  `skyMask` is rows only — full frame width is always used. `bottom: 175` is an
  initial value read off the 2026-07-16 frame; tune it by inspection during
  implementation, erring high (excluding sky) over low (including treeline),
  since dark trees drag a median far harder than missing sky does.

  Adding cam #2 is one object, not a code change.

- **`src/backend/sky-color.ts`** (new) — the pure, testable core. No network, no
  Express. Exports:
  - `rgbToLab(r,g,b)` — sRGB→CIELAB (D65).
  - `deltaE2000(lab1, lab2)` — CIEDE2000.
  - `nearestPantone(lab)` → `{ code, name, hex, deltaE }`.
  - `analyzeSky(buffer, skyMask)` → `{ hero, bands }`.

- **`src/backend/pantone.json`** (new) — vendored from
  [`Margaret2/pantone-colors`](https://github.com/Margaret2/pantone-colors)
  (`pantone-numbers.json`), keyed by TCX code → `{ name, hex }`, 2310 entries.
  Vendored rather than depended-on: it is static data that will never change, and
  a dependency for one JSON file is not worth the supply chain.
  Names are kebab-case (`flame-scarlet`) and are title-cased for display.

- **`src/backend/sky-source.ts`** (new) — fetching + the 5-minute cache, split out
  from the route so the 304-reuse and stale-fallback paths can be tested with a
  stubbed `fetch`. These are the most bug-prone paths in the feature and the ones
  `curl` cannot exercise (you would have to break the network on demand). Exports
  `getEntry(cam)` and a `__clearCache()` test seam.

- **`src/backend/routes/sky.ts`** (new) — thin HTTP layer only; all fetching and
  caching delegates to `sky-source.ts`. Mounted `app.use('/api', skyRouter)`.
  - `GET /api/sky/cams` → `[{ id, name, credit, creditUrl }]` for the picker.
  - `GET /api/sky?cam=<id>` → the reading (below).
  - `GET /api/sky/frame/:camId` → proxies the JPEG so the page can show evidence.

- **`src/frontend/SkyPantone.tsx`** + **`SkyPantone.css`** (new) — the page.
- **`src/frontend/App.jsx`** (existing) — add `pathname === '/sky'` branch + menu button.
- **`package.json`** (existing) — move `sharp` from `devDependencies` to
  `dependencies`. The sprite build uses it at build time today; the backend now
  needs it at runtime.

## Pixel → Pantone

1. Fetch JPEG (descriptive User-Agent, timeout).
2. Crop to `skyMask`; downsample to ~100×35 (kills JPEG noise, cheap).
3. Convert sRGB → CIELAB. All color math in Lab — nearest-neighbor in RGB is
   perceptually wrong and would pick matches the eye disagrees with.
4. **Hero** = per-channel *median* in Lab. Median, not mean, so a bright cloud
   edge or a passing bird cannot drag the answer; under full overcast the median
   correctly *is* the gray.
5. **Bands** = mean Lab of each horizontal third: zenith / mid / horizon. The
   horizon band is where smoke shows first, which is the reason bands exist.
6. Match hero and each band to the nearest TCX chip by CIEDE2000.

## Response shape

```jsonc
{
  "cam": { "id": "bluehill-1", "name": "...", "credit": "...", "creditUrl": "..." },
  "asOf": "2026-07-17T00:16:14Z",     // source Last-Modified, not our fetch time
  "stale": false,                      // true when serving cache after a failed fetch
  "sun": { "elevation": -0.5, "azimuth": 299.8 },   // verified for the fixture moment
  "hero":  { "code": "15-3908", "name": "Icelandic Blue", "hex": "#a9adc2", "deltaE": 1.6 },
  "bands": [
    { "label": "zenith",  "code": "14-3805", "name": "Iris",     "hex": "#baafbc", "deltaE": 1.2 },
    { "label": "mid",     "code": "14-3907", "name": "Thistle",  "hex": "#b9b3c5", "deltaE": 2.9 },
    { "label": "horizon", "code": "16-3919", "name": "Eventide", "hex": "#959eb7", "deltaE": 1.3 }
  ]
}
```

`deltaE` is returned for debugging but **not rendered**. The prototype showed it
sits at 1.2–2.9 always: with 2310 chips the nearest is essentially always
excellent, so on-page it would be a near-constant that never informs. Off the page.

## Page

Hero swatch filling the top, with the Pantone name large and the TCX code above it
in small caps. Below, the three gradient bands as a connected strip, each labeled
with its own name. Then the source frame (via our proxy) with visible "© CAMNET /
Blue Hill Observatory" attribution linking back. Cam picker only appears once
there is more than one cam.

A small, unobtrusive sun badge in the footer: elevation + azimuth, e.g.
"☉ 2° below horizon". Deliberately **no** night-unreliability warning — reliability
after dark is an open empirical question, to be observed before it is designed for.

Sun position via a ~40-line NOAA solar-position function in its own `src/backend/sun.ts`
— no new dependency. It lives apart from `sky-color.ts` because celestial mechanics
shares no code or types with the colour pipeline; two reviewers flagged the combined
file, and splitting it was cheapest before anything imported it.

## Caching, freshness, errors

- Cache the reading per cam for **5 minutes** (source publishes every ~15).
- Use conditional requests (`If-None-Match` / `If-Modified-Since`) so unchanged
  frames are not re-downloaded.
- On fetch failure or timeout: serve the last good reading with `stale: true` and
  its real `asOf`, and let the page show its true age. Never a spinner, never a
  fabricated color.
- No persistence. Cache is in-memory and dies with the process — "current only"
  by design; no storage module, no polling loop, no retention policy.

## Known limitations (accepted)

- **The camera is not an eye.** Auto white-balance and auto-exposure actively
  fight the very orange we want to measure. The two cams disagreeing at the same
  instant (Icelandic Blue vs. Serenity) partly demonstrates this. Accepted: this
  is for fun, and the disagreement is itself interesting.
- **Pantone is approximate twice over.** Pantone's values are proprietary; public
  hex lists approximate spot inks, which are physical pigments with no exact sRGB
  equivalent. This is "closest chip to what the camera saw", not a colorimetric
  claim. Say so lightly on the page — one wry line, not a disclaimer wall.
- **One vantage point.** The sky over Milton, MA is not the sky over your house.

## Testing

`sky-color.ts` is pure and tested offline:
- Fixture JPEGs committed under `src/backend/__fixtures__/` — including the
  2026-07-16 dusk frame, a genuinely good case (pink cloud over blue-grey).
- `rgbToLab` against known reference values.
- `deltaE2000` against hand-checked pairs from the CIEDE2000 reference data.
- `nearestPantone` — exact hex input must return that chip at ΔE ≈ 0.
- `analyzeSky` on the dusk fixture must return the validated names above.
- Mask correctness: a fixture with treeline included vs. excluded must differ.
- `solarPosition` against physically verified anchors: the fixture moment is
  Boston's visual sunset (elevation ≈ -0.5°, azimuth ≈ 299.8° WNW), plus noon and
  midnight. The azimuth anchors matter — a wrong denominator in the NOAA formula
  pins azimuth to exactly 180° at sunrise/sunset and looks plausible elsewhere.

`sky-source.ts` is tested with a stubbed global `fetch`: conditional headers are
sent, 304 reuses the cached reading, a failed refresh serves the last good reading
with `stale: true` and its real age, and a failure with nothing cached throws.

The repo has **no test runner today**; Vitest is introduced by this work.

## Out of scope

History/time-series, archives, alerts, multi-city, derived-from-weather-data
fallback, camera upload. Deliberately deferred until the page proves interesting.
