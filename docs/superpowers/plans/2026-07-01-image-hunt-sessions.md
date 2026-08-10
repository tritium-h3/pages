# Image Hunt Persistent Sessions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Image Hunt sessions durable, selectable, and continuable, so hunts survive Stop/reload and can be resumed (with editable description + model) into the same pooled gallery.

**Architecture:** The backend SSE loop owns persistence (a match is saved even on disconnect), following the existing `todos.json` read/write pattern. A new storage module (`image-hunt-sessions.ts`) holds the JSON I/O behind a write mutex; the route file adds REST CRUD endpoints and threads an optional `sessionId` through the SSE stream. The frontend gains a session sidebar and Start/Continue logic.

**Tech Stack:** TypeScript/Express backend, React 19 + Vite frontend, EventSource (SSE), Node `fs.promises` JSON storage.

## Global Constraints

- **No automated tests** for this page (project convention for this toy). Every task ends with a concrete **manual** verification step, not a test cycle.
- **Source control is the user's job** — do NOT stage/commit/push. Each task ends with a "Checkpoint" marking a sensible place for the user to commit; do not run git.
- Backend restart after backend edits: `npm run dev:restart` (systemd user service `pages`); status with `npm run dev:status`.
- Reach the backend from the frontend only via `apiUrl()` from `src/frontend/backendApi.ts` (relative `/api`, proxied by Vite). Never hardcode ports.
- Default model stays `qwen3-vl:30b` (constant `DEFAULT_MODEL` in `routes/image-hunt.ts`); the frontend takes its default from `GET /image-hunt/models`.
- ESM `.js` import specifiers in backend TS source (e.g. `from '../image-hunt-sessions.js'`).
- Backend typecheck: `npx tsc -p src/backend/tsconfig.json --noEmit`. Frontend lint: `npm run lint`.
- Curl verification through the HTTPS dev proxy uses:
  `curl --resolve samarkand.hopto.org:5173:127.0.0.1 https://samarkand.hopto.org:5173/api/...`

---

### Task 1: Backend session storage module

**Files:**
- Create: `src/backend/image-hunt-sessions.ts`
- Modify: `src/backend/index.ts` (add import; init alongside `initTodoStorage`)

**Interfaces:**
- Produces (consumed by Tasks 2 & 3):
  - `interface SessionMatch { id: string; thumbUrl: string; pageUrl: string; title: string; reason: string; description: string; model: string; foundAt: string; }`
  - `interface HuntSession { id: string; label: string; createdAt: string; updatedAt: string; attempts: number; matches: SessionMatch[]; }`
  - `interface SessionSummary { id: string; label: string; attempts: number; matchCount: number; createdAt: string; updatedAt: string; }`
  - `initSessionStorage(): Promise<void>`
  - `listSessions(): Promise<SessionSummary[]>`
  - `getSession(id: string): Promise<HuntSession | null>`
  - `createSession(label: string): Promise<HuntSession>`
  - `appendMatch(id: string, match: SessionMatch): Promise<void>`
  - `bumpAttempts(id: string, attempts: number): Promise<void>` — sets absolute cumulative count
  - `renameSession(id: string, label: string): Promise<boolean>` — false if id unknown
  - `deleteSession(id: string): Promise<boolean>` — false if id unknown

- [ ] **Step 1: Create the storage module**

Create `src/backend/image-hunt-sessions.ts`:

