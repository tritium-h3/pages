import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { getEntry, __clearCache } from './sky-source.js';
import type { SkyCam } from './sky-cams.js';

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const DUSK = readFileSync(path.join(__dirname_, '__fixtures__', 'bluehill-2026-07-16-dusk.jpg'));

const CAM: SkyCam = {
  id: 'test-cam',
  name: 'Test Cam',
  url: 'https://example.invalid/sky.jpg',
  lat: 42.2119,
  lon: -71.1144,
  credit: 'Test',
  creditUrl: 'https://example.invalid',
  skyMask: { top: 0, bottom: 175 },
};

const LM = 'Fri, 17 Jul 2026 00:16:14 GMT';

const jpegResponse = () =>
  new Response(DUSK, {
    status: 200,
    headers: { 'content-type': 'image/jpeg', 'last-modified': LM, etag: '"abc"' },
  });

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-07-17T00:20:00Z')); });
beforeEach(() => __clearCache());
afterEach(() => vi.unstubAllGlobals());

describe('getEntry', () => {
  it('fetches, analyses, and reports the source Last-Modified as asOf', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jpegResponse()));
    const { entry, stale } = await getEntry(CAM);
    expect(stale).toBe(false);
    expect(entry.asOf).toBe('2026-07-17T00:16:14.000Z'); // source time, not fetch time
    expect(entry.reading.hero.name).toBe('Icelandic Blue');
  });

  it('serves from cache without a second fetch inside the TTL', async () => {
    const spy = vi.fn(async () => jpegResponse());
    vi.stubGlobal('fetch', spy);
    await getEntry(CAM);
    await getEntry(CAM);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('sends conditional headers and reuses the cached reading on 304', async () => {
    let callCount = 0;
    const spy = vi.fn(async (_url: string, init: RequestInit) => {
      callCount += 1;
      // Decide behaviour by call index, not by whether headers were sent —
      // otherwise a regression that drops the validators would silently take
      // the "first call" branch forever and this test would never notice.
      if (callCount === 1) return jpegResponse();
      const h = init.headers as Record<string, string>;
      expect(h['If-None-Match']).toBe('"abc"');
      expect(h['If-Modified-Since']).toBe(LM);
      return new Response(null, { status: 304 });
    });
    vi.stubGlobal('fetch', spy);

    const first = await getEntry(CAM);
    vi.setSystemTime(Date.now() + 6 * 60 * 1000); // expire the TTL
    const { entry, stale } = await getEntry(CAM);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(stale).toBe(false);
    expect(entry.reading.hero.name).toBe('Icelandic Blue'); // reused, not re-analysed
    // Reference-identity proves the cached objects were reused, not
    // recomputed — a re-fetch-and-reanalyse would produce new objects even
    // with byte-identical fixture content.
    expect(entry.jpeg).toBe(first.entry.jpeg);
    expect(entry.reading).toBe(first.entry.reading);
    vi.useRealTimers();
  });

  it('falls back to the last good reading when refresh fails', async () => {
    const spy = vi
      .fn()
      .mockImplementationOnce(async () => jpegResponse())
      .mockImplementationOnce(async () => { throw new Error('network down'); });
    vi.stubGlobal('fetch', spy);

    await getEntry(CAM);
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    const { entry, stale } = await getEntry(CAM);

    expect(stale).toBe(true);
    expect(entry.asOf).toBe('2026-07-17T00:16:14.000Z'); // real age, not faked
    expect(entry.reading.hero.name).toBe('Icelandic Blue');
    vi.useRealTimers();
  });

  it('throws when refresh fails and there is nothing cached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(getEntry(CAM)).rejects.toThrow();
  });

  it('throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    await expect(getEntry(CAM)).rejects.toThrow(/500/);
  });

  it('rejects when the response has no Last-Modified and nothing is cached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(DUSK, { status: 200, headers: { 'content-type': 'image/jpeg' } })),
    );
    await expect(getEntry(CAM)).rejects.toThrow(/Last-Modified/);
  });

  it('serves stale with the original asOf when a refresh has no Last-Modified', async () => {
    const spy = vi
      .fn()
      .mockImplementationOnce(async () => jpegResponse())
      .mockImplementationOnce(
        async () => new Response(DUSK, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      );
    vi.stubGlobal('fetch', spy);

    await getEntry(CAM);
    vi.setSystemTime(Date.now() + 6 * 60 * 1000); // expire the TTL
    const { entry, stale } = await getEntry(CAM);

    expect(stale).toBe(true);
    expect(entry.asOf).toBe('2026-07-17T00:16:14.000Z'); // real history, not a fake fetch-time
    vi.useRealTimers();
  });
});
