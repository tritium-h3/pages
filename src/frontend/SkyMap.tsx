import { useEffect, useRef, useState } from 'react';
import { apiUrl } from './backendApi';
import './SkyMap.css';

type Cam = {
  id: string;
  name: string;
  location: string;
  lat: number;
  lon: number;
  phase: string;
  credit: string;
  creditUrl: string;
};
type CamsPayload = { subsolar: { lat: number; lon: number }; cams: Cam[] };

type Ring = number[][];
type LandGeoJSON = {
  features: Array<{ geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } }>;
};

// Equirectangular projection: lon/lat -> [0,1] fractions of the map.
const xFrac = (lon: number): number => (lon + 180) / 360;
const yFrac = (lat: number): number => (90 - lat) / 180;

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

// Sun elevation (degrees) at a point, given where the sun is directly overhead.
// This is the same physics solarPosition uses, reduced to a single term because
// the subsolar point (the hard, tested part) comes from the backend.
function sunElevation(lat: number, lon: number, sub: { lat: number; lon: number }): number {
  const s =
    Math.sin(rad(lat)) * Math.sin(rad(sub.lat)) +
    Math.cos(rad(lat)) * Math.cos(rad(sub.lat)) * Math.cos(rad(lon - sub.lon));
  return deg(Math.asin(Math.max(-1, Math.min(1, s))));
}

const MAP_W = 1000;
const MAP_H = 500;
const OCEAN = '#12203a';
const LAND = '#33456b';

function drawMap(
  ctx: CanvasRenderingContext2D,
  land: LandGeoJSON | null,
  sub: { lat: number; lon: number }
): void {
  ctx.fillStyle = OCEAN;
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  if (land) {
    ctx.fillStyle = LAND;
    ctx.beginPath();
    for (const f of land.features) {
      const polys = (f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates]
        : f.geometry.coordinates) as Ring[][];
      for (const poly of polys) {
        for (const ring of poly) {
          ring.forEach(([lon, lat], i) => {
            const x = xFrac(lon) * MAP_W;
            const y = yFrac(lat) * MAP_H;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
        }
      }
    }
    ctx.fill();
  }

  // Day/night veil: compute the sun's elevation on a coarse grid, darken by how
  // far below the horizon it is (0 at the terminator -> full at astronomical
  // night, -18deg), then scale it up over the map. Same bands as the sky phases.
  const SW = 360;
  const SH = 180;
  const shade = document.createElement('canvas');
  shade.width = SW;
  shade.height = SH;
  const sctx = shade.getContext('2d');
  if (sctx) {
    const img = sctx.createImageData(SW, SH);
    for (let y = 0; y < SH; y++) {
      const lat = 90 - ((y + 0.5) / SH) * 180;
      for (let x = 0; x < SW; x++) {
        const lon = ((x + 0.5) / SW) * 360 - 180;
        const elev = sunElevation(lat, lon, sub);
        // 0 in daylight, ramps to 1 by -18deg (astronomical night).
        const t = Math.max(0, Math.min(1, -elev / 18));
        const smooth = t * t * (3 - 2 * t); // gentle S-curve for a soft terminator
        const i = (y * SW + x) * 4;
        img.data[i] = 6;
        img.data[i + 1] = 10;
        img.data[i + 2] = 26;
        img.data[i + 3] = Math.round(smooth * 0.82 * 255);
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(shade, 0, 0, MAP_W, MAP_H);
  }
}

export default function SkyMap() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [land, setLand] = useState<LandGeoJSON | null>(null);
  const [data, setData] = useState<CamsPayload | null>(null);
  const [error, setError] = useState('');

  // Land geometry loads once (a static asset).
  useEffect(() => {
    let cancelled = false;
    fetch('/world-land.geojson')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((geo) => { if (!cancelled) setLand(geo as LandGeoJSON); })
      .catch(() => { /* map still works without land — ocean + terminator + pips */ });
    return () => { cancelled = true; };
  }, []);

  // Cams + subsolar point: on load and every minute (keeps phases and the
  // terminator fresh; the terminator drifts ~0.25 deg/min, so this reads as live).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const resp = await fetch(apiUrl('/sky/cams'));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const payload = (await resp.json()) as CamsPayload;
        if (!cancelled) { setData(payload); setError(''); }
      } catch (e) {
        if (!cancelled && !data) setError(e instanceof Error ? e.message : 'failed to load');
      }
    };
    load();
    const timer = setInterval(load, 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw whenever the land or the subsolar point changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext('2d');
    if (ctx) drawMap(ctx, land, data.subsolar);
  }, [land, data]);

  if (error && !data) {
    return <div className="sky-map-page sky-map-page--msg">Map unavailable: {error}</div>;
  }

  return (
    <div className="sky-map-page">
      <h1 className="sky-map-title">Skies around the world</h1>
      <p className="sky-map-sub">
        Each pip is a live sky. Hover for details; click to watch that sky.
        The map shades day and night in real time.
      </p>

      <div className="sky-map-frame">
        <canvas ref={canvasRef} width={MAP_W} height={MAP_H} className="sky-map-canvas" />
        {data?.cams.map((c) => (
          <a
            key={c.id}
            className="pip"
            href={`/sky?cam=${encodeURIComponent(c.id)}`}
            style={{ left: `${xFrac(c.lon) * 100}%`, top: `${yFrac(c.lat) * 100}%` }}
          >
            <span className="pip-dot" />
            <span className="pip-card" role="tooltip">
              <span className="pip-card__name">{c.location}</span>
              <span className="pip-card__phase">{c.phase}</span>
              <span className="pip-card__credit">© {c.credit}</span>
            </span>
          </a>
        ))}
      </div>

      <p className="sky-map-note">
        Base map: Natural Earth (public domain). Day/night shaded from the sun's position.
      </p>
    </div>
  );
}