```typescript
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sits next to todos.json / sprite-groups.json in the backend dir.
const SESSIONS_FILE = path.join(__dirname, 'image-hunt-sessions.json');

export interface SessionMatch {
  id: string;
  thumbUrl: string;
  pageUrl: string;
  title: string;
  reason: string;
  description: string; // the run's description that found this match
  model: string;       // the run's model that found this match
  foundAt: string;
}

export interface HuntSession {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  attempts: number; // cumulative across all runs
  matches: SessionMatch[];
}

export interface SessionSummary {
  id: string;
  label: string;
  attempts: number;
  matchCount: number;
  createdAt: string;
  updatedAt: string;
}

interface SessionsFile {
  sessions: HuntSession[];
}

export async function initSessionStorage(): Promise<void> {
  try {
    await fs.access(SESSIONS_FILE);
  } catch {
    await fs.writeFile(SESSIONS_FILE, JSON.stringify({ sessions: [] }, null, 2));
  }
}

// Reads tolerate a missing/corrupt file by returning empty (like todos.ts).
async function readAll(): Promise<SessionsFile> {
  try {
    const data = await fs.readFile(SESSIONS_FILE, 'utf-8');
    const parsed = JSON.parse(data) as SessionsFile;
    return Array.isArray(parsed.sessions) ? parsed : { sessions: [] };
  } catch {
    return { sessions: [] };
  }
}

async function writeAll(file: SessionsFile): Promise<void> {
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(file, null, 2));
}

// Serialize all read-modify-write operations so two concurrent hunts writing
// the single JSON file can't clobber each other. Each op waits for the prior
// one; failures don't break the chain.
let writeChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const { sessions } = await readAll();
  return sessions
    .map((s) => ({
      id: s.id,
      label: s.label,
      attempts: s.attempts,
      matchCount: s.matches.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)); // most-recent first
}

export async function getSession(id: string): Promise<HuntSession | null> {
  const { sessions } = await readAll();
  return sessions.find((s) => s.id === id) ?? null;
}

export function createSession(label: string): Promise<HuntSession> {
  return withLock(async () => {
    const file = await readAll();
    const now = new Date().toISOString();
    const session: HuntSession = {
      id: Date.now().toString(),
      label: label.trim() || 'Untitled hunt',
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      matches: [],
    };
    file.sessions.push(session);
    await writeAll(file);
    return session;
  });
}

export function appendMatch(id: string, match: SessionMatch): Promise<void> {
  return withLock(async () => {
    const file = await readAll();
    const s = file.sessions.find((x) => x.id === id);
    if (!s) return;
    s.matches.push(match);
    s.updatedAt = new Date().toISOString();
    await writeAll(file);
  });
}

export function bumpAttempts(id: string, attempts: number): Promise<void> {
  return withLock(async () => {
    const file = await readAll();
    const s = file.sessions.find((x) => x.id === id);
    if (!s) return;
    s.attempts = attempts;
    s.updatedAt = new Date().toISOString();
    await writeAll(file);
  });
}

export function renameSession(id: string, label: string): Promise<boolean> {
  return withLock(async () => {
    const file = await readAll();
    const s = file.sessions.find((x) => x.id === id);
    if (!s) return false;
    s.label = label.trim() || s.label;
    s.updatedAt = new Date().toISOString();
    await writeAll(file);
    return true;
  });
}

export function deleteSession(id: string): Promise<boolean> {
  return withLock(async () => {
    const file = await readAll();
    const before = file.sessions.length;
    file.sessions = file.sessions.filter((x) => x.id !== id);
    if (file.sessions.length === before) return false;
    await writeAll(file);
    return true;
  });
}
```

- [ ] **Step 2: Wire init into the server startup**

In `src/backend/index.ts`, add the import near the other route imports (after line 12):

```typescript
import { initSessionStorage } from './image-hunt-sessions.js';
```

Then change the startup block (currently lines 75–80) from:

```typescript
initTodoStorage().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
    console.log(`WebSocket server ready at ws://0.0.0.0:${PORT}/ws/llm-duo-chat`);
  });
});
```

to:

```typescript
Promise.all([initTodoStorage(), initSessionStorage()]).then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
    console.log(`WebSocket server ready at ws://0.0.0.0:${PORT}/ws/llm-duo-chat`);
  });
});
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p src/backend/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Restart and confirm the file is created**

Run: `npm run dev:restart`
Then: `ls -la src/backend/image-hunt-sessions.json`
Expected: the file exists and contains `{ "sessions": [] }`.

- [ ] **Checkpoint (user may commit):** storage module + init wiring.

---

### Task 2: Backend REST session endpoints

**Files:**
- Modify: `src/backend/routes/image-hunt.ts` (add import + four routes)

