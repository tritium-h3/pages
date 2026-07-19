import { Router, Request, Response } from 'express';
import { solarPosition, solarPhase } from '../sun.js';
import { SKY_CAMS, getCam } from '../sky-cams.js';
import { getEntry } from '../sky-source.js';

const router = Router();

router.get('/sky/cams', (_req: Request, res: Response) => {
  res.json(
    SKY_CAMS.map(({ id, name, credit, creditUrl }) => ({ id, name, credit, creditUrl }))
  );
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
