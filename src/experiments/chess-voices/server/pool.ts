import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../../platform/server/storage.js';
import type { GameRecord } from '../types.js';

export const POOL_FILE = path.join(DATA_DIR, 'chess-voices', 'games.jsonl');

const CHUNK = 64 * 1024;

/** One random complete line, or null when the file is missing or empty.
 *  Jumps to a random byte and takes the line after it (wrapping to the first
 *  line past the end), so the pool never has to be loaded or indexed. */
export async function readRandomLine(file: string, rand: () => number = Math.random): Promise<string | null> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(file, 'r');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return null;

    const buf = Buffer.alloc(CHUNK);
    const readAt = async (pos: number) => {
      const { bytesRead } = await handle.read(buf, 0, CHUNK, pos);
      return buf.subarray(0, bytesRead);
    };

    const offset = Math.floor(rand() * size);
    const nl = (await readAt(offset)).indexOf(0x0a);
    const start = nl !== -1 && offset + nl + 1 < size ? offset + nl + 1 : 0;

    const chunk = await readAt(start);
    const end = chunk.indexOf(0x0a);
    const line = (end === -1 ? chunk : chunk.subarray(0, end)).toString('utf8').trim();
    return line || null;
  } finally {
    await handle.close();
  }
}

export function parseRecord(line: string): GameRecord | null {
  try {
    const rec = JSON.parse(line) as GameRecord;
    return Array.isArray(rec.moves) && rec.moves.length > 0 ? rec : null;
  } catch {
    return null;
  }
}
