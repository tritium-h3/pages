# Sky Pantone — world map cam picker (`/sky/map`)

Date: 2026-07-19

A separate page showing a live **day/night world map** with a pip at each
webcam. Hovering a pip shows the location, its current casual time-of-day, and
attribution; clicking a pip opens that cam's sky at `/sky?cam=<id>`. The page is
also where visitors land when geolocation can't place them.

This is intentionally a first cut with room to grow — see **Future tweaks**.

## Why a day/night map (and why it's easy here)

The map isn't decorative. This project already computes the sun's position for
every reading, so the same maths that labels a pip "Dawn" also shades dawn
twilight on the map. The map's light/dark bands and the pips' phase labels come
from one model and use the **same thresholds**, so they always agree. Fully
self-contained — no tile server, no external map/day-night service, no API key.

## The map, in layers

1. **Base map** — a public-domain equirectangular (plate carrée) world map (land
   silhouette), bundled as a static asset. Equirectangular is chosen because pip
   placement is then linear: `x = (lon + 180) / 360 * W`, `y = (90 - lat) / 180 * H`.
2. **Day/night shading** — a `<canvas>` recomputed about once a minute. Given the
   current **subsolar point** (the point the sun is directly overhead), the sun's
   elevation at any map point is one line of physics:
   `sin(elev) = sin(φ)·sin(δ) + cos(φ)·cos(δ)·cos(λ − λ_sub)`, where `δ`/`λ_sub`
   are the subsolar lat/lon. Each cell is coloured by elevation using the sky
   phases' own bands — daylight (`>0`), civil (`0…−6`), nautical (`−6…−12`),
   astronomical (`−12…−18`), night (`<−18`). The terminator drifts ~0.25°/min, so
   a per-minute redraw reads as live.
3. **Pips** — one per cam at its projected position; neutral but eye-catching (a
   bright, glowing marker that stays legible over both the lit and dark halves).
   Sky-colour glow is deferred (see Future tweaks).

## Backend changes

- **`sun.ts`**: add `subsolarPoint(date): { lat, lon }`, factored from the same
  declination + equation-of-time maths `solarPosition` already computes
  (`lat = declination`, `lon = (720 − utcMinutes − eqTime) / 4`, normalised to
  `[−180, 180]`). Pure and unit-tested.
- **`sky-cams.ts`**: add an optional `location` label to each `SkyCam` for clean
  hover text (e.g. "Lake Tekapo, New Zealand", "Zugspitze, Germany",
  "Milton, Massachusetts, USA").
- **`routes/sky.ts`**: reshape `GET /api/sky/cams` from a bare array to:
  ```jsonc
  {
    "subsolar": { "lat": 20.8, "lon": -14.3 },
    "cams": [
      { "id": "bluehill-1", "name": "...", "location": "...",
        "lat": 42.2119, "lon": -71.1144, "phase": "Afternoon",
        "credit": "...", "creditUrl": "..." }
    ]
  }
  ```
  `phase` is `solarPhase(...)` per cam at request time. This endpoint has **no
  current consumer**, so reshaping it is free. It does no frame fetching — pips
  are neutral, so the payload is pure sun-maths and cheap to re-request.

## Frontend: `/sky/map` (new page)

- Fetches the payload on load and every minute (keeps pip phases and the subsolar
  anchor fresh; the map redraws from each fresh subsolar point).
- Renders base map + day/night canvas + pips.
- **Hover a pip** → info card: location, time-of-day (the phase), attribution as
  a link to `creditUrl`. **Click a pip** → navigate to `/sky?cam=<id>`.
- Desktop-first, per decision. A tap still navigates; refined mobile interaction
  is deferred.
- Standard back-to-menu button, matching the other pages.

## Wiring into the existing app

- **Routing**: add an exact `pathname === '/sky/map'` branch in `App.jsx`
  (deep-links resolve via the same SPA fallback that already serves `/sky`).
- **Geolocation redirect**: in `SkyPantone.tsx`, the current "geolocation failed
  → load default cam" path becomes "→ navigate to `/sky/map`". Unchanged:
  geolocation success → nearest cam; a `?cam=` already in the URL → load it
  directly with no prompt.
- **Links to the picker**: a visible link on `/sky` (e.g. near the footer), an
  entry in the main app menu, and the pips themselves linking back into `/sky`.

## Testing

- `subsolarPoint` gets unit tests against known anchors: declination ≈ +23.4° at
  the June solstice and ≈ 0° at an equinox; subsolar longitude ≈ 0° (± equation
  of time) at 12:00 UTC.
- The map render, shading, and hover/click are verified in the browser (the
  frontend has no test harness), and the result is shown to the user.

## Out of scope / Future tweaks

Explicit extension points, since further tweaks are expected:

- **Pip sky-colour glow** — colour each pip with its location's *current* hero
  Pantone. Deferred because it makes the picker fetch + analyse every cam; the
  payload shape already has room to add a `hero` per cam later.
- **Per-cam narratives** — the hand-written "about this sky" blurbs (see the
  `sky-pantone-parked-features` note); the hover card / an expanded card is their
  natural home. Would be an optional prose field on `SkyCam`.
- **Mobile interaction** — a tap-to-card-then-view model instead of desktop
  hover/click.
- **Map niceties** — pan/zoom, a prettier base map, a subsolar "sun" marker, a
  smooth (sub-minute) terminator animation, labelled twilight bands.
- **More cams** — every addition is one `SKY_CAMS` entry and a new pip; nothing
  on this page is hardcoded to three.
