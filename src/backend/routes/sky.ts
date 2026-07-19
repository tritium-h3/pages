import { Router, Request, Response } from 'express';
import { solarPosition, solarPhase, subsolarPoint } from '../sun.js';
import { SKY_CAMS, getCam, nearestCam } from '../sky-cams.js';
import { getEntry } from '../sky-source.js';

const router = Router();

// Everything the map picker needs in one payload: where the sun is (to shade the
// day/night map) and, per cam, where it is, its current time-of-day, and its
// attribution. No frame fetching here — pips are neutral, so this is pure sun
// maths and cheap to re-request each minute.
router.get('/sky/cams', (_req: Request, res: Response) => {
  const now = new Date();
  res.json({
    subsolar: subsolarPoint(now),
    cams: SKY_CAMS.map((cam) => {
      const sun = solarPosition(cam.lat, cam.lon, now);
      return {
        id: cam.id,
        name: cam.name,
        location: cam.location,
        lat: cam.lat,
        lon: cam.lon,
        phase: solarPhase(sun.elevation, sun.azimuth),
        credit: cam.credit,
        creditUrl: cam.creditUrl,
      };
    }),
  });
});

// Resolve the closest cam to a point. The frontend calls this when it has the
// visitor's coordinates but no cam in the URL; it then pins the returned id.
router.get('/sky/nearest', (req: Request, res: Response) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const valid =
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  if (!valid) return res.status(400).json({ error: 'lat and lon required (lat -90..90, lon -180..180)' });

  const cam = nearestCam(lat, lon);
  res.json({ id: cam.id, name: cam.name, credit: cam.credit, creditUrl: cam.creditUrl });
});

router.get('/sky', async (req: Request, res: Response) => {
  const id = typeof req.query.cam === 'string' ? req.query.cam : SKY_CAMS[0].id;
  const cam = getCam(id);
  if (!cam) return res.status(404).json({ error: `unknown cam: ${id}` });

  try {
    const { entry, stale } = await getEntry(cam);
    const sun = solarPosition(cam.lat, cam.lon, new Date(entry.asOf));
    res.json({
      cam: { id: cam.id, name: cam.name, credit: cam.credit, creditUrl: cam.creditUrl },
      asOf: entry.asOf,
      stale,
      sun: {
        elevation: Number(sun.elevation.toFixed(1)),
        azimuth: Number(sun.azimuth.toFixed(1)),
        // Computed from full-precision values, before the display rounding above.
        phase: solarPhase(sun.elevation, sun.azimuth),
      },
      hero: entry.reading.hero,
      bands: entry.reading.bands,
    });
  } catch (err) {
    console.error('sky: no reading available:', err);
    res.status(503).json({ error: 'sky reading unavailable' });
  }
});

router.get('/sky/frame/:camId', async (req: Request, res: Response) => {
  const cam = getCam(req.params.camId);
  if (!cam) return res.status(404).json({ error: 'unknown cam' });
  try {
    const { entry } = await getEntry(cam);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(entry.jpeg);
  } catch {
    res.status(503).end();
  }
});

export default router;
