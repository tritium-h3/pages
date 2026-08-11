import { useState, useEffect } from 'react';
import styles from './sky.module.css';
import { apiUrl } from '../../platform/backendApi.js';
import type { ExperimentPageProps } from '../../platform/manifest.js';
import SkyMap from './SkyMap.js';

type Match = { code: string; name: string; hex: string; deltaE: number };
type Band = Match & { label: 'zenith' | 'mid' | 'horizon' };

type Reading = {
  cam: { id: string; name: string; credit: string; creditUrl: string };
  asOf: string;
  stale: boolean;
  sun: { elevation: number; azimuth: number; phase: string };
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
  const pos = sun.elevation >= 0
    ? `☉ ${sun.elevation.toFixed(0)}° above horizon, ${dir}`
    : `☉ ${Math.abs(sun.elevation).toFixed(0)}° below horizon, ${dir}`;
  return `${sun.phase} · ${pos}`;
};

// WCAG relative luminance: parse hex, linearise sRGB channels, weight-sum them.
const relativeLuminance = (hex: string): number => {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  const linearise = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
};

// Conventional WCAG threshold for choosing light vs. dark text.
const isLightBackground = (hex: string): boolean => relativeLuminance(hex) > 0.179;

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Human-readable "how long ago" — coarse buckets so it reads naturally
// (e.g. "1 hr ago" rather than "58 min ago").
const formatAge = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

// Renders the reading's true age unambiguously: clock time alone can't tell
// a fresh frame from a two-day-old one, so a non-today asOf gets its date
// spelled out, and a human "N ago" always rides alongside the clock time.
// When the backend couldn't refresh (reading.stale) or a later poll failed
// (refreshFailed), a plain qualifier is appended — not a warning banner.
const formatAsOf = (asOf: string, isStale: boolean): string => {
  const asOfDate = new Date(asOf);
  const now = new Date();
  const clock = asOfDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const clockPart = isSameDay(asOfDate, now)
    ? clock
    : `${asOfDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${clock}`;
  const age = formatAge(now.getTime() - asOfDate.getTime());
  const qualifier = isStale ? ' — source unreachable' : '';
  return `${clockPart} (${age})${qualifier}`;
};

// Resolve the nearest cam's id from the visitor's browser location. Resolves to
// null on any failure — no geolocation API, permission denied, timeout, or the
// lookup itself failing — so the caller can fall back to the default cam.
const resolveNearestCamId = (): Promise<string | null> =>
  new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const resp = await fetch(apiUrl('sky', `/nearest?lat=${latitude}&lon=${longitude}`));
          if (!resp.ok) return resolve(null);
          const cam = (await resp.json()) as { id?: string };
          resolve(cam.id ?? null);
        } catch {
          resolve(null);
        }
      },
      () => resolve(null), // denied, unavailable, or errored
      { timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  });

// Navigate to the map sub-route without a full page reload — App.tsx listens
// for popstate and re-derives the route from window.location on every one.
const goToMap = (e: React.MouseEvent): void => {
  e.preventDefault();
  window.history.pushState({}, '', '/sky/map');
  window.dispatchEvent(new PopStateEvent('popstate'));
};