**Interfaces:**
- Consumes (from Task 1): `listSessions`, `getSession`, `renameSession`, `deleteSession`.
- Produces (consumed by Tasks 4 & 5):
  - `GET /api/image-hunt/sessions` → `{ sessions: SessionSummary[] }`
  - `GET /api/image-hunt/sessions/:id` → `HuntSession` (200) or `{ error }` (404)
  - `PATCH /api/image-hunt/sessions/:id` body `{ label }` → `{ ok: true }` (200) / 400 / 404
  - `DELETE /api/image-hunt/sessions/:id` → `{ ok: true }` (200) / 404

- [ ] **Step 1: Import the storage module**

At the top of `src/backend/routes/image-hunt.ts`, below the existing `import { ollama } from '../ollama.js';` line, add:

```typescript
import * as sessions from '../image-hunt-sessions.js';
```

- [ ] **Step 2: Add the four REST routes**

Insert these routes immediately after the existing `router.get('/image-hunt/models', ...)` handler (before `router.get('/image-hunt', ...)`):

```typescript
// List saved sessions (summaries) for the picker, most-recently-updated first.
router.get('/image-hunt/sessions', async (_req: Request, res: Response) => {
  try {
    res.json({ sessions: await sessions.listSessions() });
  } catch (err) {
    console.error('failed to list sessions:', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Full session (with matches), loaded when the user selects one.
router.get('/image-hunt/sessions/:id', async (req: Request, res: Response) => {
  try {
    const session = await sessions.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  } catch (err) {
    console.error('failed to get session:', err);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// Rename a session.
router.patch('/image-hunt/sessions/:id', async (req: Request, res: Response) => {
  const label = String(req.body?.label ?? '').trim();
  if (!label) {
    res.status(400).json({ error: 'label is required' });
    return;
  }
  try {
    const ok = await sessions.renameSession(req.params.id, label);
    if (!ok) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('failed to rename session:', err);
    res.status(500).json({ error: 'Failed to rename session' });
  }
});

// Delete a session.
router.delete('/image-hunt/sessions/:id', async (req: Request, res: Response) => {
  try {
    const ok = await sessions.deleteSession(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('failed to delete session:', err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});
```

(`express.json()` is already applied globally in `index.ts`, so `req.body` is parsed for PATCH.)

- [ ] **Step 3: Typecheck and restart**

Run: `npx tsc -p src/backend/tsconfig.json --noEmit`
Expected: no errors.
Run: `npm run dev:restart`

- [ ] **Step 4: Manual verification of CRUD**

The sessions file is empty, so seed one by hand to exercise the routes, then verify each:

```bash
# Seed a session directly in the file for testing the read/rename/delete routes.
node -e 'const fs=require("fs");const p="src/backend/image-hunt-sessions.json";fs.writeFileSync(p,JSON.stringify({sessions:[{id:"test1",label:"seed",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),attempts:3,matches:[{id:"1",thumbUrl:"u",pageUrl:"p",title:"t",reason:"r",description:"d",model:"m",foundAt:new Date().toISOString()}]}]},null,2))'
npm run dev:restart

BASE='https://samarkand.hopto.org:5173/api/image-hunt'
R="curl -s --resolve samarkand.hopto.org:5173:127.0.0.1"

$R "$BASE/sessions"                 # -> {"sessions":[{"id":"test1","label":"seed","attempts":3,"matchCount":1,...}]}
$R "$BASE/sessions/test1"           # -> full session incl. matches[]
$R "$BASE/sessions/nope"            # -> 404 {"error":"Session not found"}
$R -X PATCH -H 'Content-Type: application/json' -d '{"label":"renamed"}' "$BASE/sessions/test1"  # -> {"ok":true}
$R "$BASE/sessions/test1"           # -> label now "renamed"
$R -X DELETE "$BASE/sessions/test1" # -> {"ok":true}
$R "$BASE/sessions"                 # -> {"sessions":[]}
```

Expected: outputs as annotated above.

- [ ] **Checkpoint (user may commit):** REST session endpoints.

---

