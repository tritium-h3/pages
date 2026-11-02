import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { SliceServer } from '../../../platform/server/slice.js';
import { ollama } from '../../../platform/server/ollama.js';
import { POOL_FILE, readRandomLine, parseRecord } from './pool.js';
import { analyzeGame, type Analysis } from './replay.js';
import { runGame, Progress, type Llm } from './generator.js';
import type { ChessVoicesEvent, GameRecord } from '../types.js';

const MODEL = 'qwen3:14b';
const DRAW_ATTEMPTS = 5;

const ollamaLlm: Llm = ({ system, prompt }, temperature, signal) =>
  ollama.generate({ model: MODEL, system, prompt, keep_alive: '60m', think: false, options: { temperature } }, signal);

export interface Deps {
  poolFile: string;
  llm: Llm;
}

type Draw = { record: GameRecord; analysis: Analysis } | 'no-pool' | 'none-playable';

async function drawPlayable(poolFile: string): Promise<Draw> {
  for (let i = 0; i < DRAW_ATTEMPTS; i++) {
    const line = await readRandomLine(poolFile);
    if (line === null) return 'no-pool';
    const record = parseRecord(line);
    if (!record) continue;
    try {
      return { record, analysis: analyzeGame(record.moves) };
    } catch {
      // an illegal move somewhere in the record; draw another
    }
  }
  return 'none-playable';
}

export function createRouter({ poolFile, llm }: Deps): Router {
  const router = Router();
  /** live games, by session id, so /progress can reach their generator */
  const sessions = new Map<string, Progress>();

  router.get('/game', async (_req: Request, res: Response) => {
    const drawn = await drawPlayable(poolFile);
    if (drawn === 'no-pool') {
      res.status(503).json({ error: 'No games yet. Run `npm run chess:pool` on the server to import some.' });
      return;
    }
    if (drawn === 'none-playable') {
      res.status(500).json({ error: "Couldn't find a playable game in the pool." });
      return;
    }

    const { record, analysis } = drawn;
    const session = randomUUID();
    const progress = new Progress();
    sessions.set(session, progress);

    // res 'close', not req 'close': on current Node the request side can close
    // as soon as its (empty) body is read, which would abort every game at once.
    const abort = new AbortController();
    res.on('close', () => {
      abort.abort();
      sessions.delete(session);
    });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const emit = (event: ChessVoicesEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const { id, white, black, whiteElo, blackElo, opening, moves } = record;
    emit({ type: 'game', session, id, white, black, whiteElo, blackElo, opening, moves });

    try {
      await runGame({ analysis, result: record.result, llm, emit, progress, signal: abort.signal });
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error('[chess-voices] generation failed:', err);
        emit({ type: 'error', message: 'Generation failed.' });
      }
    }
    res.end();
  });

  router.post('/progress', (req: Request, res: Response) => {
    const { session, ply } = (req.body ?? {}) as { session?: unknown; ply?: unknown };
    const progress = typeof session === 'string' ? sessions.get(session) : undefined;
    if (!progress || typeof ply !== 'number') {
      res.status(404).end();
      return;
    }
    progress.set(ply);
    res.status(204).end();
  });

  return router;
}

const slice: SliceServer = { router: createRouter({ poolFile: POOL_FILE, llm: ollamaLlm }) };
export default slice;