function SkyReading() {
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState('');
  // Tracks a refresh that failed *after* a reading was already on screen —
  // distinct from `error`, whose branch is unreachable once reading is set.
  // Without this, a dead source after a good first load is invisible.
  const [refreshFailed, setRefreshFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    // `camId` null means "let the backend pick its default"; used when we have
    // no cam in the URL and geolocation didn't give us one.
    const load = async (camId: string | null) => {
      try {
        const resp = await fetch(apiUrl('sky', camId ? `/?cam=${encodeURIComponent(camId)}` : '/'));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as Reading;
        if (cancelled) return;
        setReading(data);
        setError('');
        setRefreshFailed(false);
        // Pin whatever cam we actually resolved into the URL, so the page is
        // shareable and won't re-prompt for location on the next visit. Only
        // when the URL doesn't already carry a cam.
        if (!new URLSearchParams(window.location.search).get('cam')) {
          window.history.replaceState({}, '', `/sky?cam=${encodeURIComponent(data.cam.id)}`);
        }
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : 'failed to load'); setRefreshFailed(true); }
      }
    };

    const start = async () => {
      // A cam in the URL (e.g. a shared link) is authoritative — never prompt.
      let camId = new URLSearchParams(window.location.search).get('cam');
      if (!camId) {
        camId = await resolveNearestCamId();
        if (cancelled) return;
        if (camId === null) {
          // Couldn't place the visitor (no permission, timeout, ...). Send them
          // to the map to choose a sky themselves rather than guessing a default.
          window.location.assign('/sky/map');
          return;
        }
      }
      await load(camId);
      timer = setInterval(() => load(camId), 5 * 60 * 1000); // matches backend cache TTL
    };

    start();
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, []);

  if (error && !reading) return <div className={`${styles.skyPage} ${styles.skyPageError}`}>Sky unavailable: {error}</div>;
  if (!reading) return <div className={`${styles.skyPage} ${styles.skyPageLoading}`}>Reading the sky…</div>;

  const asOf = formatAsOf(reading.asOf, reading.stale || refreshFailed);
  const contrastModifier = isLightBackground(reading.hero.hex) ? styles.skyPageLight : styles.skyPageDark;

  return (
    <div className={`${styles.skyPage} ${contrastModifier}`} style={{ background: reading.hero.hex }}>
      <div className={styles.skyHero}>
        <div className={styles.skyHeroCode}>PANTONE {reading.hero.code}</div>
        <h1 className={styles.skyHeroName}>{reading.hero.name}</h1>
        <div className={styles.skyHeroAsof}>
          the sky, as of {asOf}
        </div>
      </div>

      <div className={styles.skyBands}>
        {reading.bands.map((b) => (
          // Each band carries its own colour, which can sit on the opposite side
          // of the luminance threshold from the hero — a dark zenith under a lit
          // horizon is exactly the sunset case this page exists for. So each band
          // picks its own text colour rather than inheriting the page's.
          <div
            className={`${styles.skyBand} ${isLightBackground(b.hex) ? styles.skyBandLight : styles.skyBandDark}`}
            key={b.label}
            style={{ background: b.hex }}
          >
            <span className={styles.skyBandLabel}>{b.label}</span>
            <span className={styles.skyBandName}>{b.name}</span>
            <span className={styles.skyBandCode}>{b.code}</span>
          </div>
        ))}
      </div>

      {/* asOf is a cache-buster, not a real query param the route reads: the
          image src otherwise depends only on cam.id, which never changes, so
          the browser would fetch it exactly once per mount and the "live"
          frame would silently freeze at whatever it looked like on load.
          Do not remove this even though the backend ignores it. */}
      {/* The frame links to its source cam. Nice UX, and some sources (e.g.
          foto-webcam.eu) require that a displayed image click through to them. */}
      <a
        className={styles.skyFrameLink}
        href={reading.cam.creditUrl}
        target="_blank"
        rel="noreferrer"
        title={`${reading.cam.name} — source`}
      >
        <img
          className={styles.skyFrame}
          src={apiUrl('sky', `/frame/${reading.cam.id}?asOf=${encodeURIComponent(reading.asOf)}`)}
          alt={`Live sky camera frame — ${reading.cam.name}`}
        />
      </a>

      <footer className={styles.skyFooter}>
        <span className={styles.skyBadge}>{sunLabel(reading.sun)}</span>
        <span className={styles.skyCredit}>
          {reading.cam.name} · © <a href={reading.cam.creditUrl} target="_blank" rel="noreferrer">{reading.cam.credit}</a>
          {' — '}
          <a className={styles.skyMaplink} href="/sky/map" onClick={goToMap}>
            change camera
          </a>
        </span>
        <span className={styles.skyNote}>Closest chip to what the camera saw. Cameras are not eyes.</span>
      </footer>
    </div>
  );
}

export default function SkyPage({ subpath }: ExperimentPageProps) {
  // `subpath` comes from a raw pathname split, so a stray slash (`/sky//map`,
  // `/sky/map/`) can hand us an empty-string segment ahead of 'map'. Ignore
  // blanks rather than only checking subpath[0].
  const segment = subpath.find((s) => s !== '');
  if (segment === 'map') return <SkyMap />;
  return <SkyReading />;
}