### Task 3: SSE persistence + `sessionId` continuation

**Files:**
- Modify: `src/backend/routes/image-hunt.ts` (the `GET /image-hunt` SSE handler)

**Interfaces:**
- Consumes (from Task 1): `getSession`, `createSession`, `appendMatch`, `bumpAttempts`, `SessionMatch`.
- Produces (consumed by Task 5): SSE now accepts optional `sessionId` query param; emits a new `session` event `{ id, label }` when a fresh session is lazily created; `match` payloads now also include `description` and `model`; `checking.attempts` and stored `attempts` are **cumulative** (base + this run).

- [ ] **Step 1: Resolve the requested session before writing SSE headers**

In the `GET /image-hunt` handler, after the existing `model` line
(`const model = String(req.query.model ?? '').trim() || DEFAULT_MODEL;`) and
**before** the `res.writeHead(...)` call, add:

```typescript
  const requestedSessionId = String(req.query.sessionId ?? '').trim();
  // Resolve continuation target before we commit to the SSE response. If the id
  // is unknown (e.g. deleted), fall through as a fresh hunt.
  let sessionId: string | null = null;
  let baseAttempts = 0;
  if (requestedSessionId) {
    const existing = await sessions.getSession(requestedSessionId);
    if (existing) {
      sessionId = existing.id;
      baseAttempts = existing.attempts;
    }
  }
```

- [ ] **Step 2: Make `checking` events report cumulative attempts**

In the same handler, every `send('checking', { attempts, title: ... })` call
currently reports the run-local `attempts`. Replace the three `checking` sends so
they report cumulative progress. Change each occurrence of `attempts,` inside a
`send('checking', {...})` to `attempts: baseAttempts + attempts,`.

The three become:

```typescript
        send('checking', { attempts: baseAttempts + attempts, title: '(no image)' });
```
```typescript
        send('checking', { attempts: baseAttempts + attempts, title: image.title });
```
```typescript
      send('checking', { attempts: baseAttempts + attempts, title: image.title }); // show before the slow judge
```

And in the catch block:

```typescript
      send('checking', { attempts: baseAttempts + attempts, title: '(error, skipped)' });
```

- [ ] **Step 3: Persist matches (lazy-create on first match) and emit `session`**

Replace the existing match block:

```typescript
      if (verdict.match) {
        send('match', {
          id: String(++matchId),
          thumbUrl: image.thumbUrl,
          pageUrl: image.pageUrl,
          title: image.title,
          reason: verdict.reason,
        });
      }
```

with:

```typescript
      if (verdict.match) {
        // Lazily create the session on the first match of a fresh hunt, so empty
        // hunts never clutter storage. Continued hunts already have a sessionId.
        if (!sessionId) {
          const created = await sessions.createSession(description);
          sessionId = created.id;
          baseAttempts = 0;
          send('session', { id: created.id, label: created.label });
        }
        const match = {
          id: `${Date.now()}-${++matchId}`, // unique within a pooled session
          thumbUrl: image.thumbUrl,
          pageUrl: image.pageUrl,
          title: image.title,
          reason: verdict.reason,
          description,
          model,
          foundAt: new Date().toISOString(),
        };
        await sessions.appendMatch(sessionId, match);
        await sessions.bumpAttempts(sessionId, baseAttempts + attempts);
        send('match', match);
      }
```

- [ ] **Step 4: Persist attempts for a continued session even with no new matches**

After the `while (!closed) { ... }` loop and before `res.end();`, add:

```typescript
  // A continued session that found nothing new this run should still record the
  // attempts it spent. (A fresh hunt with no matches created no session — nothing
  // to persist, by design.)
  if (sessionId) {
    try {
      await sessions.bumpAttempts(sessionId, baseAttempts + attempts);
    } catch (err) {
      console.error('failed to persist final attempts:', err);
    }
  }
```

- [ ] **Step 5: Typecheck and restart**

Run: `npx tsc -p src/backend/tsconfig.json --noEmit`
Expected: no errors.
Run: `npm run dev:restart`

