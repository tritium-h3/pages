import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRandomLine, parseRecord } from './pool.js';

let dir: string;
let file: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chess-pool-'));
  file = path.join(dir, 'games.jsonl');
  await fs.writeFile(file, 'first\nsecond\nthird\n');
});
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

describe('readRandomLine', () => {
  it('returns the line after the random offset', async () => {
    expect(await readRandomLine(file, () => 0)).toBe('second');
    expect(await readRandomLine(file, () => 0.45)).toBe('third');
  });

  it('wraps to the first line when the offset lands in the last line', async () => {
    expect(await readRandomLine(file, () => 0.99)).toBe('first');
  });

  it('returns null for a missing file', async () => {
    expect(await readRandomLine(path.join(dir, 'nope.jsonl'))).toBeNull();
  });

  it('returns null for an empty file', async () => {
    const empty = path.join(dir, 'empty.jsonl');
    await fs.writeFile(empty, '');
    expect(await readRandomLine(empty)).toBeNull();
  });
});

describe('parseRecord', () => {
  it('parses a record with moves', () => {
    expect(parseRecord('{"id":"x","moves":["e4"]}')).toMatchObject({ id: 'x' });
  });

  it.each(['not json', '{"id":"x"}', '{"id":"x","moves":[]}'])('rejects %s', line => {
    expect(parseRecord(line)).toBeNull();
  });
});
