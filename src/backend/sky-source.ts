import { analyzeSky, type SkyReading } from './sky-frame.js';
import type { SkyCam } from './sky-cams.js';
import { fetchFrame } from './frame-sources.js';

// Source publishes every ~15 min; never poll faster than this.
const CACHE_TTL_MS = 5 * 60 * 1000;

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

  // How the bytes are obtained (static URL, latest-on-a-page, ...) is the frame
  // source's job; here we only cache and analyse the result.
  const frame = await fetchFrame(cam, prev);

  if (!frame.changed) {
    // Source confirmed nothing changed (304). Reuse the last good reading.
    if (!prev) throw new Error(`cam ${cam.id}: source reported not-modified but nothing is cached`);
    const touched = { ...prev, fetchedAt: Date.now() };
    cache.set(cam.id, touched);
    return touched;
  }

  const entry: CacheEntry = {
    fetchedAt: Date.now(),
    asOf: frame.asOf,
    jpeg: frame.jpeg,
    etag: frame.etag,
    lastModified: frame.lastModified,
    reading: await analyzeSky(frame.jpeg, cam.skyMask),
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
