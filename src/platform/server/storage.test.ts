import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, constants as fsConstants } from 'fs';
import path from 'path';
import os from 'os';
import { createJsonStore } from './storage.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'store-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createJsonStore', () => {
  it('returns the fallback when the file does not exist', async () => {
    const store = createJsonStore<string[]>('todos', [], dir);
    expect(await store.read()).toEqual([]);
  });

  it('round-trips a value', async () => {
    const store = createJsonStore<{ a: number }>('thing', { a: 0 }, dir);
    await store.write({ a: 42 });
    expect(await store.read()).toEqual({ a: 42 });
  });

  it('throws rather than falling back when the file holds invalid JSON', async () => {
    // The file exists and holds something. Reporting the fallback here would
    // present live-but-corrupt data as empty, and the next write would persist
    // that emptiness over it.
    await fs.writeFile(path.join(dir, 'broken.json'), '{ not json');
    const store = createJsonStore<string[]>('broken', ['fallback'], dir);
    await expect(store.read()).rejects.toThrow();
  });

  it('throws rather than falling back when the file cannot be read', async () => {
    const file = path.join(dir, 'locked.json');
    await fs.writeFile(file, '["real data"]');
    await fs.chmod(file, 0o000);
    const store = createJsonStore<string[]>('locked', ['fallback'], dir);
    try {
      // Skip when the test runs as root, where the mode bits do not apply.
      await fs.access(file, fsConstants.R_OK);
    } catch {
      await expect(store.read()).rejects.toThrow();
    }
    await fs.chmod(file, 0o600);
  });

  it('leaves no temp files behind after a write', async () => {
    const store = createJsonStore<number[]>('nums', [], dir);
    await store.write([1, 2, 3]);
    const entries = await fs.readdir(dir);
    expect(entries).toEqual(['nums.json']);
  });

  it('never leaves a partially written file visible at the target path', async () => {
    const store = createJsonStore<number[]>('big', [], dir);
    const big = Array.from({ length: 20000 }, (_, i) => i);
    await Promise.all([store.write(big), store.write(big), store.write(big)]);
    const parsed = JSON.parse(await fs.readFile(path.join(dir, 'big.json'), 'utf-8'));
    expect(parsed).toHaveLength(20000);
  });

  it('creates the directory if it is missing', async () => {
    const nested = path.join(dir, 'a', 'b');
    const store = createJsonStore<string[]>('x', [], nested);
    await store.write(['ok']);
    expect(await store.read()).toEqual(['ok']);
  });

  it('hands out a fresh fallback copy on every failed read, not a shared reference', async () => {
    const store = createJsonStore<{ id: string }[]>('missing', [], dir);
    const first = await store.read();
    first.push({ id: 'ghost' });
    const second = await store.read();
    expect(second).toEqual([]);
  });
});
