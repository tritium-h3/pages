import { analyzeSky, type SkyReading } from './sky-frame.js';
import type { SkyCam } from './sky-cams.js';

const USER_AGENT = 'pages-sky/1.0 (https://samarkand.hopto.org)';
// Source publishes every ~15 min; never poll faster than this.
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

export type CacheEntry = {
  fetchedAt: number;
  /** Source Last-Modified — the real "as of", not our fetch time. */
  asOf: string;
  jpeg: Buffer;
  etag?: string;
  lastModified?: string;
  reading: SkyReading;
};

const cache = new Map<string, CacheEntry>();

/** Test seam. Not used in production. */
export function __clearCache(): void {
  cache.clear();
}

async function refresh(cam: SkyCam): Promise<CacheEntry> {
  const prev = cache.get(cam.id);

  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  // Conditional request: don't re-download a frame that hasn't changed.
  if (prev?.etag) headers['If-None-Match'] = prev.etag;
  if (prev?.lastModified) headers['If-Modified-Since'] = prev.lastModified;

  const resp = await fetch(cam.url, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (resp.status === 304 && prev) {
    const touched = { ...prev, fetchedAt: Date.now() };
    cache.set(cam.id, touched);
    return touched;
  }
  if (!resp.ok) throw new Error(`cam fetch failed: ${resp.status}`);

  const jpeg = Buffer.from(await resp.arrayBuffer());
  const lastModified = resp.headers.get('last-modified') ?? undefined;
  // A page whose entire point is "the sky right now" must never state a
  // timestamp that isn't the photo's own. If the source doesn't tell us when
  // the frame was taken (or tells us something we can't parse), we'd rather
  // fail this refresh — getEntry() will fall back to the last known-good
  // reading (marked stale) instead of us guessing with our fetch time.
  if (!lastModified) {
    throw new Error('cam response has no Last-Modified; refusing to fake asOf');
  }
  const asOfDate = new Date(lastModified);
  if (Number.isNaN(asOfDate.getTime())) {
    throw new Error(`cam response has unparseable Last-Modified "${lastModified}"; refusing to fake asOf`);
  }
  const entry: CacheEntry = {
    fetchedAt: Date.now(),
    asOf: asOfDate.toISOString(),
    jpeg,
    etag: resp.headers.get('etag') ?? undefined,
    lastModified,
    reading: await analyzeSky(jpeg, cam.skyMask),
  };
  cache.set(cam.id, entry);
  return entry;
}

/** Cached entry if fresh; otherwise refresh. Falls back to stale on failure. */
export async function getEntry(cam: SkyCam): Promise<{ entry: CacheEntry; stale: boolean }> {
  const cached = cache.get(cam.id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { entry: cached, stale: false };
  }
  try {
    return { entry: await refresh(cam), stale: false };
  } catch (err) {
    // Serve the last good reading with its real age rather than a spinner or a
    // fabricated colour. If we have nothing at all, the caller 503s.
    if (cached) {
      console.error(`sky: refresh failed for ${cam.id}, serving stale:`, err);
      return { entry: cached, stale: true };
    }
    throw err;
  }
}
