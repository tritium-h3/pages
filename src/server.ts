import 'dotenv/config';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';

import { corsOrigins, PORTS } from './platform/config.js';
import { ensureDataDir } from './platform/server/storage.js';
import type { SliceServer } from './platform/server/slice.js';

import todoSlice from './experiments/todo/server/index.js';
import transitSlice from './experiments/transit/server/index.js';
import wikistorySlice from './experiments/wikistory/server/index.js';
import imageHuntSlice from './experiments/image-hunt/server/index.js';
import llmDuoChatSlice from './experiments/llm-duo-chat/server/index.js';
import spritesSlice from './experiments/sprites/server/index.js';

// Legacy routers — moved into slices by Tasks 9-17, one per task.
import skyRouter from './backend/routes/sky.js';

const app: Express = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : PORTS.api;

app.use(cors({ origin: corsOrigins(), credentials: true }));
app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.get('origin')}`);
  next();
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api', (_req: Request, res: Response) => {
  res.json({ message: 'Backend API is running' });
});

/** Slices registered for mounting, keyed by manifest id. */
const slices: Array<{ id: string; slice: SliceServer }> = [];

/** Slices whose init() rejected. Their routes answer 503 rather than taking the
 *  whole server down — pages.service has Restart=always, so a throw at startup
 *  would otherwise loop every 3 seconds and take every experiment offline. */
const unavailable = new Set<string>();

function mount(id: string, slice: SliceServer): void {
  slices.push({ id, slice });
  app.use(`/api/${id}`, (req: Request, res: Response, next: NextFunction) => {
    if (unavailable.has(id)) {
      res.status(503).json({ error: `Experiment '${id}' failed to start` });
      return;
    }
    next();
  }, slice.router);
}

mount('todo', todoSlice);
mount('transit', transitSlice);
mount('wikistory', wikistorySlice);
mount('image-hunt', imageHuntSlice);
mount('llm-duo-chat', llmDuoChatSlice);
mount('sprites', spritesSlice);

// --- Legacy flat mounts. Each disappears as its slice migrates. ---
app.use('/api', skyRouter);

interface HttpError extends Error {
  status?: number;
  statusCode?: number;
}

// Error handler. Express identifies these by an arity of four — the previous
// version took three parameters and so was registered as ordinary middleware
// that never fired.
app.use((err: HttpError, _req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  if (res.headersSent) {
    // Response already started (e.g. mid-stream on an SSE route) — res.status()
    // would throw ERR_HTTP_HEADERS_SENT. Hand off to Express's default handler,
    // which just terminates the connection.
    next(err);
    return;
  }
  const status = err.status ?? err.statusCode ?? 500;
  res.status(status).json({
    error: status < 500 ? err.message : 'Internal server error',
  });
});

const server = http.createServer(app);

async function initAll(): Promise<void> {
  try {
    await ensureDataDir();
  } catch (error) {
    console.error('[host] could not create data dir; storage-backed slices will fail:', error);
  }

  for (const { id, slice } of slices) {
    if (!slice.init) continue;
    try {
      await slice.init();
    } catch (error) {
      unavailable.add(id);
      console.error(`[${id}] init failed; experiment disabled:`, error);
    }
  }

  for (const { id, slice } of slices) {
    if (unavailable.has(id) || !slice.attach) continue;
    try {
      slice.attach(server);
    } catch (error) {
      unavailable.add(id);
      console.error(`[${id}] attach failed; experiment disabled:`, error);
    }
  }
}

/** `listen` must be reached no matter what initialisation did. pages.service
 *  sets Restart=always with RestartSec=3, so any throw before listen becomes a
 *  silent three-second restart loop that takes every experiment offline —
 *  the exact failure the per-slice isolation above exists to prevent. */
async function start(): Promise<void> {
  try {
    await initAll();
  } catch (error) {
    console.error('[host] startup init failed; serving anyway:', error);
  }

  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(`[host] http server error (${error.code ?? 'unknown'}):`, error.message);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
    if (unavailable.size > 0) {
      console.warn(`Disabled experiments: ${[...unavailable].join(', ')}`);
    }
  });
}

start().catch(error => {
  console.error('[host] unrecoverable startup failure:', error);
  process.exitCode = 1;
});

export { mount };
