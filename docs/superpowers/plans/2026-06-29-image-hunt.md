# Image Hunt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Image Hunt" page that continuously scans random Wikimedia Commons images with a local vision model (qwen3-vl) and streams description-matching images into a gallery until the user stops.

**Architecture:** A server-side SSE endpoint (`GET /api/image-hunt`) runs the scan loop — fetch random Commons file → judge with Ollama → emit `checking`/`match` events. The React page opens an `EventSource`; closing it (Stop button or unmount) halts the backend loop via `req.on('close')`. Mirrors the existing `wikipedia-story.ts` SSE pattern.

**Tech Stack:** Express + TypeScript backend, Ollama (`qwen3-vl:30b`), React 19 + Tailwind frontend, Vite (rolldown) dev server with `/api` proxy.

## Global Constraints

- **No automated tests** — deliberate decision for this toy project. Verification is manual (typecheck, lint, curl, browser).
- **Source control is the user's job** — do NOT run `git add`/`commit`/`push`. Each task ends at a checkpoint where the user commits.
- Backend listens on **port 5174**; Ollama on **11434**. Frontend reaches the backend via relative URLs through the Vite proxy (`apiUrl()` in `src/frontend/backendApi.ts`) — never hardcode `:5174`.
- Vision model: `qwen3-vl:30b`, `keep_alive: '60m'`.
- After backend edits during an active dev session, restart with `npm run dev:restart` (systemd `pages.service`).
- Follow existing patterns: SSE like `src/backend/routes/wikipedia-story.ts`; page registration like the `pathname === '/x'` branches in `src/frontend/App.jsx`.

---

## File Structure

- **Modify** `src/backend/ollama.ts` — add optional `images` + `format` fields to `OllamaGenerateRequest` (pass-through to `/api/generate`).
- **Create** `src/backend/routes/image-hunt.ts` — SSE route, Commons fetch, base64, vision judgment, scan loop.
- **Modify** `src/backend/index.ts` — import and mount the router.
- **Create** `src/frontend/ImageHunt.tsx` — the page (controls, progress meter, gallery, EventSource lifecycle).
- **Create** `src/frontend/ImageHunt.css` — page styles.
- **Modify** `src/frontend/App.jsx` — route branch + menu button.

---

### Task 1: Add image + format support to the Ollama client

**Files:**
- Modify: `src/backend/ollama.ts` (the `OllamaGenerateRequest` interface)

**Interfaces:**
- Produces: `OllamaGenerateRequest` now accepts `images?: string[]` (base64) and `format?: 'json'`. `ollama.generate(req)` returns the raw model string as today.

- [ ] **Step 1: Add the two optional fields**

In `src/backend/ollama.ts`, extend the `OllamaGenerateRequest` interface (around lines 13-23):

```typescript
export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  keep_alive?: string;
  images?: string[]; // base64-encoded images for vision models
  format?: 'json';   // constrain output to valid JSON
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
  };
}
```

No change to `generate()` — it already spreads the request into the POST body, so `images` and `format` pass through to Ollama automatically.

- [ ] **Step 2: Typecheck the backend**

Run: `npx tsc -p src/backend/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Checkpoint — user commits**

Suggested message: `feat(backend): add image + json format support to Ollama client`
Stop and let the user commit before proceeding.

---

### Task 2: Backend SSE scan-loop route

**Files:**
- Create: `src/backend/routes/image-hunt.ts`
- Modify: `src/backend/index.ts` (import + mount)

**Interfaces:**
- Consumes: `ollama.generate({ model, prompt, images, format, keep_alive })` from Task 1.
- Produces: `GET /api/image-hunt?description=…` SSE endpoint emitting named events:
  - `checking` → `{ attempts: number, title: string }`
  - `match` → `{ id: string, thumbUrl: string, pageUrl: string, title: string, reason: string }`
  - `error` → `{ message: string }` (terminal)

- [ ] **Step 1: Create the route file**

Create `src/backend/routes/image-hunt.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { ollama } from '../ollama.js';

const router = Router();

const COMMONS_RANDOM_URL =
  'https://commons.wikimedia.org/w/api.php?action=query&generator=random' +
  '&grnnamespace=6&grnlimit=1&prop=imageinfo&iiprop=url|mime|size' +
  '&iiurlwidth=768&format=json&origin=*';

const USER_AGENT = 'pages-image-hunt/1.0 (https://samarkand.hopto.org)';

