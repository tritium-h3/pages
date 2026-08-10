import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/** Resolved from this module's location, not process.cwd(), so the systemd
 *  unit's WorkingDirectory is not load-bearing.
 *  src/platform/server/ -> up three -> repo root. */
export const DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'data',
);

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export interface JsonStore<T> {
  read(): Promise<T>;
  write(value: T): Promise<void>;
}

let writeCounter = 0;

export function createJsonStore<T>(name: string, fallback: T, dir: string = DATA_DIR): JsonStore<T> {
  const file = path.join(dir, `${name}.json`);

  return {
    async read(): Promise<T> {
      try {
        return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
      } catch {
        return fallback;
      }
    },

    async write(value: T): Promise<void> {
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.${writeCounter++}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(value, null, 2));
      await fs.rename(tmp, file);
    },
  };
}
