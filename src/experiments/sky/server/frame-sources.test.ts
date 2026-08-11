import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchFrame } from './frame-sources.js';
import type { SkyCam } from './sky-cams.js';

const jpeg = () =>
  new Response(Buffer.from([0xff, 0xd8, 0xff]), {
    status: 200,
    headers: { 'last-modified': 'Sat, 08 Aug 2026 14:03:00 GMT' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('fetchFrame — static', () => {
  const cam: SkyCam = {
    id: 'static-cam', name: 'S', location: 'S', url: 'https://x.example/sky.jpg',
    lat: 0, lon: 0, credit: '', creditUrl: '', skyMask: { top: 0, bottom: 1 },
  };

  it('fetches the cam url directly', async () => {
    const spy = vi.fn(async (_url: string) => jpeg());
    vi.stubGlobal('fetch', spy);
    const r = await fetchFrame(cam, undefined);
    expect(r.changed).toBe(true);
    expect(spy.mock.calls[0][0]).toBe('https://x.example/sky.jpg');
  });

  it('errors clearly if a static cam has no url', async () => {
    await expect(fetchFrame({ ...cam, url: undefined }, undefined)).rejects.toThrow(/needs a url/);
  });
});

describe('fetchFrame — latestFromPage', () => {
  const cam: SkyCam = {
    id: 'vedur-cam', name: 'V', location: 'V',
    source: {
      kind: 'latestFromPage',
      pageUrl: 'https://en.example.is/webcams/hofn/',
      imageBase: 'https://www.example.is',
      pattern: '/photos/camN_hofn/\\d{8}_\\d{4}\\.jpg',
    },
    lat: 0, lon: 0, credit: '', creditUrl: '', skyMask: { top: 0, bottom: 1 },
  };

  // Deliberately out of order; the newest (1403) must win.
  const PAGE = `
    <img src="/photos/camN_hofn/20260808_1343.jpg">
    <img src="/photos/camN_hofn/20260808_1403.jpg">
    <img src="/photos/camN_hofn/20260808_1353.jpg">
  `;

  it('picks the newest listed frame and fetches it against imageBase', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return url.includes('/webcams/hofn/') ? new Response(PAGE, { status: 200 }) : jpeg();
    }));

    const r = await fetchFrame(cam, undefined);

    expect(r.changed).toBe(true);
    if (r.changed) expect(r.asOf).toBe('2026-08-08T14:03:00.000Z');
    expect(calls[0]).toBe('https://en.example.is/webcams/hofn/'); // page first
    expect(calls[1]).toBe('https://www.example.is/photos/camN_hofn/20260808_1403.jpg'); // newest, resolved
  });

  it('passes conditional validators through, so an unchanged frame is a 304 reuse', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/webcams/hofn/')) return new Response(PAGE, { status: 200 });
      const h = init.headers as Record<string, string>;
      expect(h['If-None-Match']).toBe('"abc"');
      return new Response(null, { status: 304 });
    }));
    const r = await fetchFrame(cam, { etag: '"abc"' });
    expect(r.changed).toBe(false);
  });

  it('throws when the page lists no matching frames', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>nothing</html>', { status: 200 })));
    await expect(fetchFrame(cam, undefined)).rejects.toThrow(/no frames matching/);
  });

  it('throws when the listing page itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    await expect(fetchFrame(cam, undefined)).rejects.toThrow(/listing page failed/);
  });
});
