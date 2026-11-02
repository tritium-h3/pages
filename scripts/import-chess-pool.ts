// Imports watchable games from the Lichess open database into
// data/chess-voices/games.jsonl. Streams a monthly dump through `zstd -d` and
// stops once it has enough, so it downloads a fraction of the ~29 GB file.
//
//   npm run chess:pool             newest month
//   npm run chess:pool -- 2026-08  a specific month
//   CHESS_POOL_SIZE=50000 npm run chess:pool
import { spawn } from 'node:child_process';
import { createWriteStream, promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import path from 'node:path';
import { DATA_DIR } from '../src/platform/server/storage.js';
import { PgnSplitter, toRecord, type PgnGame } from '../src/experiments/chess-voices/server/pgn.js';

const BASE = 'https://database.lichess.org/standard';
const TARGET = Number(process.env.CHESS_POOL_SIZE ?? 200_000);

async function latestDump(): Promise<string> {
  const res = await fetch(`${BASE}/counts.txt`);
  if (!res.ok) throw new Error(`counts.txt: HTTP ${res.status}`);
  const names = (await res.text()).trim().split('\n').map(l => l.split(/\s+/)[0]).filter(Boolean);
  return names.sort().at(-1)!;
}

async function main() {
  const month = process.argv[2];
  const file = month ? `lichess_db_standard_rated_${month}.pgn.zst` : await latestDump();
  const outDir = path.join(DATA_DIR, 'chess-voices');
  await fs.mkdir(outDir, { recursive: true });
  const finalPath = path.join(outDir, 'games.jsonl');
  const tmpPath = `${finalPath}.tmp`;
  const out = createWriteStream(tmpPath);

  console.log(`Streaming ${file}; keeping up to ${TARGET} games…`);
  const abort = new AbortController();
  const res = await fetch(`${BASE}/${file}`, { signal: abort.signal });
  if (!res.ok || !res.body) throw new Error(`${file}: HTTP ${res.status}`);

  const zstd = spawn('zstd', ['-dc'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const body = Readable.fromWeb(res.body as unknown as NodeReadableStream);
  // Stopping early tears these down mid-stream; that's expected, not an error.
  body.on('error', () => {});
  zstd.stdin.on('error', () => {});
  body.pipe(zstd.stdin);

  const splitter = new PgnSplitter();
  let kept = 0;
  let seen = 0;
  const consider = (game: PgnGame) => {
    seen++;
    const record = toRecord(game.headers, game.movetext);
    if (record) {
      out.write(`${JSON.stringify(record)}\n`);
      kept++;
    }
    if (seen % 100_000 === 0) console.log(`  ${seen} games read, ${kept} kept`);
  };

  for await (const line of createInterface({ input: zstd.stdout, crlfDelay: Infinity })) {
    const game = splitter.push(line);
    if (game) consider(game);
    if (kept >= TARGET) break;
  }
  if (kept < TARGET) {
    const last = splitter.flush();
    if (last) consider(last);
  }

  abort.abort();
  zstd.kill();
  await new Promise<void>(resolve => out.end(resolve));
  await fs.rename(tmpPath, finalPath);
  console.log(`Kept ${kept} of ${seen} games from ${file} → ${finalPath}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