- [ ] **Step 6: Manual verification — fresh hunt persists, continuation appends**

Ensure the sessions file is empty first:

```bash
node -e 'require("fs").writeFileSync("src/backend/image-hunt-sessions.json",JSON.stringify({sessions:[]},null,2))'
npm run dev:restart
R="curl -s --resolve samarkand.hopto.org:5173:127.0.0.1"
BASE='https://samarkand.hopto.org:5173/api/image-hunt'

# Fresh hunt: run ~40s for an easy description, then Ctrl-C. Watch for a 'session'
# event then 'match' events. (gemma3:4b is faster for a quick check if present.)
timeout 45 $R -N "$BASE?description=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("a photograph"))')&model=qwen3-vl:30b" | head -40

# Inspect what got saved: expect one session, matches tagged with description+model.
$R "$BASE/sessions"
SID=$($R "$BASE/sessions" | python3 -c 'import sys,json;print(json.load(sys.stdin)["sessions"][0]["id"])')
echo "session id: $SID"
$R "$BASE/sessions/$SID" | python3 -m json.tool | head -40

# Continue that session: attempts should climb from the stored total, new matches append.
timeout 45 $R -N "$BASE?description=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("a photograph"))')&model=qwen3-vl:30b&sessionId=$SID" | head -20
$R "$BASE/sessions/$SID" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("attempts:",d["attempts"],"matches:",len(d["matches"]))'
```

Expected: first run creates exactly one session whose matches carry `description` + `model` + `foundAt`; the continue run keeps the same session id, `attempts` is larger than after run 1, and match count only grows (never resets).

- [ ] **Checkpoint (user may commit):** SSE persistence + continuation.

---

### Task 4: Frontend session sidebar (list / select / rename / delete / new hunt)

**Files:**
- Modify: `src/frontend/ImageHunt.tsx`
- Modify: `src/frontend/ImageHunt.css`

This task builds the sidebar and all session data-wiring, but leaves the hunt
still behaving as "Start fresh" (Continue wiring is Task 5). After this task you
can browse, load, rename, and delete saved sessions.

**Interfaces:**
- Consumes (from Tasks 2 & 3): the REST endpoints and the extended `match` payload.
- Produces (consumed by Task 5): component state `activeSessionId`, `sessions`, `defaultModel`; functions `loadSessions()`, `selectSession(id)`, `newHunt()`, `removeSession(id)`, `renameSession(id, label)`; the `Match` interface now including `description` and `model`.

- [ ] **Step 1: Replace the component with the sidebar-enabled version**

Replace the entire contents of `src/frontend/ImageHunt.tsx` with:

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
  description: string;
  model: string;
}

interface SessionSummary {
  id: string;
  label: string;
  attempts: number;
  matchCount: number;
  createdAt: string;
  updatedAt: string;
}

