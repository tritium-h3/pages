import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRouter, type Deps } from './index.js';
import type { Llm } from './generator.js';
import type { ChessVoicesEvent } from '../types.js';

const GAME = {
  id: 'abc', white: 'w', black: 'b', whiteElo: 2000, blackElo: 2000, result: '1-0', opening: 'Italian',
  moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'],
};

let dir: string;
let pool: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chess-voices-'));
  pool = path.join(dir, 'games.jsonl');
  await fs.writeFile(pool, `${JSON.stringify(GAME)}\n${JSON.stringify(GAME)}\n`);
});
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

async function serve(deps: Deps): Promise<{ base: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use('/api/chess-voices', createRouter(deps));
  const server: http.Server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}/api/chess-voices`,
    close: () => new Promise(r => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

/** Reads SSE events until `stop` says so or the stream ends. */
async function readEvents(res: Response, stop: (e: ChessVoicesEvent) => boolean = () => false) {
  const events: ChessVoicesEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop()!;
    for (const part of parts) {
      if (!part.startsWith('data: ')) continue;
      const e = JSON.parse(part.slice(6)) as ChessVoicesEvent;
      events.push(e);
      if (stop(e)) { await reader.cancel(); return events; }
    }
  }
  return events;
}

const fakeLlm: Llm = async ({ prompt }) => (prompt.includes('character note') ? 'A card.' : 'A thought.');

describe('GET /game', () => {
  it('answers 503 with instructions when there is no pool', async () => {
    const app = await serve({ poolFile: path.join(dir, 'missing.jsonl'), llm: fakeLlm });
    const res = await fetch(`${app.base}/game`);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/npm run chess:pool/);
    await app.close();
  });

  it('streams a game, gated by /progress, through to done', async () => {
    const app = await serve({ poolFile: pool, llm: fakeLlm });
    const res = await fetch(`${app.base}/game`);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    let session = '';
    const reports: Promise<unknown>[] = [];
    const events = await readEvents(res, e => {
      if (e.type === 'game') session = e.session;
      // play along: report each ply as soon as it is ready
      if (e.type === 'ply-ready') {
        reports.push(fetch(`${app.base}/progress`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, ply: e.ply }),
        }));
      }
      return false;
    });
    expect(events[0]).toMatchObject({ type: 'game', id: 'abc', opening: 'Italian' });
    expect(events[0]).not.toHaveProperty('result');
    expect(events.filter(e => e.type === 'ply-ready')).toHaveLength(7);
    expect(events.at(-1)).toEqual({ type: 'done', result: '1-0' });
    await Promise.all(reports);
    await app.close();
  });

  it('stops calling the model once the client goes away', async () => {
    let calls = 0;
    const slowLlm: Llm = async (_p, _t, signal) => {
      calls++;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 20);
        signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
      });
      return 'x';
    };
    const app = await serve({ poolFile: pool, llm: slowLlm });
    const res = await fetch(`${app.base}/game`);
    await readEvents(res, e => e.type === 'thought');
    const atDisconnect = calls;
    await new Promise(r => setTimeout(r, 200));
    expect(calls).toBeLessThanOrEqual(atDisconnect + 1);
    await app.close();
  });
});

describe('POST /progress', () => {
  it('404s for an unknown session', async () => {
    const app = await serve({ poolFile: pool, llm: fakeLlm });
    const res = await fetch(`${app.base}/progress`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: 'nope', ply: 3 }),
    });
    expect(res.status).toBe(404);
    await app.close();
  });
});
