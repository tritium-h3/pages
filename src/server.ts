import 'dotenv/config';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';

import { corsOrigins, PORTS } from './platform/config.js';
import { ensureDataDir } from './platform/server/storage.js';
import type { SliceServer } from './platform/server/slice.js';

// Legacy routers — moved into slices by Tasks 9-17, one per task.
import todosRouter, { initTodoStorage } from './backend/routes/todos.js';
import mbtaRouter from './backend/routes/mbta.js';
import llmDuoChatRouter, { initLLMDuoChatWebSocket } from './backend/routes/llm-duo-chat.js';
import wikipediaStoryRouter from './backend/routes/wikipedia-story.js';
import spriteGroupsRouter from './backend/routes/sprite-groups.js';
import imageHuntRouter from './backend/routes/image-hunt.js';
import { initSessionStorage } from './backend/image-hunt-sessions.js';
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

// --- Legacy flat mounts. Each disappears as its slice migrates. ---
app.use('/api', todosRouter);
app.use('/api', llmDuoChatRouter);
app.use('/api', wikipediaStoryRouter);
app.use('/api', spriteGroupsRouter);
app.use('/api', mbtaRouter);
app.use('/api', imageHuntRouter);
app.use('/api', skyRouter);

// Error handler. Express identifies these by an arity of four — the previous
// version took three parameters and so was registered as ordinary middleware
// that never fired.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);

async function start(): Promise<void> {
  await ensureDataDir();

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

  // Legacy init, removed as slices migrate.
  await Promise.all([
    initTodoStorage().catch(e => console.error('[legacy todos] init failed:', e)),
    initSessionStorage().catch(e => console.error('[legacy image-hunt] init failed:', e)),
  ]);
  initLLMDuoChatWebSocket(server);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
    if (unavailable.size > 0) {
      console.warn(`Disabled experiments: ${[...unavailable].join(', ')}`);
    }
  });
}

start();

export { mount };
