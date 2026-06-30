import { Router, Request, Response } from 'express';
import { ollama } from '../ollama.js';

const router = Router();

const COMMONS_RANDOM_URL =
  'https://commons.wikimedia.org/w/api.php?action=query&generator=random' +
  '&grnnamespace=6&grnlimit=1&prop=imageinfo&iiprop=url|mime|size' +
  '&iiurlwidth=768&format=json&origin=*';

const USER_AGENT = 'pages-image-hunt/1.0 (https://samarkand.hopto.org)';
const DEFAULT_MODEL = 'qwen3-vl:30b';
// Hard ceiling on a single judgement. Generous enough for a large model to
// cold-load on its first call, but bounded so a slow/stuck Ollama can never hang
// a scan loop forever (which previously let zombie loops flood and wedge Ollama).
const JUDGE_TIMEOUT_MS = 180_000;

interface CommonsImage {
  title: string;
  mime: string;
  thumbUrl: string;
  pageUrl: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRandomCommonsImage(signal: AbortSignal): Promise<CommonsImage | null> {
  const resp = await fetch(COMMONS_RANDOM_URL, { headers: { 'User-Agent': USER_AGENT }, signal });
  if (!resp.ok) throw new Error(`Commons fetch failed: ${resp.status}`);
  const data = (await resp.json()) as {
    query?: {
      pages?: Record<string, {
        title: string;
        imageinfo?: Array<{ mime: string; thumburl?: string; url: string; descriptionurl: string }>;
      }>;
    };
  };
  const pages = data.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  const info = page?.imageinfo?.[0];
  if (!page || !info) return null;
  return {
    title: page.title,
    mime: info.mime,
    thumbUrl: info.thumburl ?? info.url,
    pageUrl: info.descriptionurl,
  };
}

async function fetchImageAsBase64(url: string, signal: AbortSignal): Promise<string> {
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal });
  if (!resp.ok) throw new Error(`Image download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString('base64');
}

interface Verdict { match: boolean; reason: string; }

function parseVerdict(raw: string): Verdict {
  // The model is asked for a bare JSON object, but extract the {...} span
  // defensively in case it ever wraps the JSON in prose or code fences.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return { match: false, reason: '' };
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as { match?: unknown; reason?: unknown };
    return {
      match: Boolean(obj.match),
      reason: typeof obj.reason === 'string' ? obj.reason : '',
    };
  } catch {
    return { match: false, reason: '' };
  }
}

async function judgeImage(
  model: string,
  description: string,
  base64: string,
  signal: AbortSignal,
): Promise<Verdict> {
  const prompt = `You are judging whether an image matches a description.
Description: "${description}"
Does the image match this description?
Respond ONLY with a JSON object of the form {"match": true or false, "reason": "<one short sentence explaining why>"}.`;
  // Abort the inference if the client disconnects OR it exceeds the time ceiling.
  const combined = AbortSignal.any([signal, AbortSignal.timeout(JUDGE_TIMEOUT_MS)]);
  // NOTE: no `format: 'json'` — it makes qwen3-vl:30b return an empty string.
  // The prompt alone reliably yields a bare JSON object, which parseVerdict reads.
  const raw = await ollama.generate({
    model,
    prompt,
    images: [base64],
    keep_alive: '60m',
  }, combined);
  return parseVerdict(raw);
}

// Lists vision-capable models for the UI dropdown.
router.get('/image-hunt/models', async (_req: Request, res: Response) => {
  try {
    const models = await ollama.listVisionModels();
    res.json({ models, default: DEFAULT_MODEL });
  } catch (err) {
    console.error('failed to list vision models:', err);
    res.status(500).json({ error: 'Failed to list models' });
  }
});

router.get('/image-hunt', async (req: Request, res: Response) => {
  const description = String(req.query.description ?? '').trim();
  if (!description) {
    res.status(400).json({ error: 'description query parameter is required' });
    return;
  }
  const model = String(req.query.model ?? '').trim() || DEFAULT_MODEL;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Tie the scan loop to the connection lifecycle: when the client disconnects
  // (Stop button, reload, navigate away), abort any in-flight fetch immediately
  // so the loop exits at once instead of running to completion against Ollama.
  let closed = false;
  const controller = new AbortController();
  const onClose = () => {
    if (closed) return; // req and res both emit 'close'; act once
    closed = true;
    controller.abort();
  };
  req.on('close', onClose);
  res.on('close', onClose);

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let attempts = 0;
  let matchId = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5; // ~persistent Commons/Ollama outage -> give up

  while (!closed) {
    attempts++;
    try {
      const image = await fetchRandomCommonsImage(controller.signal);
      if (closed) break;
      if (!image) {
        send('checking', { attempts, title: '(no image)' });
        await sleep(300); // throttle: no slow model call happened this iteration
        continue;
      }
      if (!image.mime.startsWith('image/')) {
        send('checking', { attempts, title: image.title });
        await sleep(300); // throttle: skipped non-image, no model call
        continue;
      }
      send('checking', { attempts, title: image.title }); // show before the slow judge
      const base64 = await fetchImageAsBase64(image.thumbUrl, controller.signal);
      if (closed) break;
      const verdict = await judgeImage(model, description, base64, controller.signal);
      if (closed) break;
      if (verdict.match) {
        send('match', {
          id: String(++matchId),
          thumbUrl: image.thumbUrl,
          pageUrl: image.pageUrl,
          title: image.title,
          reason: verdict.reason,
        });
      }
      consecutiveFailures = 0; // a full successful iteration clears the failure streak
    } catch (err) {
      // A disconnect aborts the in-flight fetch; that's a clean exit, not a failure.
      if (closed) break;
      console.error('image-hunt iteration error:', err);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // Transient blips are tolerated above; a sustained streak is terminal.
        send('error', { message: 'Repeated failures (Commons or Ollama may be unreachable). Stopping.' });
        break;
      }
      send('checking', { attempts, title: '(error, skipped)' });
      await sleep(500); // throttle on error so we don't spin
    }
  }

  res.end();
});

export default router;
