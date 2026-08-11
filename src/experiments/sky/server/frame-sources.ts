// ---------------------------------------------------------------------------
// Frame sources: the pluggable "how do we obtain a cam's current frame" layer.
// Each source, given a cam and the validators from our last good frame, returns
// either fresh JPEG bytes + a real timestamp, or { changed: false } when the
// source confirms nothing has changed (an HTTP 304). sky-source.ts owns the
// cache and stale-fallback; it never cares *how* the bytes were obtained.
//
// Adding a pattern (e.g. extracting a frame from a gif or a video stream) means
// adding one handler and one `kind` — nothing in the cache layer changes.
// ---------------------------------------------------------------------------

import type { SkyCam } from './sky-cams.js';

const USER_AGENT = 'pages-sky/1.0 (https://samarkand.hopto.org)';
const FETCH_TIMEOUT_MS = 15_000;

/** The conditional-request validators carried over from our last good frame. */
export type FrameValidators = { etag?: string; lastModified?: string };

/** A fresh frame, or a signal that the source is unchanged since `prev`. */
export type FrameFetch =
  | { changed: true; jpeg: Buffer; asOf: string; etag?: string; lastModified?: string }
  | { changed: false };

/**
 * Conditional GET of a JPEG URL — the shared HTTP core every source ends up
 * using. Returns { changed: false } on 304; otherwise fresh bytes plus a real
 * `asOf` taken from Last-Modified. It refuses to fabricate a timestamp: a page
 * whose whole point is "the sky right now" must never claim a time that isn't
 * the photo's own, so a missing/unparseable Last-Modified throws and lets the
 * caller fall back to the last known-good reading (marked stale).
 */
export async function fetchImage(url: string, prev: FrameValidators | undefined): Promise<FrameFetch> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (prev?.etag) headers['If-None-Match'] = prev.etag;
  if (prev?.lastModified) headers['If-Modified-Since'] = prev.lastModified;

  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

  if (resp.status === 304) {
    if (prev) return { changed: false };
    throw new Error('cam fetch failed: 304'); // 304 with nothing to reuse — treat as an error
  }
  if (!resp.ok) throw new Error(`cam fetch failed: ${resp.status}`);

  const jpeg = Buffer.from(await resp.arrayBuffer());
  const lastModified = resp.headers.get('last-modified') ?? undefined;
  if (!lastModified) {
    throw new Error('cam response has no Last-Modified; refusing to fake asOf');
  }
  const asOfDate = new Date(lastModified);
  if (Number.isNaN(asOfDate.getTime())) {
    throw new Error(`cam response has unparseable Last-Modified "${lastModified}"; refusing to fake asOf`);
  }
  return {
    changed: true,
    jpeg,
    asOf: asOfDate.toISOString(),
    etag: resp.headers.get('etag') ?? undefined,
    lastModified,
  };
}

// --- the strategies ---------------------------------------------------------

/** static: the cam's `url` is the image; fetch it directly. */
async function fromStatic(cam: SkyCam, prev: FrameValidators | undefined): Promise<FrameFetch> {
  if (!cam.url) throw new Error(`cam ${cam.id}: static source needs a url`);
  return fetchImage(cam.url, prev);
}

/**
 * latestFromPage: the cam publishes frames at timestamped URLs with no stable
 * alias, so read the listing page, take the newest matching path (timestamped
 * paths sort chronologically, so the last match wins), then fetch that image.
 */
async function fromLatestOnPage(cam: SkyCam, prev: FrameValidators | undefined): Promise<FrameFetch> {
  if (cam.source?.kind !== 'latestFromPage') throw new Error(`cam ${cam.id}: wrong source`);
  const { pageUrl, imageBase, pattern } = cam.source;

  const pageResp = await fetch(pageUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!pageResp.ok) throw new Error(`cam ${cam.id}: listing page failed: ${pageResp.status}`);

  const html = await pageResp.text();
  const matches = html.match(new RegExp(pattern, 'g'));
  if (!matches || matches.length === 0) {
    throw new Error(`cam ${cam.id}: no frames matching /${pattern}/ on ${pageUrl}`);
  }
  const latest = [...matches].sort().at(-1)!;
  const imageUrl = new URL(latest, imageBase).toString();
  return fetchImage(imageUrl, prev);
}

/**
 * Obtain a cam's current frame via its configured source (default: static).
 * The single dispatch point sky-source.ts calls.
 */
export function fetchFrame(cam: SkyCam, prev: FrameValidators | undefined): Promise<FrameFetch> {
  const kind = cam.source?.kind ?? 'static';
  switch (kind) {
    case 'static':
      return fromStatic(cam, prev);
    case 'latestFromPage':
      return fromLatestOnPage(cam, prev);
    default: {
      const _exhaustive: never = kind;
      throw new Error(`cam ${cam.id}: unknown frame source "${_exhaustive}"`);
    }
  }
}