interface CommonsImage {
  title: string;
  mime: string;
  thumbUrl: string;
  pageUrl: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRandomCommonsImage(): Promise<CommonsImage | null> {
  const resp = await fetch(COMMONS_RANDOM_URL, { headers: { 'User-Agent': USER_AGENT } });
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

async function fetchImageAsBase64(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
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

async function judgeImage(description: string, base64: string): Promise<Verdict> {
  const prompt = `You are judging whether an image matches a description.
Description: "${description}"
Does the image match this description?
Respond ONLY with a JSON object of the form {"match": true or false, "reason": "<one short sentence explaining why>"}.`;
  // NOTE: no `format: 'json'` — it makes qwen3-vl:30b return an empty string.
  // The prompt alone reliably yields a bare JSON object, which parseVerdict reads.
  const raw = await ollama.generate({
    model: 'qwen3-vl:30b',
    prompt,
    images: [base64],
    keep_alive: '60m',
  });
  return parseVerdict(raw);
}

router.get('/image-hunt', async (req: Request, res: Response) => {
  const description = String(req.query.description ?? '').trim();
  if (!description) {
    res.status(400).json({ error: 'description query parameter is required' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let closed = false;
  req.on('close', () => { closed = true; });

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
      const image = await fetchRandomCommonsImage();
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
      const base64 = await fetchImageAsBase64(image.thumbUrl);
      if (closed) break;
      const verdict = await judgeImage(description, base64);
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
```

- [ ] **Step 2: Mount the router**

In `src/backend/index.ts`, add the import alongside the other route imports (after line 11):

```typescript
import imageHuntRouter from './routes/image-hunt.js';
```

And mount it with the other `app.use('/api', …)` calls (after line 58):

```typescript
app.use('/api', imageHuntRouter);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p src/backend/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Restart the dev service**

Run: `npm run dev:restart`
Then: `npm run dev:status` — expected: ports 5173/5174 in use.

- [ ] **Step 5: Verify the SSE stream**

Run (let it stream a few seconds, then Ctrl-C):
`curl -N "http://localhost:5174/api/image-hunt?description=a%20photograph%20of%20a%20person"`

Expected: a stream of `event: checking` lines with incrementing `attempts`, e.g.:
```
event: checking
data: {"attempts":1,"title":"File:Example.jpg"}
```
and occasionally `event: match` lines carrying `thumbUrl`/`pageUrl`/`reason`. Pressing Ctrl-C closes the connection; the backend log (`journalctl --user -u pages -f`) should show the loop stop (no further iterations).

- [ ] **Step 6: Verify the empty-description guard**

Run: `curl -s "http://localhost:5174/api/image-hunt"`
Expected: `{"error":"description query parameter is required"}`.

- [ ] **Step 7: Checkpoint — user commits**

Suggested message: `feat(backend): add /api/image-hunt SSE scan loop`
Stop and let the user commit.

---

### Task 3: Image Hunt page

**Files:**
- Create: `src/frontend/ImageHunt.tsx`
- Create: `src/frontend/ImageHunt.css`
- Modify: `src/frontend/App.jsx`

**Interfaces:**
- Consumes: `GET /api/image-hunt?description=…` from Task 2 (via `apiUrl()`), and its `checking`/`match`/`error` events.

- [ ] **Step 1: Create the page component**

Create `src/frontend/ImageHunt.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { apiUrl } from './backendApi';
import './ImageHunt.css';

interface Match {
  id: string;
  thumbUrl: string;
  pageUrl: string;
  title: string;
  reason: string;
}

export default function ImageHunt() {
  const [description, setDescription] = useState('');
  const [running, setRunning] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [currentTitle, setCurrentTitle] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const stop = () => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
  };

  const start = () => {
    const desc = description.trim();
    if (!desc) return;
    setMatches([]);
    setAttempts(0);
    setCurrentTitle('');
    setError(null);
    setRunning(true);

    const es = new EventSource(apiUrl(`/image-hunt?description=${encodeURIComponent(desc)}`));
    esRef.current = es;

    es.addEventListener('checking', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setAttempts(data.attempts);
      setCurrentTitle(data.title);
    });
    es.addEventListener('match', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as Match;
      setMatches((prev) => [data, ...prev]);
    });
    // Named server 'error' events carry a payload; native connection errors do not.
    es.addEventListener('error', (e) => {
      const msg = (e as MessageEvent).data;
      if (msg) {
        try { setError(JSON.parse(msg).message); } catch { /* ignore */ }
        stop(); // terminal server error: don't let EventSource auto-reconnect
      }
    });
  };

  // Close the stream when leaving the page (covers "browse away").
  useEffect(() => () => { esRef.current?.close(); }, []);

  return (
    <div className="image-hunt">
      <h1>Image Hunt</h1>

      <div className="image-hunt__controls">
        <input
          type="text"
          className="image-hunt__input"
          placeholder="Describe what to look for (e.g. happy person)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={running}
          onKeyDown={(e) => { if (e.key === 'Enter' && !running) start(); }}
        />
        {running ? (
          <button className="image-hunt__btn" onClick={stop}>Stop</button>
        ) : (
          <button className="image-hunt__btn" onClick={start} disabled={!description.trim()}>
            Start
          </button>
        )}
      </div>

      <div className="image-hunt__meter">
        Checked: {attempts} · Matches: {matches.length}
        {running && <span className="image-hunt__checking"> · checking… {currentTitle}</span>}
      </div>

      {error && <div className="image-hunt__error">{error}</div>}

      <div className="image-hunt__gallery">
        {matches.map((m) => (
          <a
            key={m.id}
            href={m.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="image-hunt__tile"
            title={m.reason}
          >
            <img src={m.thumbUrl} alt={m.title} loading="lazy" />
            <span className="image-hunt__reason">{m.reason}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the stylesheet**

Create `src/frontend/ImageHunt.css`:

```css
.image-hunt {
  max-width: 1100px;
  margin: 0 auto;
  padding: 2rem 1rem 4rem;
  color: #e5e7eb;
}

.image-hunt h1 {
  text-align: center;
  margin-bottom: 1.5rem;
}

.image-hunt__controls {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.image-hunt__input {
  flex: 1;
  padding: 0.6rem 0.8rem;
  border-radius: 0.5rem;
  border: 1px solid #374151;
  background: #111827;
  color: #e5e7eb;
  font-size: 1rem;
}

.image-hunt__btn {
  padding: 0.6rem 1.4rem;
  border: none;
  border-radius: 0.5rem;
  background: #6d28d9;
  color: white;
  font-size: 1rem;
  cursor: pointer;
}

.image-hunt__btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.image-hunt__meter {
  font-variant-numeric: tabular-nums;
  margin-bottom: 1.25rem;
  color: #9ca3af;
}

.image-hunt__checking {
  color: #6b7280;
  font-style: italic;
}

.image-hunt__error {
  background: #7f1d1d;
  color: #fecaca;
  padding: 0.6rem 0.8rem;
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}

.image-hunt__gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
}

.image-hunt__tile {
  display: flex;
  flex-direction: column;
  border-radius: 0.5rem;
  overflow: hidden;
  background: #111827;
  text-decoration: none;
  color: inherit;
}

.image-hunt__tile img {
  width: 100%;
  height: 160px;
  object-fit: cover;
  display: block;
}

.image-hunt__reason {
  padding: 0.5rem;
  font-size: 0.85rem;
  color: #cbd5e1;
}
```

- [ ] **Step 3: Register the page in `App.jsx`**

In `src/frontend/App.jsx`, add the import next to the other page imports (after line 8):

```jsx
import ImageHunt from './ImageHunt'
```

Add a route branch alongside the other `pathname === …` branches (e.g. after the `/transit` branch near line 113):

```jsx
  if (pathname === '/imagehunt') {
    return (
      <div>
        <button className="back-btn" onClick={() => navigateTo('/')}>
          ← Back to Menu
        </button>
        <ImageHunt />
      </div>
    )
  }
```

Add a menu button with the other `menu-btn`s (after the Transit Display button near line 145):

```jsx
      <button className="menu-btn" onClick={() => navigateTo('/imagehunt')}>
        🔍 Image Hunt
      </button>
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no NEW errors in `ImageHunt.tsx` or `App.jsx` (the 3 pre-existing `ColonyGame.jsx` problems may remain).

- [ ] **Step 5: Verify in the browser**

Ensure the dev service is running (`npm run dev:status`; `npm run dev:restart` if needed). Open `https://samarkand.hopto.org:5173/imagehunt` (or via the menu).
- Type a description (e.g. "a photograph of an animal"), press **Start**.
- Expected: the meter shows `Checked: N` climbing, a "checking… <file title>" note, and matching thumbnails appearing in the gallery with reason captions; clicking a tile opens its Commons page.
- Press **Stop**: the meter freezes and matches remain.
- Navigate **← Back to Menu** while running, then return: confirm the previous stream stopped (backend log shows the loop ended; no runaway iterations).

- [ ] **Step 6: Checkpoint — user commits**

Suggested message: `feat(frontend): add Image Hunt page`
Stop and let the user commit.

---

### Task 4 (optional cleanup): Fix Ollama port in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Correct the port**

In `CLAUDE.md`, replace the Ollama port `11343` with `11434` (the real port, per `src/backend/ollama.ts`). There are two mentions in the Ollama section.

- [ ] **Step 2: Checkpoint — user commits**

Suggested message: `docs: fix Ollama port in CLAUDE.md (11343 → 11434)`
Stop and let the user commit.