interface FullSession extends SessionSummary {
  matches: Match[];
}

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ImageHunt() {
  const [description, setDescription] = useState('');
  const [running, setRunning] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [currentTitle, setCurrentTitle] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const esRef = useRef<EventSource | null>(null);

  const loadSessions = () => {
    fetch(apiUrl('/image-hunt/sessions'))
      .then((r) => r.json())
      .then((data: { sessions: SessionSummary[] }) => setSessions(data.sessions ?? []))
      .catch(() => { /* leave list as-is */ });
  };

  // Load vision models + session list on mount.
  useEffect(() => {
    fetch(apiUrl('/image-hunt/models'))
      .then((r) => r.json())
      .then((data: { models: string[]; default?: string }) => {
        setModels(data.models);
        const def = data.default && data.models.includes(data.default) ? data.default : data.models[0] ?? '';
        setDefaultModel(def);
        setModel((prev) => prev || def);
      })
      .catch(() => { /* Start stays disabled until a model loads */ });
    loadSessions();
  }, []);

  const stop = () => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
    loadSessions(); // refresh counts/order after a run ends
  };

  // Clear everything back to a fresh hunt: default fields, empty gallery.
  const newHunt = () => {
    if (running) stop();
    setActiveSessionId(null);
    setMatches([]);
    setAttempts(0);
    setCurrentTitle('');
    setError(null);
    setDescription('');
    setModel(defaultModel);
  };

  // Load a saved session: gallery from storage, fields pre-filled from its last run.
  const selectSession = (id: string) => {
    if (running) stop();
    setError(null);
    fetch(apiUrl(`/image-hunt/sessions/${id}`))
      .then((r) => { if (!r.ok) throw new Error('load failed'); return r.json(); })
      .then((s: FullSession) => {
        setActiveSessionId(s.id);
        setAttempts(s.attempts);
        setCurrentTitle('');
        const newestFirst = [...s.matches].reverse();
        setMatches(newestFirst);
        const last = s.matches[s.matches.length - 1];
        setDescription(last?.description ?? '');
        setModel(last && models.includes(last.model) ? last.model : defaultModel);
      })
      .catch(() => setError('Could not load that session.'));
  };

  const removeSession = (id: string) => {
    if (id === activeSessionId && running) stop();
    fetch(apiUrl(`/image-hunt/sessions/${id}`), { method: 'DELETE' })
      .then(() => {
        if (id === activeSessionId) newHunt();
        loadSessions();
      })
      .catch(() => setError('Could not delete that session.'));
  };

  const submitRename = (id: string) => {
    const label = editLabel.trim();
    setEditingId(null);
    if (!label) return;
    fetch(apiUrl(`/image-hunt/sessions/${id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    })
      .then(() => loadSessions())
      .catch(() => setError('Could not rename that session.'));
  };

  const start = () => {
    // Continue wiring arrives in Task 5; for now always a fresh hunt.
    const desc = description.trim();
    if (!desc) return;
    setMatches([]);
    setAttempts(0);
    setCurrentTitle('');
    setError(null);
    setRunning(true);

    const es = new EventSource(
      apiUrl(`/image-hunt?description=${encodeURIComponent(desc)}&model=${encodeURIComponent(model)}`)
    );
    esRef.current = es;

    es.addEventListener('session', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { id: string; label: string };
      setActiveSessionId(data.id);
      loadSessions();
    });
    es.addEventListener('checking', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setAttempts(data.attempts);
      setCurrentTitle(data.title);
    });
    es.addEventListener('match', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as Match;
      setMatches((prev) => [data, ...prev]);
    });
    es.addEventListener('error', (e) => {
      const msg = (e as MessageEvent).data;
      if (msg) {
        try { setError(JSON.parse(msg).message); } catch { /* ignore */ }
        stop();
      }
    });
  };

  useEffect(() => () => { esRef.current?.close(); }, []);

  return (
    <div className="image-hunt">
      <h1>Image Hunt</h1>

      <div className="image-hunt__layout">
        <aside className="image-hunt__sidebar">
          <button className="image-hunt__newbtn" onClick={newHunt}>+ New hunt</button>
          <ul className="image-hunt__sessions">
            {sessions.length === 0 && <li className="image-hunt__empty">No saved hunts yet</li>}
            {sessions.map((s) => (
              <li
                key={s.id}
                className={`image-hunt__session${s.id === activeSessionId ? ' is-active' : ''}`}
              >
                {editingId === s.id ? (
                  <input
                    className="image-hunt__rename"
                    autoFocus
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onBlur={() => submitRename(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename(s.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <button className="image-hunt__session-main" onClick={() => selectSession(s.id)}>
                    <span className="image-hunt__session-label">{s.label}</span>
                    <span className="image-hunt__session-meta">
                      {s.matchCount} match{s.matchCount === 1 ? '' : 'es'} · {relativeDate(s.updatedAt)}
                    </span>
                  </button>
                )}
                <div className="image-hunt__session-actions">
                  <button
                    title="Rename"
                    onClick={() => { setEditingId(s.id); setEditLabel(s.label); }}
                  >✎</button>
                  <button title="Delete" onClick={() => removeSession(s.id)}>🗑</button>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <div className="image-hunt__main">
          <div className="image-hunt__controls">
            <input
              type="text"
              className="image-hunt__input"
              placeholder="Describe what to look for (e.g. happy person)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={running}
              onKeyDown={(e) => { if (e.key === 'Enter' && !running && model) start(); }}
            />
            <select
              className="image-hunt__select"
              value={model}
              disabled={running || models.length === 0}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.length === 0 && <option value="">loading models…</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {running ? (
              <button className="image-hunt__btn" onClick={stop}>Stop</button>
            ) : (
              <button className="image-hunt__btn" onClick={start} disabled={!description.trim() || !model}>
                Start
              </button>
            )}
          </div>

          <div className="image-hunt__meter">
            Checked: {attempts} · Matches: {matches.length}
            {model && <span> · model: {model}</span>}
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
                <span className="image-hunt__tag">{m.model}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add sidebar + tag styles**

Append to `src/frontend/ImageHunt.css`:

```css
.image-hunt__layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 1.25rem;
  align-items: start;
}

@media (max-width: 720px) {
  .image-hunt__layout { grid-template-columns: 1fr; }
}

.image-hunt__sidebar {
  border: 1px solid #1f2937;
  border-radius: 0.5rem;
  padding: 0.5rem;
  background: #0b1220;
}

.image-hunt__newbtn {
  width: 100%;
  padding: 0.5rem;
  margin-bottom: 0.5rem;
  border: 1px dashed #374151;
  border-radius: 0.5rem;
  background: transparent;
  color: #e5e7eb;
  cursor: pointer;
}

.image-hunt__sessions { list-style: none; margin: 0; padding: 0; }

.image-hunt__empty { color: #6b7280; font-size: 0.85rem; padding: 0.5rem; }

.image-hunt__session {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.4rem;
  margin-bottom: 0.15rem;
}

.image-hunt__session.is-active { background: #1e293b; }

.image-hunt__session-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  padding: 0.4rem 0.5rem;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  min-width: 0;
}

.image-hunt__session-label {
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.image-hunt__session-meta { font-size: 0.72rem; color: #6b7280; }

.image-hunt__session-actions { display: flex; gap: 0.1rem; padding-right: 0.25rem; }

.image-hunt__session-actions button {
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0.2rem;
}

.image-hunt__session-actions button:hover { color: #e5e7eb; }

.image-hunt__rename {
  flex: 1;
  padding: 0.3rem 0.4rem;
  border-radius: 0.3rem;
  border: 1px solid #374151;
  background: #111827;
  color: #e5e7eb;
  font-size: 0.85rem;
}

.image-hunt__tag {
  padding: 0.25rem 0.5rem;
  font-size: 0.7rem;
  color: #93c5fd;
  border-top: 1px solid #1f2937;
}
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors from `ImageHunt.tsx`.

- [ ] **Step 4: Manual verification in the browser**

Open `https://samarkand.hopto.org:5173/imagehunt`. With at least one saved session
present (create one by running a short hunt, or reuse Task 3's data):
- The sidebar lists sessions with label · match count · relative date.
- Run a short fresh hunt → on the first match it appears in the sidebar and becomes highlighted (active).
- Click a session → its matches load into the gallery (newest first) and the description/model fields pre-fill from its last run.
- Click ✎ → edit the label → Enter → the label updates and persists across reload.
- Click 🗑 on the active session → gallery clears, fields reset to defaults, row disappears.
- Click "+ New hunt" → fields reset to defaults (empty description, default model), gallery clears, no session highlighted.
- Each match tile shows a small model tag at the bottom.

- [ ] **Checkpoint (user may commit):** session sidebar + management.

---

### Task 5: Continue wiring, field rules, and cross-prompt captions

**Files:**
- Modify: `src/frontend/ImageHunt.tsx` (the `start` function + tile caption)
- Modify: `src/frontend/ImageHunt.css` (caption tweak)

This task turns the button into Start/Continue and makes a running-against-an-active-session append rather than replace, plus shows the finding description on tiles when it differs from the active one.

**Interfaces:**
- Consumes (from Tasks 3 & 4): `activeSessionId`, the SSE `sessionId` param, the `session` event, `Match.description`.

- [ ] **Step 1: Make the run function continue an active session**

In `src/frontend/ImageHunt.tsx`, replace the `start` function from Task 4 with:

```tsx
  const start = () => {
    const desc = description.trim();
    if (!desc) return;
    // Continuing an active session keeps its already-loaded gallery and lets the
    // cumulative attempt counter climb; a fresh hunt clears the view first.
    const continuing = activeSessionId !== null;
    if (!continuing) {
      setMatches([]);
      setAttempts(0);
    }
    setCurrentTitle('');
    setError(null);
    setRunning(true);

    const params = new URLSearchParams({ description: desc, model });
    if (continuing) params.set('sessionId', activeSessionId as string);

    const es = new EventSource(apiUrl(`/image-hunt?${params.toString()}`));
    esRef.current = es;

    es.addEventListener('session', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { id: string; label: string };
      setActiveSessionId(data.id);
      loadSessions();
    });
    es.addEventListener('checking', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setAttempts(data.attempts);
      setCurrentTitle(data.title);
    });
    es.addEventListener('match', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as Match;
      setMatches((prev) => [data, ...prev]);
    });
    es.addEventListener('error', (e) => {
      const msg = (e as MessageEvent).data;
      if (msg) {
        try { setError(JSON.parse(msg).message); } catch { /* ignore */ }
        stop();
      }
    });
  };
```

- [ ] **Step 2: Label the button Start vs Continue**

In the JSX, replace the Start button block:

```tsx
            ) : (
              <button className="image-hunt__btn" onClick={start} disabled={!description.trim() || !model}>
                Start
              </button>
            )}
```

with:

```tsx
            ) : (
              <button className="image-hunt__btn" onClick={start} disabled={!description.trim() || !model}>
                {activeSessionId ? 'Continue' : 'Start'}
              </button>
            )}
```

- [ ] **Step 3: Show the finding description on tiles when it differs**

Replace the tile tag line:

```tsx
                <span className="image-hunt__tag">{m.model}</span>
```

with:

```tsx
                <span className="image-hunt__tag">
                  {m.model}
                  {m.description.trim() !== description.trim() && ` · “${m.description}”`}
                </span>
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: End-to-end manual verification**

Open `https://samarkand.hopto.org:5173/imagehunt`:
- Fresh hunt (no active session): button reads **Start**; on first match a session appears and the button — once you Stop — reads **Continue** (session now active).
- With a session active, edit the description and/or model, click **Continue**: the gallery keeps prior matches, the "Checked" counter continues climbing (does not reset to 0), and new matches append at the top.
- Continue with a *different* description → new tiles show `model · "that description"`; tiles from the active description show only the model.
- Reload the page → sidebar still lists the session with its full match count; selecting it restores the gallery and pre-fills the last run's description/model.
- "+ New hunt" → button reverts to **Start**, fields reset to defaults.

- [ ] **Checkpoint (user may commit):** Start/Continue + captions. Feature complete.

---

## Self-Review notes

- **Spec coverage:** storage module + mutex (T1); REST list/get/patch/delete (T2); SSE `sessionId` continuation, lazy-create-on-first-match, `session` event, cumulative attempts, match tagging (T3); sidebar with select/rename/delete/new-hunt, backend-owned persistence surfaced read-only on load (T4); Start↔Continue, field-population rules, cross-prompt captions (T5). Edge cases (stop-before-select/delete, unknown id → fresh hunt, corrupt file → empty) covered in T1/T3/T4.
- **Field rules:** New hunt / fresh load → defaults; resume → last run's description+model (T4 `selectSession`/`newHunt`, T5 button). Matches the spec's final rule (values persist only when resuming).
- **Type consistency:** `Match`/`SessionMatch` fields align across backend and frontend; `SessionSummary` identical in both; function names (`loadSessions`, `selectSession`, `newHunt`, `removeSession`, `submitRename`, `bumpAttempts`, `appendMatch`) are used consistently.
- **No automated tests** by design; each task carries a concrete manual check. Git left to the user at each checkpoint.
