# Structure Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `pages` around one self-contained folder per experiment, replace the button-list front page with a sectioned gallery of poster plates, and remove Tailwind.

**Architecture:** Each experiment becomes a vertical slice under `src/experiments/<id>/`, with backend-only code in a `server/` subfolder. A thin `src/platform/` holds genuinely shared code. A data-only `manifest.ts` per slice feeds both a frontend registry (lazy page loaders) and an explicit backend mount list. Migration runs slice-by-slice with a legacy fallback router, so the app works after every task.

**Tech Stack:** React 19 · rolldown-vite · Express + TypeScript · vitest · CSS Modules · `tsx` (dev runner) · `ws`

## Global Constraints

- **Section ids are exactly** `'tools' | 'llm-toys' | 'games'`. Section titles: `Tools`, `LLM Toys`, `Game Ideas`.
- **Backend namespacing:** every slice router mounts at `/api/<id>`. `GET /api/health` is the only route outside a slice.
- **`apiUrl` signature is `apiUrl(id: string, path: string)`** after Task 2. No component may hardcode an `/api/...` string.
- **Cross-slice imports** are permitted only from another slice's `client.ts` or `types.ts`. Never from its `page`, never from anything under `server/`.
- **Runtime state lives in `data/`** (gitignored, created at boot). Authored content stays in the repo.
- **`ColonyGame` stays `.jsx`.** Do not convert it to TypeScript in this plan.
- **`npm run dev` keeps its name** — `pages.service` invokes it and must not need editing.
- **The dev server is a systemd unit.** After any change to `src/server.ts` or the mount list, run `npm run dev:restart`, not just a file save.
- **CLAUDE.md is updated by the task that invalidates it**, never batched to the end.
- **Single dark theme.** No light mode, no `prefers-color-scheme` branches.
- **Commit after every task.** Do not stage or push beyond the commits these steps specify.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `tsconfig.app.json`, `tsconfig.server.json` | frontend/backend type checking, split by glob |
| `src/platform/config.ts` | hostnames, ports, CORS origins, external URLs |
| `src/platform/server/storage.ts` | atomic JSON persistence in `data/` |
| `src/platform/manifest.ts` | `ExperimentManifest` type, `SECTIONS` |
| `src/platform/backendApi.ts` | `apiUrl(id, path)`, `wsUrl(path)` |
| `src/platform/server/ollama.ts` | moved unchanged from `src/backend/ollama.ts` |
| `src/platform/ui/tokens.css` | design tokens as custom properties |
| `src/platform/ui/placeholder.ts` | deterministic plate art from an id |
| `src/platform/ui/Plate.tsx`, `Gallery.tsx`, `Colophon.tsx`, `Shell.tsx` | gallery and page chrome |
| `src/router.ts` | `matchRoute` — pure, tested |
| `src/registry.ts` | ordered experiment list + lazy loaders |
| `src/App.tsx`, `src/main.tsx` | shell entry, replacing `App.jsx`/`main.jsx` |
| `src/server.ts` | express host, replacing `src/backend/index.ts` |
| `src/experiments/<id>/` | nine slices |

**Deleted by the end:** `src/frontend/`, `src/backend/`, `tailwind.config.js`, `postcss.config.js`, `vite.config.js` (renamed `.ts`).

---

### Task 1: Type checking and test configuration

Today there is no root `tsconfig.json` and Vite never type-checks, so every `.tsx` file is unchecked. New code needs checking from the start.

**Files:**
- Create: `tsconfig.app.json`, `tsconfig.server.json`
- Modify: `package.json`, `vitest.config.ts`, `.gitignore`

**Interfaces:**
- Produces: `npm run typecheck` (both configs), vitest discovering `src/**/*.test.ts`

- [ ] **Step 1: Create `tsconfig.app.json`**

`src/frontend/**` is excluded because it is legacy and unchecked. Each slice migration removes files from it; when it is empty the exclude line goes.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "allowJs": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["src/frontend/**", "src/backend/**", "src/**/server/**", "src/server.ts"]
}
```

`src/**/server/**` matches a `server/` *directory*, so `src/server.ts` needs excluding by
name — otherwise the Express entry point gets type-checked against the DOM.

- [ ] **Step 2: Create `tsconfig.server.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": [
    "src/server.ts",
    "src/platform/config.ts",
    "src/platform/server/**/*.ts",
    "src/experiments/**/server/**/*.ts",
    "src/experiments/**/types.ts"
  ]
}
```

**Platform splits the same way slices do.** Backend-only platform code lives in
`src/platform/server/` — that directory is already excluded from the app config by the
`src/**/server/**` pattern, and included here. Frontend-only platform code
(`backendApi.ts`, `ui/`) stays outside it and is checked only by the app config.
`config.ts` is the one genuinely shared module — pure data, no DOM and no Node APIs — so
both configs name it.

Without this split, `src/platform/backendApi.ts` (Task 9) would be type-checked against
`lib: ES2022` with no DOM, and its `window.location` reference would fail to compile.

- [ ] **Step 3: Broaden vitest discovery**

`vitest.config.ts` — change `include` so tests inside slices are found:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Add the typecheck script and ignore `data/`**

In `package.json` `scripts`, add:

```json
"typecheck": "tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.server.json"
```

Append to `.gitignore`:

```
# Runtime state
data/
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: PASS. Both configs currently match zero or near-zero files, which is correct — nothing has moved yet.

Run: `npm test`
Expected: PASS, same test count as before this task.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.app.json tsconfig.server.json vitest.config.ts package.json .gitignore
git commit -m "build: add split tsconfigs, typecheck script, broaden vitest discovery"
```

---

### Task 2: Platform config

The CORS allowlist is 14 hand-written strings in `index.ts`, and `vite.config.js` separately repeats the same hostnames. Both derive from one list here.

**Files:**
- Create: `src/platform/config.ts`, `src/platform/config.test.ts`

**Interfaces:**
- Produces: `HOSTNAMES`, `PORTS`, `NEIGHBOUR_PORTS`, `EXTERNAL_URLS`, `corsOrigins(): string[]`

- [ ] **Step 1: Write the failing test**

`src/platform/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { corsOrigins, HOSTNAMES, PORTS, EXTERNAL_URLS } from './config.js';

describe('corsOrigins', () => {
  it('covers every hostname across both schemes, bare and with the vite/api ports', () => {
    const origins = corsOrigins();
    for (const host of HOSTNAMES) {
      for (const scheme of ['http', 'https']) {
        expect(origins).toContain(`${scheme}://${host}`);
        expect(origins).toContain(`${scheme}://${host}:${PORTS.vite}`);
        expect(origins).toContain(`${scheme}://${host}:${PORTS.api}`);
      }
    }
  });

  it('preserves every origin the old hand-written allowlist contained', () => {
    const origins = corsOrigins();
    const legacy = [
      'http://localhost:5173', 'http://localhost:5174',
      'http://samarkand.hopto.org', 'http://samarkand.hopto.org:5173',
      'http://samarkand.hopto.org:5174', 'https://samarkand.hopto.org',
      'https://samarkand.hopto.org:5173', 'https://samarkand.hopto.org:5174',
      'http://torment-nexus.local', 'http://torment-nexus.local:5173',
      'http://torment-nexus.local:5174', 'https://torment-nexus.local',
      'https://torment-nexus.local:5173', 'https://torment-nexus.local:5174',
    ];
    for (const origin of legacy) expect(origins).toContain(origin);
  });

  it('returns no duplicates', () => {
    const origins = corsOrigins();
    expect(new Set(origins).size).toBe(origins.length);
  });
});

describe('external URLs', () => {
  it('are absolute', () => {
    for (const url of Object.values(EXTERNAL_URLS)) {
      expect(url).toMatch(/^https?:\/\//);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/platform/config.test.ts`
Expected: FAIL — cannot resolve `./config.js`.

- [ ] **Step 3: Implement `src/platform/config.ts`**

```ts
/** Hostnames this server is reached by. Adding one here updates both the
 *  backend CORS allowlist and Vite's allowedHosts. */
export const HOSTNAMES = ['localhost', 'samarkand.hopto.org', 'torment-nexus.local'] as const;

/** Ports this project owns. */
export const PORTS = {
  httpRedirect: 5172,
  vite: 5173,
  api: 5174,
} as const;

/** Ports owned by sibling projects on this machine, recorded so collisions are
 *  visible in one place. Not read at runtime.
 *
 *  KNOWN COLLISIONS: cult-game hardcodes 5174 (this project's api) and would
 *  default Vite to 5173; cosmic's frontend is configured for 5177, which is
 *  chitty's redirect port. Neither is running. Fixing those projects is out of
 *  scope here. */
export const NEIGHBOUR_PORTS = {
  chittyVite: 5175,
  chittyApi: 5176,
  chittyRedirect: 5177,
  roguelikeApi: 3001,
} as const;

/** Link targets for experiments that run as their own services. These are
 *  static: the gallery does no health checking, so a link is simply dead while
 *  its service is stopped. Both projects must be started on these ports for the
 *  links to resolve. */
export const EXTERNAL_URLS = {
  roguelike: 'https://samarkand.hopto.org:5178',
  cultGame: 'https://samarkand.hopto.org:5179',
} as const;

/** Origins accepted by the backend's CORS middleware. Generated across schemes
 *  and ports rather than hand-maintained. */
export function corsOrigins(): string[] {
  const origins: string[] = [];
  for (const host of HOSTNAMES) {
    for (const scheme of ['http', 'https']) {
      origins.push(`${scheme}://${host}`);
      origins.push(`${scheme}://${host}:${PORTS.vite}`);
      origins.push(`${scheme}://${host}:${PORTS.api}`);
    }
  }
  return origins;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/platform/config.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/platform/config.ts src/platform/config.test.ts
git commit -m "feat(platform): add config module with generated CORS origins"
```

---

### Task 3: Atomic JSON storage

Three route files hand-roll read-JSON/write-JSON, and each can truncate its file if the process dies mid-write.

**Files:**
- Create: `src/platform/server/storage.ts`, `src/platform/server/storage.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `DATA_DIR: string`, `ensureDataDir(): Promise<void>`, `createJsonStore<T>(name: string, fallback: T, dir?: string): JsonStore<T>` where `JsonStore<T> = { read(): Promise<T>; write(value: T): Promise<void> }`

- [ ] **Step 1: Write the failing test**

`src/platform/server/storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
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

  it('returns the fallback when the file holds invalid JSON', async () => {
    await fs.writeFile(path.join(dir, 'broken.json'), '{ not json');
    const store = createJsonStore<string[]>('broken', ['fallback'], dir);
    expect(await store.read()).toEqual(['fallback']);
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/platform/server/storage.test.ts`
Expected: FAIL — cannot resolve `./storage.js`.

- [ ] **Step 3: Implement `src/platform/server/storage.ts`**

The temp filename includes the pid *and* a counter, otherwise concurrent writes from one process collide on the same temp path and the final rename can publish a half-written file.

```ts
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/** Resolved from this module's location, not process.cwd(), so the systemd
 *  unit's WorkingDirectory is not load-bearing.
 *  src/platform/server/ -> up three -> repo root. */
export const DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'data',
);

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export interface JsonStore<T> {
  read(): Promise<T>;
  write(value: T): Promise<void>;
}

let writeCounter = 0;

export function createJsonStore<T>(name: string, fallback: T, dir: string = DATA_DIR): JsonStore<T> {
  const file = path.join(dir, `${name}.json`);

  return {
    async read(): Promise<T> {
      try {
        return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
      } catch {
        return fallback;
      }
    },

    async write(value: T): Promise<void> {
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.${writeCounter++}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(value, null, 2));
      await fs.rename(tmp, file);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/platform/server/storage.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/platform/server/storage.ts src/platform/server/storage.test.ts
git commit -m "feat(platform): add atomic JSON store"
```

---

### Task 4: Manifest types, sections, and the registry

**Files:**
- Create: `src/platform/manifest.ts`, `src/registry.ts`, `src/registry.test.ts`

**Interfaces:**
- Consumes: `EXTERNAL_URLS` from `platform/config.ts`
- Produces: `SectionId`, `ExperimentManifest`, `SECTIONS`, `RegistryEntry`, `REGISTRY`

- [ ] **Step 1: Write the failing test**

`src/registry.test.ts` — this is the integrity check that keeps the registry and the server mount list from drifting:

```ts
import { describe, it, expect } from 'vitest';
import { REGISTRY } from './registry.js';
import { SECTIONS } from './platform/manifest.js';

describe('registry integrity', () => {
  it('has unique ids', () => {
    const ids = REGISTRY.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique routes', () => {
    const routes = REGISTRY.filter(e => !e.external).map(e => e.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('uses only declared sections', () => {
    const known = new Set(SECTIONS.map(s => s.id));
    for (const entry of REGISTRY) expect(known.has(entry.section)).toBe(true);
  });

  it('gives every entry a valid chrome mode', () => {
    for (const entry of REGISTRY) {
      expect(['colophon', 'none']).toContain(entry.chrome);
    }
  });

  it('gives local entries a loader and a route starting with /', () => {
    for (const entry of REGISTRY.filter(e => !e.external)) {
      expect(typeof entry.load).toBe('function');
      expect(entry.route.startsWith('/')).toBe(true);
    }
  });

  it('gives external entries an absolute href, no loader and no server', () => {
    for (const entry of REGISTRY.filter(e => e.external)) {
      expect(entry.external).toMatch(/^https?:\/\//);
      expect(entry.load).toBeUndefined();
      expect(entry.hasServer).toBe(false);
    }
  });

  it('uses ids that are url-safe slugs', () => {
    for (const entry of REGISTRY) expect(entry.id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('has artwork on disk for every entry that declares it', () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
    for (const entry of REGISTRY.filter(e => e.art)) {
      expect(existsSync(path.join(root, 'public', entry.art!))).toBe(true);
    }
  });
});
```

The artwork test is vacuous until real art exists, which is the point: it starts
passing trivially and begins guarding the moment a manifest names a file. Add these
imports at the top of the file:

```ts
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/registry.test.ts`
Expected: FAIL — cannot resolve `./registry.js`.

- [ ] **Step 3: Implement `src/platform/manifest.ts`**

```ts
export type SectionId = 'tools' | 'llm-toys' | 'games';

export type ChromeMode = 'colophon' | 'none';

export interface ExperimentManifest {
  /** url-safe slug; also the /api/<id> namespace */
  id: string;
  title: string;
  /** one line, shown on the plate */
  blurb: string;
  section: SectionId;
  /** path this experiment owns; it also owns everything beneath it */
  route: string;
  /** e.g. '/art/sky.webp'; when absent a deterministic placeholder is drawn */
  art?: string;
  chrome: ChromeMode;
  hasServer: boolean;
  /** absolute URL; when set the card is a link out and carries the ↗ mark */
  external?: string;
}

export interface Section {
  id: SectionId;
  title: string;
  blurb: string;
}

export const SECTIONS: Section[] = [
  { id: 'tools', title: 'Tools', blurb: 'Things I actually use' },
  { id: 'llm-toys', title: 'LLM Toys', blurb: 'Everything that talks back' },
  { id: 'games', title: 'Game Ideas', blurb: 'Half-built worlds' },
];
```

- [ ] **Step 4: Implement `src/registry.ts`**

Slices are added to this array by later tasks. It starts with the two externals, which need no slice.

```ts
import type { ComponentType } from 'react';
import type { ExperimentManifest } from './platform/manifest.js';
import { EXTERNAL_URLS } from './platform/config.js';

export interface ExperimentPageProps {
  /** path segments below the experiment's route; [] at its root */
  subpath: string[];
}

export interface RegistryEntry extends ExperimentManifest {
  /** absent for external entries, which are links rather than routes */
  load?: () => Promise<{ default: ComponentType<ExperimentPageProps> }>;
}

export const REGISTRY: RegistryEntry[] = [
  {
    id: 'roguelike',
    title: 'Roguelike',
    blurb: 'Outgrew this repo — its own engine, its own service',
    section: 'games',
    route: '/roguelike',
    chrome: 'none',
    hasServer: false,
    external: EXTERNAL_URLS.roguelike,
  },
  {
    id: 'cult-game',
    title: 'Cult Game',
    blurb: 'Faction management, elsewhere',
    section: 'games',
    route: '/cult-game',
    chrome: 'none',
    hasServer: false,
    external: EXTERNAL_URLS.cultGame,
  },
];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/registry.test.ts && npm run typecheck`
Expected: PASS, 8 tests, and typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/platform/manifest.ts src/registry.ts src/registry.test.ts
git commit -m "feat: add manifest types, sections and registry with integrity tests"
```

---

### Task 5: Route matching

**Files:**
- Create: `src/router.ts`, `src/router.test.ts`

**Interfaces:**
- Consumes: `RegistryEntry` from `src/registry.ts`
- Produces: `matchRoute(pathname: string, entries: RegistryEntry[]): RouteMatch | null` where `RouteMatch = { entry: RegistryEntry; subpath: string[] }`

- [ ] **Step 1: Write the failing test**

`src/router.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchRoute } from './router.js';
import type { RegistryEntry } from './registry.js';

const stub = (id: string, route: string, external?: string): RegistryEntry => ({
  id, route, title: id, blurb: '', section: 'tools', chrome: 'colophon',
  hasServer: false, external,
  load: external ? undefined : async () => ({ default: () => null }),
});

const entries = [stub('sky', '/sky'), stub('todo', '/todo'), stub('rl', '/rl', 'https://x.test')];

describe('matchRoute', () => {
  it('matches an exact route with an empty subpath', () => {
    expect(matchRoute('/sky', entries)).toMatchObject({ entry: { id: 'sky' }, subpath: [] });
  });

  it('matches a sub-route and returns its segments', () => {
    expect(matchRoute('/sky/map', entries)).toMatchObject({ entry: { id: 'sky' }, subpath: ['map'] });
  });

  it('returns multiple sub-segments in order', () => {
    expect(matchRoute('/sky/map/detail', entries)?.subpath).toEqual(['map', 'detail']);
  });

  it('returns null for an unknown path', () => {
    expect(matchRoute('/nope', entries)).toBeNull();
  });

  it('returns null for the root path', () => {
    expect(matchRoute('/', entries)).toBeNull();
  });

  it('never matches an external entry', () => {
    expect(matchRoute('/rl', entries)).toBeNull();
  });

  it('does not treat a prefix collision as a sub-route', () => {
    expect(matchRoute('/skyfall', entries)).toBeNull();
  });

  it('prefers the longest matching route', () => {
    const nested = [stub('sky', '/sky'), stub('skymap', '/sky/map')];
    expect(matchRoute('/sky/map', nested)?.entry.id).toBe('skymap');
  });

  it('ignores a trailing slash', () => {
    expect(matchRoute('/sky/', entries)).toMatchObject({ entry: { id: 'sky' }, subpath: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/router.test.ts`
Expected: FAIL — cannot resolve `./router.js`.

- [ ] **Step 3: Implement `src/router.ts`**

```ts
import type { RegistryEntry } from './registry.js';

export interface RouteMatch {
  entry: RegistryEntry;
  subpath: string[];
}

/** Finds the experiment owning `pathname`. An experiment owns its route and
 *  everything beneath it; sub-routes are handed to the page as `subpath`.
 *  External entries are links, never routes, so they never match. */
export function matchRoute(pathname: string, entries: RegistryEntry[]): RouteMatch | null {
  const normalized = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;

  const routable = entries
    .filter(entry => !entry.external && entry.load)
    .sort((a, b) => b.route.length - a.route.length);

  for (const entry of routable) {
    if (normalized === entry.route) return { entry, subpath: [] };
    if (normalized.startsWith(`${entry.route}/`)) {
      return { entry, subpath: normalized.slice(entry.route.length + 1).split('/') };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/router.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/router.ts src/router.test.ts
git commit -m "feat: add registry-driven route matching"
```

---

### Task 6: Deterministic placeholder art

Plates without artwork must still look deliberate and differ from each other.

**Files:**
- Create: `src/platform/ui/placeholder.ts`, `src/platform/ui/placeholder.test.ts`

**Interfaces:**
- Produces: `hashId(id: string): number`, `placeholderStyle(id: string): { background: string }`

- [ ] **Step 1: Write the failing test**

`src/platform/ui/placeholder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hashId, primaryHue, placeholderStyle } from './placeholder.js';

describe('hashId', () => {
  it('is deterministic', () => {
    expect(hashId('sky')).toBe(hashId('sky'));
  });

  it('differs between ids', () => {
    expect(hashId('sky')).not.toBe(hashId('todo'));
  });

  it('returns a non-negative 32-bit integer', () => {
    for (const id of ['sky', 'todo', 'colony', 'a', '']) {
      const h = hashId(id);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe('placeholderStyle', () => {
  const ids = ['sky', 'todo', 'colony', 'weather', 'transit', 'sprites', 'wikistory', 'image-hunt', 'llm-duo-chat'];

  it('produces a css gradient background', () => {
    expect(placeholderStyle('sky', 0).background).toMatch(/^linear-gradient\(/);
  });

  it('is stable for the same id and index', () => {
    expect(placeholderStyle('sky', 3)).toEqual(placeholderStyle('sky', 3));
  });

  it('gives every real experiment id a distinct background', () => {
    const backgrounds = ids.map((id, i) => placeholderStyle(id, i).background);
    expect(new Set(backgrounds).size).toBe(ids.length);
  });

  it('keeps every pair of cards at least 15 degrees apart in hue', () => {
    const hues = ids.map((_, i) => primaryHue(i));
    for (let a = 0; a < hues.length; a++) {
      for (let b = a + 1; b < hues.length; b++) {
        const raw = Math.abs(hues[a] - hues[b]);
        const circular = Math.min(raw, 360 - raw);
        expect(circular).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('separates hues regardless of how many cards there are', () => {
    for (const count of [3, 6, 12, 20]) {
      const hues = Array.from({ length: count }, (_, i) => primaryHue(i));
      expect(new Set(hues).size).toBe(count);
    }
  });
});
```

String inequality is not visual distinctness: two gradients differing only in angle read as the same colour. The hue-separation test is the one that actually protects the gallery.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/platform/ui/placeholder.test.ts`
Expected: FAIL — cannot resolve `./placeholder.js`.

- [ ] **Step 3: Implement `src/platform/ui/placeholder.ts`**

FNV-1a, chosen because it is short, has no dependencies and spreads short strings well.

```ts
/** FNV-1a, 32-bit. */
export function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Golden angle. Successive multiples land as far from every previous value as
 *  possible, so hues stay separated for any number of cards — which hashing
 *  the id does not do: nine ids clustered three into one yellow-green band. */
const GOLDEN_ANGLE = 137.508;

/** The card's dominant hue, from its position in the registry rather than its
 *  id. Exported so the test can assert separation directly. */
export function primaryHue(index: number): number {
  return Math.round((index * GOLDEN_ANGLE) % 360);
}

/** A stable two-stop gradient for a card with no `art`. Position sets the hue
 *  so the gallery reads as distinct plates; the id hash sets the secondary
 *  stop and the angle, so each card still looks individual. Both lightness
 *  values stay dark enough for the caption to remain readable. */
export function placeholderStyle(id: string, index: number): { background: string } {
  const hash = hashId(id);
  const hue = primaryHue(index);
  const hueShift = 30 + ((hash >>> 9) % 90);
  const angle = 100 + ((hash >>> 17) % 80);
  return {
    background:
      `linear-gradient(${angle}deg, ` +
      `hsl(${hue} 42% 30%), ` +
      `hsl(${(hue + hueShift) % 360} 48% 15%))`,
  };
}
```

Hue comes from position, not the id, so adding an experiment reshuffles later
cards' colours. That is the right trade: a permanently well-spread gallery beats
colour identity for placeholders that real artwork replaces one by one anyway.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/platform/ui/placeholder.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/platform/ui/placeholder.ts src/platform/ui/placeholder.test.ts
git commit -m "feat(ui): add deterministic plate placeholder art"
```

---

### Task 7: Tokens, plate, gallery, colophon, shell

The visual layer, plus the new `App` that renders the gallery at `/` and falls through to the old `App.jsx` for anything not yet migrated.

**Files:**
- Create: `src/platform/ui/tokens.css`, `Plate.tsx`, `Plate.module.css`, `Gallery.tsx`, `Gallery.module.css`, `Colophon.tsx`, `Colophon.module.css`, `Shell.tsx`
- Create: `src/App.tsx`, `src/main.tsx`
- Modify: `index.html`
- Delete: `src/frontend/main.jsx`

**Interfaces:**
- Consumes: `REGISTRY`, `matchRoute`, `SECTIONS`, `placeholderStyle`
- Produces: `<Shell>`, `<Gallery>`, `<Plate>`, `<Colophon>`; `navigate(path: string): void` exported from `src/App.tsx`

- [ ] **Step 1: Create `src/platform/ui/tokens.css`**

```css
:root {
  --bg:            #0d0f14;
  --surface:       #151922;
  --surface-raised:#171a21;
  --border:        #232936;
  --border-strong: #2f3542;

  --text:          #e6e8ee;
  --text-strong:   #f2f4f8;
  --text-muted:    #79808f;
  --text-faint:    #5d6474;

  --section-tools:    #8fbf7a;
  --section-llm-toys: #a87fc9;
  --section-games:    #e8925f;

  --radius-plate: 9px;
  --radius-card:  7px;

  --step-0: 0.8125rem;
  --step-1: 0.9375rem;
  --step-2: 1.3125rem;
  --step-3: 1.75rem;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 40px;

  --font: ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
}
```

- [ ] **Step 2: Create `src/platform/ui/Plate.tsx` and `Plate.module.css`**

```tsx
import type { MouseEvent } from 'react';
import type { RegistryEntry } from '../../registry.js';
import { placeholderStyle } from './placeholder.js';
import styles from './Plate.module.css';

interface PlateProps {
  entry: RegistryEntry;
  /** position in REGISTRY — sets the placeholder hue, so it must be the
   *  gallery-wide index, not the index within a section */
  index: number;
  onNavigate: (path: string) => void;
}

export function Plate({ entry, index, onNavigate }: PlateProps) {
  const art = entry.art
    ? { backgroundImage: `url(${entry.art})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : placeholderStyle(entry.id, index);

  const handleClick = (event: MouseEvent) => {
    if (entry.external) return;          // let the browser follow the href
    event.preventDefault();
    onNavigate(entry.route);
  };

  return (
    <a
      className={styles.plate}
      href={entry.external ?? entry.route}
      onClick={handleClick}
      {...(entry.external ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      <div className={styles.art} style={art} />
      <div className={styles.caption}>
        <span className={styles.title}>
          {entry.title}
          {entry.external && <span className={styles.mark} aria-label="external"> ↗</span>}
        </span>
        <span className={styles.blurb}>{entry.blurb}</span>
      </div>
    </a>
  );
}
```

```css
/* Plate.module.css */
.plate {
  display: block;
  border-radius: var(--radius-card);
  overflow: hidden;
  background: var(--surface);
  text-decoration: none;
  color: inherit;
  border: 1px solid var(--border);
  transition: transform 120ms ease, border-color 120ms ease;
}
.plate:hover { transform: translateY(-2px); border-color: var(--border-strong); }
/* Artwork is authored at 1024x512. A ratio rather than a fixed height, so the
   art scales with the card instead of letterboxing at narrow widths. */
.art { aspect-ratio: 2 / 1; }
.caption { padding: var(--space-3); }
.title {
  display: block;
  font-size: var(--step-1);
  font-weight: 640;
  color: var(--text-strong);
}
.mark { color: var(--text-muted); }
.blurb {
  display: block;
  margin-top: var(--space-1);
  font-size: var(--step-0);
  color: var(--text-muted);
  line-height: 1.4;
}
```

- [ ] **Step 3: Create `src/platform/ui/Gallery.tsx` and `Gallery.module.css`**

```tsx
import { SECTIONS } from '../manifest.js';
import { REGISTRY } from '../../registry.js';
import { Plate } from './Plate.js';
import styles from './Gallery.module.css';

export function Gallery({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Experiments</h1>
      {SECTIONS.map(section => {
        const entries = REGISTRY.filter(entry => entry.section === section.id);
        if (entries.length === 0) return null;
        return (
          <section key={section.id} className={styles.band} data-section={section.id}>
            <h2 className={styles.sectionTitle}>{section.title}</h2>
            <p className={styles.sectionBlurb}>{section.blurb}</p>
            <div className={styles.grid}>
              {entries.map(entry => (
                <Plate
                  key={entry.id}
                  entry={entry}
                  index={REGISTRY.indexOf(entry)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
```

```css
/* Gallery.module.css */
.page { max-width: 1100px; margin: 0 auto; padding: var(--space-6) var(--space-4); }
.heading { font-size: var(--step-3); font-weight: 680; letter-spacing: -0.02em; margin: 0 0 var(--space-5); }
.band { border-radius: var(--radius-plate); padding: var(--space-4); margin-bottom: var(--space-4); }
.band[data-section='tools']    { background: color-mix(in srgb, var(--section-tools) 8%, var(--bg)); }
.band[data-section='llm-toys'] { background: color-mix(in srgb, var(--section-llm-toys) 8%, var(--bg)); }
.band[data-section='games']    { background: color-mix(in srgb, var(--section-games) 8%, var(--bg)); }
.sectionTitle { font-size: var(--step-2); font-weight: 680; letter-spacing: -0.02em; margin: 0; }
.sectionBlurb { font-size: var(--step-0); color: var(--text-muted); margin: 2px 0 var(--space-4); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-3); }
```

- [ ] **Step 4: Create `src/platform/ui/Colophon.tsx` and `Colophon.module.css`**

A plain element at the end of the document flow. No scroll listeners, no fade.

```tsx
import styles from './Colophon.module.css';

export function Colophon({ count, onNavigate }: { count: number; onNavigate: (path: string) => void }) {
  return (
    <footer className={styles.colophon}>
      <a
        className={styles.link}
        href="/"
        onClick={event => { event.preventDefault(); onNavigate('/'); }}
      >
        ◇ pages
      </a>
      {` — one of ${count} experiments · `}
      <kbd className={styles.kbd}>esc</kbd>
    </footer>
  );
}
```

```css
/* Colophon.module.css */
.colophon {
  border-top: 1px solid var(--border);
  margin: var(--space-6) var(--space-4) var(--space-4);
  padding-top: var(--space-3);
  font-size: var(--step-0);
  color: var(--text-faint);
}
.link { color: var(--text-muted); text-decoration: none; }
.link:hover { color: var(--text-strong); }
.kbd {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  padding: 1px 4px;
}
```

- [ ] **Step 5: Create `src/platform/ui/Shell.tsx`**

`esc` returns from every page, including `chrome: 'none'` ones.

```tsx
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { ChromeMode } from '../manifest.js';
import { Colophon } from './Colophon.js';

interface ShellProps {
  chrome: ChromeMode;
  experimentCount: number;
  onNavigate: (path: string) => void;
  children: ReactNode;
}

export function Shell({ chrome, experimentCount, onNavigate, children }: ShellProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onNavigate('/');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onNavigate]);

  return (
    <>
      {children}
      {chrome === 'colophon' && <Colophon count={experimentCount} onNavigate={onNavigate} />}
    </>
  );
}
```

- [ ] **Step 6: Create `src/jsx-modules.d.ts`**

`tsconfig.app.json` sets `allowJs: false`, so importing a `.jsx` file is a compile
error — and two places need to: `App.tsx` imports the legacy `App.jsx` below, and
Task 17 registers Colony's `page.jsx`, which stays untyped permanently. One shim covers
both, and unlike `allowJs: true` it does not drag every `.jsx` file into type checking.

```ts
/** Legacy and deliberately-untyped .jsx modules. Colony's page stays .jsx for
 *  the foreseeable future, so this file is permanent, not transitional. */
declare module '*.jsx' {
  import type { ComponentType } from 'react';
  const Component: ComponentType<Record<string, unknown>>;
  export default Component;
}
```

- [ ] **Step 7: Create `src/App.tsx`**

`LegacyApp` keeps every unmigrated page reachable. It is deleted in Task 22.

```tsx
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import type { ExperimentPageProps, RegistryEntry } from './registry.js';
import { REGISTRY } from './registry.js';
import { matchRoute } from './router.js';
import { Gallery } from './platform/ui/Gallery.js';
import { Shell } from './platform/ui/Shell.js';
import LegacyApp from './frontend/App.jsx';
import './platform/ui/tokens.css';

/** lazy() must not run during render — a fresh component identity each pass
 *  remounts the page and throws away its state. Cache one per experiment. */
const pageCache = new Map<string, ComponentType<ExperimentPageProps>>();

function pageFor(id: string, load: NonNullable<RegistryEntry['load']>) {
  let Page = pageCache.get(id);
  if (!Page) {
    Page = lazy(load);
    pageCache.set(id, Page);
  }
  return Page;
}

export default function App() {
  const [pathname, setPathname] = useState(window.location.pathname);

  const navigate = useCallback((path: string) => {
    if (window.location.pathname === path) return;
    window.history.pushState({}, '', path);
    setPathname(path);
  }, []);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const localCount = useMemo(() => REGISTRY.filter(entry => !entry.external).length, []);
  const match = matchRoute(pathname, REGISTRY);

  if (pathname === '/' || pathname === '') {
    return <Gallery onNavigate={navigate} />;
  }

  if (!match) return <LegacyApp />;

  const Page = pageFor(match.entry.id, match.entry.load!);
  return (
    <Shell chrome={match.entry.chrome} experimentCount={localCount} onNavigate={navigate}>
      <Suspense fallback={null}>
        <Page subpath={match.subpath} />
      </Suspense>
    </Shell>
  );
}
```

- [ ] **Step 8: Create `src/main.tsx`, delete `src/frontend/main.jsx`, update `index.html`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

In `index.html`, change the module script's `src` from `/src/frontend/main.jsx` to `/src/main.tsx`. Delete `src/frontend/main.jsx`.

`src/frontend/index.css` was imported by the old `main.jsx`; leave the file in place for now — `src/frontend/App.jsx` and the legacy pages still rely on Tailwind being loaded. Add its import to `src/main.tsx` directly below the `App` import:

```tsx
import './frontend/index.css';
```

- [ ] **Step 9: Verify in the browser**

```bash
npm run typecheck
npm run dev:restart
```

Visit `https://torment-nexus.local:5173/` — the gallery renders with two Game Ideas plates (Roguelike, Cult Game), each with distinct placeholder art and an ↗ mark. Visit `https://torment-nexus.local:5173/todo` — the legacy Todo page still loads via the fallback.

- [ ] **Step 10: Commit**

```bash
git add src/platform/ui src/App.tsx src/main.tsx index.html
git rm src/frontend/main.jsx
git commit -m "feat(ui): add tokens, plate, gallery, colophon and shell with legacy fallback"
```

---

### Task 8: Express host

Replaces `src/backend/index.ts` with a host that mounts slices at `/api/<id>`, isolates init failures, and fixes the error handler. No slices have moved yet, so the existing routers are mounted through the same helper at their current flat paths and re-namespaced one at a time by Tasks 9–17.

**Files:**
- Create: `src/server.ts`
- Modify: `package.json`
- Delete: `src/backend/index.ts`

**Interfaces:**
- Consumes: `corsOrigins`, `PORTS`, `ensureDataDir`
- Produces: `src/platform/server/slice.ts` exporting `SliceServer = { router: Router; init?: () => Promise<void>; attach?: (server: http.Server) => void }` — the contract every slice's `server/index.ts` implements

- [ ] **Step 1: Create `src/platform/server/slice.ts`**

The contract lives in `platform/`, not in `server.ts`. `server.ts` runs `start()` at
module load, so having slices import from it — even type-only — creates a cycle for no
reason.

```ts
import type { Router } from 'express';
import type http from 'http';

export interface SliceServer {
  router: Router;
  /** optional async setup; a rejection disables this slice, not the server */
  init?: () => Promise<void>;
  /** optional access to the raw http.Server, for WebSocket upgrades */
  attach?: (server: http.Server) => void;
}
```

- [ ] **Step 2: Create `src/server.ts`**

```ts
import 'dotenv/config';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';

import { corsOrigins, PORTS } from './platform/config.js';
import { ensureDataDir } from './platform/server/storage.js';
import type { SliceServer } from './platform/server/slice.js';

// Legacy routers — moved into slices by Tasks 9-17, one per task.
import todosRouter, { initTodoStorage } from './backend/routes/todos.js';
import mbtaRouter from './backend/routes/mbta.js';
import llmDuoChatRouter, { initLLMDuoChatWebSocket } from './backend/routes/llm-duo-chat.js';
import wikipediaStoryRouter from './backend/routes/wikipedia-story.js';
import spriteGroupsRouter from './backend/routes/sprite-groups.js';
import imageHuntRouter from './backend/routes/image-hunt.js';
import { initSessionStorage } from './backend/image-hunt-sessions.js';
import skyRouter from './backend/routes/sky.js';

const app: Express = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : PORTS.api;

app.use(cors({ origin: corsOrigins(), credentials: true }));
app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.get('origin')}`);
  next();
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/** Slices registered for mounting, keyed by manifest id. */
const slices: Array<{ id: string; slice: SliceServer }> = [];

/** Slices whose init() rejected. Their routes answer 503 rather than taking the
 *  whole server down — pages.service has Restart=always, so a throw at startup
 *  would otherwise loop every 3 seconds and take every experiment offline. */
const unavailable = new Set<string>();

function mount(id: string, slice: SliceServer): void {
  slices.push({ id, slice });
  app.use(`/api/${id}`, (req: Request, res: Response, next: NextFunction) => {
    if (unavailable.has(id)) {
      res.status(503).json({ error: `Experiment '${id}' failed to start` });
      return;
    }
    next();
  }, slice.router);
}

// --- Legacy flat mounts. Each disappears as its slice migrates. ---
app.use('/api', todosRouter);
app.use('/api', llmDuoChatRouter);
app.use('/api', wikipediaStoryRouter);
app.use('/api', spriteGroupsRouter);
app.use('/api', mbtaRouter);
app.use('/api', imageHuntRouter);
app.use('/api', skyRouter);

// Error handler. Express identifies these by an arity of four — the previous
// version took three parameters and so was registered as ordinary middleware
// that never fired.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);

async function start(): Promise<void> {
  await ensureDataDir();

  for (const { id, slice } of slices) {
    if (!slice.init) continue;
    try {
      await slice.init();
    } catch (error) {
      unavailable.add(id);
      console.error(`[${id}] init failed; experiment disabled:`, error);
    }
  }

  for (const { id, slice } of slices) {
    if (unavailable.has(id) || !slice.attach) continue;
    try {
      slice.attach(server);
    } catch (error) {
      unavailable.add(id);
      console.error(`[${id}] attach failed; experiment disabled:`, error);
    }
  }

  // Legacy init, removed as slices migrate.
  await Promise.all([
    initTodoStorage().catch(e => console.error('[legacy todos] init failed:', e)),
    initSessionStorage().catch(e => console.error('[legacy image-hunt] init failed:', e)),
  ]);
  initLLMDuoChatWebSocket(server);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
    if (unavailable.size > 0) {
      console.warn(`Disabled experiments: ${[...unavailable].join(', ')}`);
    }
  });
}

start();

export { mount };
```

- [ ] **Step 3: Point the dev script at the new host**

In `package.json`, change both `dev` and `start`:

```json
"dev": "concurrently \"vite\" \"tsx watch ./src/server.ts\"",
"start": "concurrently \"vite\" \"tsx watch ./src/server.ts\"",
```

The script *names* must not change — `pages.service` runs `npm run dev`.

- [ ] **Step 4: Delete the old entry point**

```bash
git rm src/backend/index.ts
```

- [ ] **Step 5: Add the mount-drift test**

The two lists — `REGISTRY` and the `mount()` calls in `src/server.ts` — are maintained by
hand, so a slice can be registered in the gallery while its backend is never mounted. This
catches that. Append to `src/registry.test.ts`:

```ts
import { readFileSync } from 'fs';

describe('registry and server mount list agree', () => {
  const serverSource = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.ts'),
    'utf-8',
  );

  it('mounts every entry that declares a server', () => {
    for (const entry of REGISTRY.filter(e => e.hasServer)) {
      expect(serverSource).toContain(`mount('${entry.id}'`);
    }
  });

  it('registers every mounted id', () => {
    const mounted = [...serverSource.matchAll(/mount\('([a-z0-9-]+)'/g)].map(m => m[1]);
    const registered = new Set(REGISTRY.filter(e => e.hasServer).map(e => e.id));
    for (const id of mounted) expect(registered.has(id)).toBe(true);
  });
});
```

Run: `npx vitest run src/registry.test.ts`
Expected: PASS, 10 tests. Both are vacuous now — no slice has migrated — and start
guarding at Task 9.

- [ ] **Step 6: Verify**

```bash
npm run typecheck
npm run dev:restart
curl -s http://localhost:5174/api/health
curl -s http://localhost:5174/api/todos
```

Expected: health returns `{"status":"ok",...}`; todos returns a JSON array. Confirm `data/` now exists at the repo root. Check `journalctl --user -u pages -n 30` for a clean start with no restart loop.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/platform/server/slice.ts src/registry.test.ts package.json
git rm src/backend/index.ts
git commit -m "feat(server): add slice-mounting host with init isolation, fix error handler arity"
```

---

## Slice migrations (Tasks 9–17)

Every slice task follows the same shape. These are **moves, not rewrites** — existing tests come along unchanged and are the regression net.

**The per-slice checklist, applied by each task below:**

1. `git mv` the files into `src/experiments/<id>/`, backend code into `server/`
2. Write `manifest.ts`
3. Add the entry to `REGISTRY` in `src/registry.ts`
4. Convert the router to slice-relative paths and export it as a `SliceServer`
5. Replace the legacy `app.use('/api', ...)` line in `src/server.ts` with `mount('<id>', slice)`
6. Update the page's `apiUrl` calls to the two-argument form
7. Rename the default export to `default function Page({ subpath }: ExperimentPageProps)`
8. Update the CLAUDE.md lines this task invalidated
9. `npm run typecheck && npm test`, then exercise the page in the browser
10. Commit

**`apiUrl` changes signature in Task 9**, the first slice to need it, and every later slice uses the new form.

---

### Task 9: Todo slice (and the `apiUrl` signature change)

**Files:**
- Create: `src/experiments/todo/manifest.ts`, `page.tsx`, `server/index.ts`
- Create: `src/platform/backendApi.ts`
- Modify: `src/registry.ts`, `src/server.ts`, `CLAUDE.md`
- Delete: `src/frontend/TodoList.tsx`, `src/backend/routes/todos.ts`

**`src/frontend/backendApi.ts` stays put until Task 22.** Every unmigrated page still
imports `apiUrl` from it with the old one-argument signature, and `src/frontend/App.jsx`
does too. The two helpers coexist: migrated slices import from `platform/`, legacy pages
keep the old file until they move. Deleting it here breaks six pages at once.

**Interfaces:**
- Consumes: `createJsonStore`, `SliceServer`, `ExperimentPageProps`
- Produces: `apiUrl(id: string, path: string): string`, `wsUrl(path: string): string`

- [ ] **Step 1: Create `src/platform/backendApi.ts`**

```ts
// API calls go through the Vite dev server's same-origin proxy (`/api` and
// `/ws` are proxied to the backend in vite.config.ts). Same-origin URLs mean
// the browser uses the page's own protocol and host, so this works over both
// HTTP and HTTPS without the backend needing TLS.

/** Builds a path into an experiment's namespace: apiUrl('todo', '/') -> /api/todo */
export function apiUrl(id: string, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized === '/' ? `/api/${id}` : `/api/${id}${normalized}`;
}

/** Health is the one route outside a slice namespace. */
export function healthUrl(): string {
  return '/api/health';
}

export function wsUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${normalized}`;
}
```

- [ ] **Step 2: Write the failing test for `apiUrl`**

`src/platform/backendApi.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { apiUrl, healthUrl } from './backendApi.js';

describe('apiUrl', () => {
  it('namespaces by experiment id', () => {
    expect(apiUrl('sky', '/cams')).toBe('/api/sky/cams');
  });

  it('accepts a path without a leading slash', () => {
    expect(apiUrl('sky', 'cams')).toBe('/api/sky/cams');
  });

  it('collapses the slice root to a bare namespace', () => {
    expect(apiUrl('todo', '/')).toBe('/api/todo');
  });

  it('keeps query strings intact', () => {
    expect(apiUrl('sky', '/frame/abc?asOf=1')).toBe('/api/sky/frame/abc?asOf=1');
  });
});

describe('healthUrl', () => {
  it('sits outside any slice namespace', () => {
    expect(healthUrl()).toBe('/api/health');
  });
});
```

Run: `npx vitest run src/platform/backendApi.test.ts`
Expected: PASS, 5 tests (the implementation was written in Step 1; if any fail, fix `backendApi.ts`).

- [ ] **Step 3: Move the page and route**

```bash
mkdir -p src/experiments/todo/server
git mv src/frontend/TodoList.tsx src/experiments/todo/page.tsx
git mv src/backend/routes/todos.ts src/experiments/todo/server/index.ts
```

- [ ] **Step 4: Create `src/experiments/todo/manifest.ts`**

```ts
import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'todo',
  title: 'Todo',
  blurb: 'A list, kept simple',
  section: 'tools',
  route: '/todo',
  chrome: 'colophon',
  hasServer: true,
};
```

- [ ] **Step 5: Rewrite `src/experiments/todo/server/index.ts` onto the storage helper**

Replace the file's storage block and route paths. The routes become slice-relative — `/todos` becomes `/`, `/todos/:id` becomes `/:id` — because the router now mounts at `/api/todo`.

```ts
import { Router, Request, Response } from 'express';
import { createJsonStore } from '../../../platform/server/storage.js';
import type { SliceServer } from '../../../platform/server/slice.js';

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

const store = createJsonStore<Todo[]>('todos', []);

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await store.read());
  } catch (error) {
    console.error('Error reading todos:', error);
    res.status(500).json({ error: 'Failed to read todos' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }
    const todos = await store.read();
    const newTodo: Todo = {
      id: Date.now().toString(),
      text: text.trim(),
      completed: false,
      createdAt: new Date().toISOString(),
    };
    todos.push(newTodo);
    await store.write(todos);
    res.status(201).json(newTodo);
  } catch (error) {
    console.error('Error creating todo:', error);
    res.status(500).json({ error: 'Failed to create todo' });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { completed, text } = req.body;
    const todos = await store.read();
    const index = todos.findIndex(t => t.id === id);
    if (index === -1) return res.status(404).json({ error: 'Todo not found' });
    if (typeof completed === 'boolean') todos[index].completed = completed;
    if (typeof text === 'string') todos[index].text = text.trim();
    await store.write(todos);
    res.json(todos[index]);
  } catch (error) {
    console.error('Error updating todo:', error);
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const todos = await store.read();
    const remaining = todos.filter(t => t.id !== id);
    if (remaining.length === todos.length) {
      return res.status(404).json({ error: 'Todo not found' });
    }
    await store.write(remaining);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting todo:', error);
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

const slice: SliceServer = { router };
export default slice;
```

`initTodoStorage` is gone — `createJsonStore` returns the fallback when the file is absent, so no warm-up is needed.

- [ ] **Step 6: Update `src/experiments/todo/page.tsx`**

Change the import and the four fetch calls:

```tsx
import { apiUrl } from '../../platform/backendApi.js';
import type { ExperimentPageProps } from '../../registry.js';
```

| Line | Was | Becomes |
| --- | --- | --- |
| 25 | `fetch(apiUrl('/todos'))` | `fetch(apiUrl('todo', '/'))` |
| 42 | `fetch(apiUrl('/todos'), {` | `fetch(apiUrl('todo', '/'), {` |
| 64 | `fetch(apiUrl(\`/todos/${id}\`), {` | `fetch(apiUrl('todo', \`/${id}\`), {` |
| 83 | `fetch(apiUrl(\`/todos/${id}\`), {` | `fetch(apiUrl('todo', \`/${id}\`), {` |

Change the component signature to the page contract and keep the default export:

```tsx
export default function TodoPage(_props: ExperimentPageProps) {
```

Leave the Tailwind classes alone — Task 18 handles them.

- [ ] **Step 7: Register the slice**

In `src/registry.ts`, add above the external entries:

```ts
import { manifest as todoManifest } from './experiments/todo/manifest.js';
```

```ts
  { ...todoManifest, load: () => import('./experiments/todo/page.js') },
```

In `src/server.ts`: delete the `todosRouter` import, the `initTodoStorage` import, the `app.use('/api', todosRouter)` line, and the `initTodoStorage()` entry in the legacy `Promise.all`. Add:

```ts
import todoSlice from './experiments/todo/server/index.js';
```

```ts
mount('todo', todoSlice);
```

Place `mount(...)` calls after the `/api/health` route and before the legacy flat mounts.

- [ ] **Step 8: Update CLAUDE.md**

- In *Backend*, remove `todos` from the mounted-routes list and drop the `initTodoStorage()` example from the add-a-route recipe.
- Replace the *Reaching the backend* bullet: the helpers live at `src/platform/backendApi.ts`, the signature is `apiUrl(id, path)` producing `/api/<id>/...`, and they use the same-origin `/api` proxy — **not** "port 5174 at the current hostname", which was already wrong.
- In *Long-term storage*, replace the `todos.json` reference with `data/` via `createJsonStore`.

- [ ] **Step 9: Verify**

```bash
npm run typecheck && npm test
npm run dev:restart
curl -s http://localhost:5174/api/todo
```

Expected: typecheck and tests pass; `curl` returns a JSON array. In the browser, `/` shows a Todo plate under Tools; clicking it loads the page; adding, toggling and deleting a todo all work; the colophon appears at the end of the page; `esc` returns to the gallery.

Migrate existing data if the old file has content worth keeping:

```bash
[ -s src/backend/todos.json ] && cp src/backend/todos.json data/todos.json
git rm --cached src/backend/todos.json 2>/dev/null || true
rm -f src/backend/todos.json
```

- [ ] **Step 10: Commit**

```bash
git add -A src/experiments/todo src/platform/backendApi.ts src/platform/backendApi.test.ts src/registry.ts src/server.ts CLAUDE.md
git commit -m "refactor(todo): migrate to slice, namespace api, switch to atomic store"
```

---

### Task 10: Weather slice

The simplest slice: no backend at all — it calls open-meteo directly.

**Files:**
- Create: `src/experiments/weather/manifest.ts`
- Modify: `src/registry.ts`, `CLAUDE.md`
- Move: `src/frontend/WeatherApp.tsx` → `src/experiments/weather/page.tsx`, `WeatherApp.css` → `weather.module.css`

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/experiments/weather
git mv src/frontend/WeatherApp.tsx src/experiments/weather/page.tsx
git mv src/frontend/WeatherApp.css src/experiments/weather/weather.module.css
```

- [ ] **Step 2: Create `src/experiments/weather/manifest.ts`**

```ts
import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'weather',
  title: 'Weather',
  blurb: 'Forecast, plainly',
  section: 'tools',
  route: '/weather',
  chrome: 'colophon',
  hasServer: false,
};
```

- [ ] **Step 3: Convert the stylesheet to a module**

The file is now a CSS Module, so class names must be referenced through the imported object. In `page.tsx`, replace the stylesheet import:

```tsx
import styles from './weather.module.css';
import type { ExperimentPageProps } from '../../registry.js';
```

Then convert every `className="foo bar"` in the file to `className={`${styles.foo} ${styles.bar}`}`. The file also carries seven Tailwind utility classes, and Weather is not one of the three pages Tasks 18–20 cover, so they come out here. Translate each into a token-based rule — a `flex items-center gap-2` attribute, for instance, becomes:

```css
.row { display: flex; align-items: center; gap: var(--space-2); }
```

Find them all with:

```bash
grep -oE 'className="[^"]*"' src/experiments/weather/page.tsx \
  | grep -E '(flex|p-[0-9]|px-|py-|mt-|mb-|gap-|text-|bg-|rounded|w-full|items-|justify-)'
```

Rename the component's default export:

```tsx
export default function WeatherPage(_props: ExperimentPageProps) {
```

- [ ] **Step 4: Register the slice**

In `src/registry.ts`:

```ts
import { manifest as weatherManifest } from './experiments/weather/manifest.js';
```

```ts
  { ...weatherManifest, load: () => import('./experiments/weather/page.js') },
```

- [ ] **Step 5: Update CLAUDE.md**

Remove `/weather` from the *Current pages* list — that list is replaced wholesale in Task 22, but until then it must not name migrated routes as though they still live in `App.jsx`.

- [ ] **Step 6: Verify**

```bash
npm run typecheck && npm test
npm run dev:restart
```

In the browser: `/` shows a Weather plate under Tools; the page renders with its styling intact; searching a location still works; the colophon appears; `esc` returns.

- [ ] **Step 7: Commit**

```bash
git add -A src/experiments/weather src/registry.ts CLAUDE.md
git commit -m "refactor(weather): migrate to slice with CSS module"
```

---

### Task 11: Transit slice

Also fixes `TransitDisplay.tsx:158`, which hardcodes `/api/mbta/transit-board` instead of using the helper.

**Files:**
- Create: `src/experiments/transit/manifest.ts`
- Move: `src/frontend/TransitDisplay.tsx` → `page.tsx`, `TransitDisplay.css` → `transit.module.css`, `src/backend/routes/mbta.ts` → `server/index.ts`
- Modify: `src/registry.ts`, `src/server.ts`, `CLAUDE.md`

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/experiments/transit/server
git mv src/frontend/TransitDisplay.tsx src/experiments/transit/page.tsx
git mv src/frontend/TransitDisplay.css src/experiments/transit/transit.module.css
git mv src/backend/routes/mbta.ts src/experiments/transit/server/index.ts
```

- [ ] **Step 2: Create `src/experiments/transit/manifest.ts`**

Transit is the one page with no way back — it is a wall display.

```ts
import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'transit',
  title: 'Transit',
  blurb: 'An arrivals board worth mounting on a wall',
  section: 'tools',
  route: '/transit',
  chrome: 'none',
  hasServer: true,
};
```

- [ ] **Step 3: Convert the router**

At the end of `src/experiments/transit/server/index.ts`, change the route path and the export. `/mbta/transit-board` becomes `/board`:

```ts
router.get('/board', async (_req: Request, res: Response) => {
```

Replace `export default router;` with:

```ts
import type { SliceServer } from '../../../platform/server/slice.js';

const slice: SliceServer = { router };
export default slice;
```

- [ ] **Step 4: Update the page**

```tsx
import styles from './transit.module.css';
import { apiUrl } from '../../platform/backendApi.js';
import type { ExperimentPageProps } from '../../registry.js';
```

Line 158 becomes:

```tsx
const res = await fetch(apiUrl('transit', '/board'));
```

Convert the `className` strings to `styles.*` references as in Task 10, and rename the export:

```tsx
export default function TransitPage(_props: ExperimentPageProps) {
```

- [ ] **Step 5: Register the slice**

`src/registry.ts`:

```ts
import { manifest as transitManifest } from './experiments/transit/manifest.js';
```

```ts
  { ...transitManifest, load: () => import('./experiments/transit/page.js') },
```

`src/server.ts`: remove the `mbtaRouter` import and its `app.use('/api', mbtaRouter)` line; add:

```ts
import transitSlice from './experiments/transit/server/index.js';
```

```ts
mount('transit', transitSlice);
```

- [ ] **Step 6: Update CLAUDE.md**

Remove `mbta` from the mounted-routes list and `/transit` from the *Current pages* list.

- [ ] **Step 7: Verify**

```bash
npm run typecheck && npm test
npm run dev:restart
curl -s http://localhost:5174/api/transit/board | head -c 200
```

Expected: JSON arrivals data. In the browser, `/transit` renders the board with **no colophon** — this is the one page that shows no way back. `esc` still returns to the gallery.

- [ ] **Step 8: Commit**

```bash
git add -A src/experiments/transit src/registry.ts src/server.ts CLAUDE.md
git commit -m "refactor(transit): migrate to slice, stop hardcoding the api path"
```

---

### Task 12: WikiStory slice

**Files:**
- Create: `src/experiments/wikistory/manifest.ts`
- Move: `src/frontend/WikiStory.tsx` → `page.tsx`; `src/backend/routes/wikipedia-story.ts` → `server/index.ts`; `src/backend/wikipedia.ts` and `wikipedia.test.ts` → `server/`
- Modify: `src/registry.ts`, `src/server.ts`, `CLAUDE.md`

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/experiments/wikistory/server
git mv src/frontend/WikiStory.tsx src/experiments/wikistory/page.tsx
git mv src/backend/routes/wikipedia-story.ts src/experiments/wikistory/server/index.ts
git mv src/backend/wikipedia.ts src/experiments/wikistory/server/wikipedia.ts
git mv src/backend/wikipedia.test.ts src/experiments/wikistory/server/wikipedia.test.ts
```

- [ ] **Step 2: Create `src/experiments/wikistory/manifest.ts`**

```ts
import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'wikistory',
  title: 'WikiStory',
  blurb: 'A story spun out of a random article',
  section: 'llm-toys',
  route: '/wikistory',
  chrome: 'colophon',
  hasServer: true,
};
```

- [ ] **Step 3: Convert the router**

In `server/index.ts`: the route `/wikipedia-story` becomes `/`; the `ollama` import path changes from `../ollama.js` to `../../../platform/server/ollama.js`; the `wikipedia.js` import becomes `./wikipedia.js`. Replace the default export:

```ts
import type { SliceServer } from '../../../platform/server/slice.js';

const slice: SliceServer = { router };
export default slice;
```

- [ ] **Step 4: Move ollama into platform**

This is the first slice to need it.

```bash
git mv src/backend/ollama.ts src/platform/server/ollama.ts
git mv src/backend/ollama.test.ts src/platform/server/ollama.test.ts
```

Update the remaining legacy importers still under `src/backend/routes/` (`llm-duo-chat.ts`, `image-hunt.ts`) to `../../platform/server/ollama.js` so the server keeps building.

- [ ] **Step 5: Update the page**

```tsx
import { apiUrl } from '../../platform/backendApi.js';
import type { ExperimentPageProps } from '../../registry.js';
```

Line 72 becomes:

```tsx
const response = await fetch(apiUrl('wikistory', '/'), {
```

Rename the export to `export default function WikiStoryPage(_props: ExperimentPageProps)`. Leave the Tailwind classes — Task 20 handles them.

- [ ] **Step 6: Register the slice**

`src/registry.ts`:

```ts
import { manifest as wikistoryManifest } from './experiments/wikistory/manifest.js';
```

```ts
  { ...wikistoryManifest, load: () => import('./experiments/wikistory/page.js') },
```

`src/server.ts`: remove the `wikipediaStoryRouter` import and its `app.use` line; add:

```ts
import wikistorySlice from './experiments/wikistory/server/index.js';
```

```ts
mount('wikistory', wikistorySlice);
```

- [ ] **Step 7: Update CLAUDE.md**

Remove `wikipedia-story` from the mounted-routes list and `/wikistory` from *Current pages*. Update the *Ollama library* heading and its import example — the path is now `src/platform/server/ollama.ts`, imported as `../../../platform/server/ollama.js` from a slice server.

- [ ] **Step 8: Verify**

```bash
npm run typecheck && npm test
npm run dev:restart
```

Expected: the `wikipedia` tests still pass from their new location. In the browser, `/wikistory` generates a story end to end (this streams from Ollama, so allow time), and the colophon appears below the finished text.

- [ ] **Step 9: Commit**

```bash
git add -A src/experiments/wikistory src/platform/server/ollama.ts src/platform/server/ollama.test.ts src/backend/routes src/registry.ts src/server.ts CLAUDE.md
git commit -m "refactor(wikistory): migrate to slice, move ollama into platform"
```

---

### Task 13: Image Hunt slice

Carries an SSE stream and a session store. The Vite proxy's `configure` hook exists specifically for this stream — do not disturb it.

**Files:**
- Create: `src/experiments/image-hunt/manifest.ts`
- Move: `src/frontend/ImageHunt.tsx` → `page.tsx`, `ImageHunt.css` → `image-hunt.module.css`, `src/backend/routes/image-hunt.ts` → `server/index.ts`, `src/backend/image-hunt-sessions.ts` → `server/sessions.ts`
- Modify: `src/registry.ts`, `src/server.ts`, `CLAUDE.md`

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/experiments/image-hunt/server
git mv src/frontend/ImageHunt.tsx src/experiments/image-hunt/page.tsx
git mv src/frontend/ImageHunt.css src/experiments/image-hunt/image-hunt.module.css
git mv src/backend/routes/image-hunt.ts src/experiments/image-hunt/server/index.ts
git mv src/backend/image-hunt-sessions.ts src/experiments/image-hunt/server/sessions.ts
```

- [ ] **Step 2: Create `src/experiments/image-hunt/manifest.ts`**

```ts
import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'image-hunt',
  title: 'Image Hunt',
  blurb: 'Scavenger hunts generated over an image set',
  section: 'llm-toys',
  route: '/image-hunt',
  chrome: 'colophon',
  hasServer: true,
};
```

Note the route changes from `/imagehunt` to `/image-hunt`, matching the id.

- [ ] **Step 3: Port the session store onto the storage helper**

The module already funnels all its I/O through two private helpers, `readAll` and `writeAll`,
behind a `withLock` serializer. Only those two change; the eight exported functions
(`listSessions`, `getSession`, `createSession`, `appendMatch`, `bumpAttempts`,
`renameSession`, `deleteSession`) keep their signatures and bodies.

Delete the `SESSIONS_FILE` constant, the `path`/`fileURLToPath` imports and the bodies of
`readAll`/`writeAll`, replacing them with:

```ts
import { createJsonStore } from '../../../platform/server/storage.js';

const store = createJsonStore<SessionsFile>('image-hunt-sessions', { sessions: [] });

async function readAll(): Promise<SessionsFile> {
  return store.read();
}

async function writeAll(file: SessionsFile): Promise<void> {
  await store.write(file);
}
```

`initSessionStorage` becomes a no-op that can be deleted outright — it existed only to
create the file if absent, and `createJsonStore` returns the fallback instead. Remove its
export and drop `init` from the slice below.

This also fixes a latent bug: the old `writeAll` used a single fixed temp path
(`${SESSIONS_FILE}.tmp`), so two concurrent writes could rename a half-written file over
the real one. The shared helper gives each write a unique temp name.

- [ ] **Step 4: Convert the router**

Route paths lose their `/image-hunt` prefix:

| Was | Becomes |
| --- | --- |
| `/image-hunt/models` | `/models` |
| `/image-hunt/sessions` | `/sessions` |
| `/image-hunt/sessions/:id` | `/sessions/:id` (GET, PATCH, DELETE) |
| `/image-hunt` | `/` |

Update the `ollama` import to `../../../platform/server/ollama.js` and the sessions import to `./sessions.js`. Drop the now-deleted `initSessionStorage` from that import. Replace the default export:

```ts
import type { SliceServer } from '../../../platform/server/slice.js';

const slice: SliceServer = { router };
export default slice;
```

- [ ] **Step 5: Update the page**

```tsx
import styles from './image-hunt.module.css';
import { apiUrl } from '../../platform/backendApi.js';
import type { ExperimentPageProps } from '../../registry.js';
```

| Line | Becomes |
| --- | --- |
| 58 | `fetch(apiUrl('image-hunt', '/sessions'))` |
| 66 | `fetch(apiUrl('image-hunt', '/models'))` |
| 101 | `fetch(apiUrl('image-hunt', \`/sessions/${id}\`))` |
| 118 | `fetch(apiUrl('image-hunt', \`/sessions/${id}\`), { method: 'DELETE' })` |
| 130 | `fetch(apiUrl('image-hunt', \`/sessions/${id}\`), {` |
| 156 | `new EventSource(apiUrl('image-hunt', \`/?${params.toString()}\`))` |

Convert `className` strings to `styles.*`, and rename the export to `export default function ImageHuntPage(_props: ExperimentPageProps)`.

- [ ] **Step 6: Register the slice**

`src/registry.ts`:

```ts
import { manifest as imageHuntManifest } from './experiments/image-hunt/manifest.js';
```

```ts
  { ...imageHuntManifest, load: () => import('./experiments/image-hunt/page.js') },
```

`src/server.ts`: remove the `imageHuntRouter` and `initSessionStorage` imports, the `app.use('/api', imageHuntRouter)` line, and the `initSessionStorage()` entry from the legacy `Promise.all`. Add:

```ts
import imageHuntSlice from './experiments/image-hunt/server/index.js';
```

```ts
mount('image-hunt', imageHuntSlice);
```

- [ ] **Step 7: Update CLAUDE.md**

Remove `image-hunt` from the mounted-routes list. Note in the add-a-route recipe that `init?` is now declared on the slice rather than called from the host.

- [ ] **Step 8: Verify**

```bash
npm run typecheck && npm test
npm run dev:restart
curl -s http://localhost:5174/api/image-hunt/sessions
```

In the browser, start a hunt and confirm the SSE stream still delivers progress. Then **reload mid-stream** and check `journalctl --user -u pages -f` — the backend scan loop must stop, proving the proxy's disconnect handling survived the move. Confirm `data/image-hunt-sessions.json` appears.

Migrate existing sessions:

```bash
[ -s src/backend/image-hunt-sessions.json ] && cp src/backend/image-hunt-sessions.json data/image-hunt-sessions.json
rm -f src/backend/image-hunt-sessions.json
```

- [ ] **Step 9: Commit**

```bash
git add -A src/experiments/image-hunt src/registry.ts src/server.ts CLAUDE.md
git commit -m "refactor(image-hunt): migrate to slice with declared init"
```

---

### Task 14: LLM Duo Chat slice

The only slice using `attach` — it upgrades WebSocket connections on the shared `http.Server`.

**Files:**
- Create: `src/experiments/llm-duo-chat/manifest.ts`
- Move: `src/frontend/LLMDuoChat.tsx` → `page.tsx`, `src/backend/routes/llm-duo-chat.ts` → `server/index.ts`
- Modify: `src/registry.ts`, `src/server.ts`, `CLAUDE.md`

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/experiments/llm-duo-chat/server
git mv src/frontend/LLMDuoChat.tsx src/experiments/llm-duo-chat/page.tsx
git mv src/backend/routes/llm-duo-chat.ts src/experiments/llm-duo-chat/server/index.ts
```

- [ ] **Step 2: Create `src/experiments/llm-duo-chat/manifest.ts`**

```ts
import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'llm-duo-chat',
  title: 'LLM Duo Chat',
  blurb: 'Two local models, one conversation, no human',
  section: 'llm-toys',
  route: '/llm-duo-chat',
  chrome: 'colophon',
  hasServer: true,
};
```

The route changes from `/llmduochat` to `/llm-duo-chat`.

- [ ] **Step 3: Convert the router**

`/llm-duo-chat/status` becomes `/status`. The ollama import becomes `../../../platform/server/ollama.js`. Rename the exported `initLLMDuoChatWebSocket` to fit the contract:

```ts
import type { SliceServer } from '../../../platform/server/slice.js';

const slice: SliceServer = {
  router,
  attach: (server) => initLLMDuoChatWebSocket(server),
};
export default slice;
```

Keep `initLLMDuoChatWebSocket` itself unchanged, including its WebSocket path `/ws/llm-duo-chat` — the Vite `/ws` proxy depends on that prefix.

- [ ] **Step 4: Update the page**

```tsx
import { apiUrl, wsUrl } from '../../platform/backendApi.js';
import type { ExperimentPageProps } from '../../registry.js';
```

Line 168 becomes `fetch(apiUrl('llm-duo-chat', '/status'))`. Line 71 is unchanged — `wsUrl('/ws/llm-duo-chat')` keeps its path. Rename the export to `export default function LLMDuoChatPage(_props: ExperimentPageProps)`. Leave the Tailwind classes for Task 19.

- [ ] **Step 5: Register the slice**

`src/registry.ts`:

```ts
import { manifest as llmDuoChatManifest } from './experiments/llm-duo-chat/manifest.js';
```

```ts
  { ...llmDuoChatManifest, load: () => import('./experiments/llm-duo-chat/page.js') },
```

`src/server.ts`: remove the `llmDuoChatRouter` / `initLLMDuoChatWebSocket` imports, the `app.use` line, and the bare `initLLMDuoChatWebSocket(server)` call. Add:

```ts
import llmDuoChatSlice from './experiments/llm-duo-chat/server/index.js';
```

```ts
mount('llm-duo-chat', llmDuoChatSlice);
```

- [ ] **Step 6: Update CLAUDE.md**

Remove `llm-duo-chat` from the mounted-routes list and `/llmduochat` from *Current pages*. Replace the `initLLMDuoChatWebSocket(server)` mention in the add-a-route recipe with the slice's `attach?(server)` hook.

- [ ] **Step 7: Verify**

```bash
npm run typecheck && npm test
npm run dev:restart
curl -s http://localhost:5174/api/llm-duo-chat/status
```

In the browser, `/llm-duo-chat` must open a WebSocket and run a conversation between two models. Check the devtools Network panel for a successful `wss://…/ws/llm-duo-chat` upgrade — this is the one behaviour the `attach` hook exists for.

- [ ] **Step 8: Commit**

```bash
git add -A src/experiments/llm-duo-chat src/registry.ts src/server.ts CLAUDE.md
git commit -m "refactor(llm-duo-chat): migrate to slice using the attach hook"
```

---

### Task 15: Sprite Tool slice

Promoted from Colony's tooling to a general tool at `/sprites`. It owns `sprite-groups.json` and publishes `client.ts`, the surface Colony imports in Task 17.

**Files:**
- Create: `src/experiments/sprites/manifest.ts`, `client.ts`, `types.ts`
- Move: `src/frontend/SpriteEditor.tsx` → `page.tsx`, `src/backend/routes/sprite-groups.ts` → `server/index.ts`, `src/backend/sprite-groups.json` → `src/experiments/sprites/sprite-groups.json`, `src/frontend/sprites.ts` → split (see Step 3)
- Modify: `src/registry.ts`, `src/server.ts`, `CLAUDE.md`, `README.md`

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/experiments/sprites/server
git mv src/frontend/SpriteEditor.tsx src/experiments/sprites/page.tsx
git mv src/backend/routes/sprite-groups.ts src/experiments/sprites/server/index.ts
git mv src/backend/sprite-groups.json src/experiments/sprites/sprite-groups.json
git mv src/frontend/sprites.ts src/experiments/sprites/client.ts
```

`sprite-groups.json` is authored content, so it stays in the repo rather than moving to `data/`.

- [ ] **Step 2: Create `src/experiments/sprites/manifest.ts`**

```ts
import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'sprites',
  title: 'Sprite Tool',
  blurb: 'Name rectangular regions of a sheet so games stop hardcoding coordinates',
  section: 'tools',
  route: '/sprites',
  chrome: 'colophon',
  hasServer: true,
};
```

The route changes from `/sprite-editor` to `/sprites`.

- [ ] **Step 3: Create `src/experiments/sprites/types.ts`**

Pull the shared shapes out of `client.ts` so both sides and Colony can import them without pulling in fetch code:

```ts
export interface SpriteGroup {
  name: string;
  sheet: string;
  startRow: number;
  startCol: number;
  widthTiles: number;
  heightTiles: number;
}

export interface SpriteGroupsFile {
  groups: SpriteGroup[];
}
```

In `client.ts`, delete the local copies of those interfaces and re-export them so existing importers keep working:

```ts
export type { SpriteGroup, SpriteGroupsFile } from './types.js';
import type { SpriteGroup, SpriteGroupsFile } from './types.js';
```

- [ ] **Step 4: Update `client.ts`**

```ts
import { apiUrl } from '../../platform/backendApi.js';
```

Line 104 becomes:

```ts
const response = await fetch(apiUrl('sprites', '/groups'));
```

Line 62 (`fetch('/sprites/manifest.json')`) is unchanged — that is a static asset under `public/`, not an API route. Note the coincidence: the public asset path `/sprites/manifest.json` and the new route `/sprites` share a prefix but never collide, because the asset is served by Vite and the route lives under `/api/sprites`.

**Repoint Colony's import in the same step.** `src/frontend/ColonyGame.jsx` has not migrated
yet (that is Task 17) and imports `./sprites`, which this task just moved out from under it.
Update that import now or Colony breaks for two tasks:

```jsx
import { loadSpriteManifest, getSpriteUrl, loadSpriteGroups, resolveSpriteGroup }
  from '../experiments/sprites/client.js';
```

- [ ] **Step 5: Convert the router**

`/sprite-groups` becomes `/groups` for both GET and POST. The JSON file path changes to `path.join(__dirname, '..', 'sprite-groups.json')`. Replace the default export:

```ts
import type { SliceServer } from '../../../platform/server/slice.js';

const slice: SliceServer = { router };
export default slice;
```

- [ ] **Step 6: Update the page**

```tsx
import { apiUrl } from '../../platform/backendApi.js';
import type { ExperimentPageProps } from '../../registry.js';
```

Line 343 becomes `fetch(apiUrl('sprites', '/groups'), {`. Rename the export to `export default function SpriteToolPage(_props: ExperimentPageProps)`. `SpriteEditor` uses inline styles, so there is no stylesheet to convert.

- [ ] **Step 7: Register the slice**

`src/registry.ts`:

```ts
import { manifest as spritesManifest } from './experiments/sprites/manifest.js';
```

```ts
  { ...spritesManifest, load: () => import('./experiments/sprites/page.js') },
```

`src/server.ts`: remove the `spriteGroupsRouter` import and its `app.use` line; add:

```ts
import spritesSlice from './experiments/sprites/server/index.js';
```

```ts
mount('sprites', spritesSlice);
```

- [ ] **Step 8: Update the docs**

CLAUDE.md — the whole *Sprite Groups system* section keeps its substance but changes paths:

- Schema path → `src/experiments/sprites/sprite-groups.json`
- Backend API → `src/experiments/sprites/server/index.ts`, `GET|POST /api/sprites/groups`
- Frontend helpers → `src/experiments/sprites/client.ts`, types in `types.ts`
- Editor → `/sprites`, `src/experiments/sprites/page.tsx`
- Remove `sprite-groups` from the mounted-routes list and `/sprite-editor` from *Current pages*

README.md — same path and endpoint corrections in the *Frontend usage* and *Defining multi-tile sprites* sections.

- [ ] **Step 9: Verify**

```bash
npm run typecheck && npm test
npm run dev:restart
curl -s http://localhost:5174/api/sprites/groups | head -c 200
```

In the browser, `/sprites` loads the editor, the three sheet tabs work, drag-select names and adds a group, and Save persists — reload and confirm the group survived. Then check `/colony`, still on the legacy path: its buildings must render from sprite groups rather than solid colour rectangles, proving the repointed import in Step 4 resolves.

- [ ] **Step 10: Commit**

```bash
git add -A src/experiments/sprites src/registry.ts src/server.ts CLAUDE.md README.md
git commit -m "refactor(sprites): promote sprite editor to its own slice at /sprites"
```

---

### Task 16: Sky slice

The largest backend move: seven modules, a fixture, and the `/sky/map` sub-route that must **not** appear in the gallery.

**Files:**
- Create: `src/experiments/sky/manifest.ts`
- Move: `SkyPantone.tsx` → `page.tsx`, `SkyPantone.css` → `sky.module.css`, `SkyMap.tsx` + `SkyMap.css` → slice, `routes/sky.ts` → `server/index.ts`, and `sky-cams.ts`, `sky-frame.ts`, `sky-source.ts`, `frame-sources.ts`, `sun.ts`, `color.ts`, `pantone.ts`, `pantone.json`, all `*.test.ts`, `__fixtures__/` → `server/`
- Modify: `src/registry.ts`, `src/server.ts`, `CLAUDE.md`

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/experiments/sky/server
git mv src/frontend/SkyPantone.tsx src/experiments/sky/page.tsx
git mv src/frontend/SkyPantone.css src/experiments/sky/sky.module.css
git mv src/frontend/SkyMap.tsx src/experiments/sky/SkyMap.tsx
git mv src/frontend/SkyMap.css src/experiments/sky/skymap.module.css
git mv src/backend/routes/sky.ts src/experiments/sky/server/index.ts
for f in sky-cams sky-frame sky-source frame-sources sun color pantone; do
  git mv "src/backend/$f.ts" "src/experiments/sky/server/$f.ts"
  [ -f "src/backend/$f.test.ts" ] && git mv "src/backend/$f.test.ts" "src/experiments/sky/server/$f.test.ts"
done
git mv src/backend/pantone.json src/experiments/sky/server/pantone.json
git mv src/backend/__fixtures__ src/experiments/sky/server/__fixtures__
```

- [ ] **Step 2: Create `src/experiments/sky/manifest.ts`**

```ts
import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'sky',
  title: 'Sky Pantone',
  blurb: 'The sky right now, reduced to a single paint chip',
  section: 'tools',
  route: '/sky',
  chrome: 'colophon',
  hasServer: true,
};
```

There is deliberately **no manifest entry for the map**. It is a sub-route, reachable only from inside the page.

- [ ] **Step 3: Fix the intra-slice imports**

Inside `server/`, the modules now sit beside each other, so `../sun.js` style imports become `./sun.js`. `server/index.ts` imports its siblings with `./`. Any fixture path in a test that pointed at `../__fixtures__` becomes `./__fixtures__`.

- [ ] **Step 4: Convert the router**

| Was | Becomes |
| --- | --- |
| `/sky/cams` | `/cams` |
| `/sky/nearest` | `/nearest` |
| `/sky` | `/` |
| `/sky/frame/:camId` | `/frame/:camId` |

Replace the default export:

```ts
import type { SliceServer } from '../../../platform/server/slice.js';

const slice: SliceServer = { router };
export default slice;
```

- [ ] **Step 5: Wire the sub-route in the page**

`page.tsx` becomes the slice's router. It renders the nearest-sky reading at the root and the map at `/sky/map`:

```tsx
import styles from './sky.module.css';
import { apiUrl } from '../../platform/backendApi.js';
import type { ExperimentPageProps } from '../../registry.js';
import SkyMap from './SkyMap.js';

export default function SkyPage({ subpath }: ExperimentPageProps) {
  if (subpath[0] === 'map') return <SkyMap />;
  // ...existing Sky Pantone body...
}
```

Update the API calls:

| Line | Becomes |
| --- | --- |
| 86 | `fetch(apiUrl('sky', \`/nearest?lat=${latitude}&lon=${longitude}\`))` |
| 115 | `fetch(apiUrl('sky', camId ? \`/?cam=${encodeURIComponent(camId)}\` : '/'))` |
| 204 | `src={apiUrl('sky', \`/frame/${reading.cam.id}?asOf=${encodeURIComponent(reading.asOf)}\`)}` |

In `SkyMap.tsx`, line 128 becomes `fetch(apiUrl('sky', '/cams'))`. Line 115 (`fetch('/world-land.geojson')`) is a static asset and stays. Convert both stylesheets to module references.

Add a link into the map from the Sky Pantone body, since the gallery no longer offers one — place it near the camera name, after a reading has rendered:

```tsx
<a href="/sky/map" onClick={e => { e.preventDefault(); window.history.pushState({}, '', '/sky/map'); window.dispatchEvent(new PopStateEvent('popstate')); }}>
  change camera
</a>
```

- [ ] **Step 6: Register the slice**

`src/registry.ts`:

```ts
import { manifest as skyManifest } from './experiments/sky/manifest.js';
```

```ts
  { ...skyManifest, load: () => import('./experiments/sky/page.js') },
```

`src/server.ts`: remove the `skyRouter` import and its `app.use` line; add:

```ts
import skySlice from './experiments/sky/server/index.js';
```

```ts
mount('sky', skySlice);
```

- [ ] **Step 7: Update CLAUDE.md**

Remove `sky` from the mounted-routes list and `/sky`, `/sky/map` from *Current pages*. **Delete the `dist/backend` / `pantone.json` trap paragraph** — `pantone.json` now lives in the slice and Task 22 removes the emitting build, so the warning describes nothing.

- [ ] **Step 8: Verify**

```bash
npm run typecheck && npm test
npm run dev:restart
curl -s "http://localhost:5174/api/sky/cams" | head -c 200
```

Expected: all sky tests pass from their new location — this is the largest test group in the repo, so a failure here means an import path was missed. In the browser: `/sky` reads the nearest camera and shows a swatch; the "change camera" link goes to `/sky/map`; the map lists cameras and selecting one returns to a reading. Confirm `/` shows **one** Sky plate and no Sky Map plate.

- [ ] **Step 9: Commit**

```bash
git add -A src/experiments/sky src/registry.ts src/server.ts CLAUDE.md
git commit -m "refactor(sky): migrate to slice with /sky/map as a sub-route"
```

---

### Task 17: Colony slice

Stays `.jsx`. Its only novelty is the cross-slice import from `sprites`.

**Files:**
- Create: `src/experiments/colony/manifest.ts`
- Move: `src/frontend/ColonyGame.jsx` → `page.jsx`, `ColonyGame.css` → `colony.module.css`
- Modify: `src/registry.ts`, `CLAUDE.md`

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/experiments/colony
git mv src/frontend/ColonyGame.jsx src/experiments/colony/page.jsx
git mv src/frontend/ColonyGame.css src/experiments/colony/colony.module.css
```

- [ ] **Step 2: Create `src/experiments/colony/manifest.ts`**

```ts
import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'colony',
  title: 'Colony Builder',
  blurb: 'Tile-based colony sim on a hand-drawn map',
  section: 'games',
  route: '/colony',
  chrome: 'colophon',
  hasServer: false,
};
```

- [ ] **Step 3: Update the cross-slice import**

In `page.jsx`, the sprite helpers now come from the Sprite Tool's published surface:

```jsx
import { loadSpriteManifest, getSpriteUrl, loadSpriteGroups, resolveSpriteGroup } from '../sprites/client.js';
```

This is the one permitted cross-slice import: `client.ts` only, never `page` and never anything under `server/`.

Convert the stylesheet import to a module and its `className` strings to `styles.*`.

- [ ] **Step 4: Register the slice**

`src/registry.ts`:

```ts
import { manifest as colonyManifest } from './experiments/colony/manifest.js';
```

```ts
  { ...colonyManifest, load: () => import('./experiments/colony/page.jsx') },
```

`tsconfig.app.json` sets `allowJs: false`, so `page.jsx` is not type-checked. That is intended — Colony stays untyped for now.

- [ ] **Step 5: Update CLAUDE.md**

Remove `/colony` from *Current pages*. In the *ColonyGame integration* section, update the file path and note the import now comes from `experiments/sprites/client.ts`. The fallback chain and the `null`-tile rendering rule keep their wording.

- [ ] **Step 6: Verify**

```bash
npm run typecheck && npm test
npm run dev:restart
```

In the browser, `/colony` renders the map, buildings draw from their sprite groups (not solid colour rectangles — that fallback means the group lookup broke), placement works, and the colophon sits below the canvas.

- [ ] **Step 7: Commit**

```bash
git add -A src/experiments/colony src/registry.ts CLAUDE.md
git commit -m "refactor(colony): migrate to slice, import sprites via client surface"
```

---

## Tailwind removal (Tasks 18–21)

Three pages still carry utility classes. Each is rewritten alone and checked in the browser before the next, because nothing automated covers their appearance.

---

### Task 18: TodoList to CSS Modules

**Files:**
- Create: `src/experiments/todo/todo.module.css`
- Modify: `src/experiments/todo/page.tsx`

- [ ] **Step 1: Inventory the classes**

```bash
grep -o 'className="[^"]*"' src/experiments/todo/page.tsx
```

Expected: roughly 24 utility-class attributes.

- [ ] **Step 2: Write `todo.module.css`**

Create one semantic class per element the page styles — `.page`, `.header`, `.form`, `.input`, `.addButton`, `.list`, `.item`, `.itemDone`, `.checkbox`, `.text`, `.deleteButton` — expressed with tokens rather than utilities. Example of the translation:

```css
.page {
  max-width: 640px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}
.form { display: flex; gap: var(--space-2); margin-bottom: var(--space-4); }
.input {
  flex: 1;
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  color: var(--text);
  font-size: var(--step-1);
}
.item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border-bottom: 1px solid var(--border);
}
.itemDone .text { color: var(--text-faint); text-decoration: line-through; }
```

- [ ] **Step 3: Replace the classNames**

```tsx
import styles from './todo.module.css';
```

Swap each utility string for its `styles.*` equivalent. Where a class was conditional, use a template literal:

```tsx
<li className={`${styles.item} ${todo.completed ? styles.itemDone : ''}`}>
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npm run dev:restart
```

Open `/todo`. Add, toggle and delete a todo. Completed items must still read as completed. Confirm no `class="p-4 flex …"` strings remain:

```bash
grep -E 'className="[^"]*(flex|p-[0-9]|bg-|text-)' src/experiments/todo/page.tsx
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/experiments/todo
git commit -m "style(todo): replace tailwind utilities with a css module"
```

---

### Task 19: LLM Duo Chat to CSS Modules

**Files:**
- Create: `src/experiments/llm-duo-chat/llm-duo-chat.module.css`
- Modify: `src/experiments/llm-duo-chat/page.tsx`

- [ ] **Step 1: Inventory the classes**

```bash
grep -o 'className="[^"]*"' src/experiments/llm-duo-chat/page.tsx
```

Expected: roughly 24 utility-class attributes.

- [ ] **Step 2: Write `llm-duo-chat.module.css`**

The page's structure is a transcript of alternating speakers, so the classes it needs are `.page`, `.controls`, `.select`, `.startButton`, `.stopButton`, `.transcript`, `.turn`, `.turnA`, `.turnB`, `.speaker`, `.body`, `.status`. Give the two speakers distinct accents so the alternation stays readable:

```css
.transcript { display: flex; flex-direction: column; gap: var(--space-3); }
.turn {
  border-left: 3px solid var(--border-strong);
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border-radius: 0 var(--radius-card) var(--radius-card) 0;
}
.turnA { border-left-color: var(--section-llm-toys); }
.turnB { border-left-color: var(--section-tools); }
.speaker {
  font-size: var(--step-0);
  font-weight: 640;
  color: var(--text-strong);
  margin-bottom: var(--space-1);
}
.body { font-size: var(--step-1); line-height: 1.55; color: var(--text); }
.status { font-family: var(--font-mono); font-size: var(--step-0); color: var(--text-faint); }
```

- [ ] **Step 3: Replace the classNames**

```tsx
import styles from './llm-duo-chat.module.css';
```

Swap each utility string, using template literals where a class depends on which model is speaking.

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npm run dev:restart
```

Open `/llm-duo-chat`, start a conversation, and confirm the two speakers remain visually distinguishable as turns stream in, and that the transcript scrolls as before.

```bash
grep -E 'className="[^"]*(flex|p-[0-9]|bg-|text-)' src/experiments/llm-duo-chat/page.tsx
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/experiments/llm-duo-chat
git commit -m "style(llm-duo-chat): replace tailwind utilities with a css module"
```

---

### Task 20: WikiStory to CSS Modules

The largest of the three (32 utility attributes), and the only one that must style `react-markdown` output. Its source already notes that `@tailwindcss/typography` was never installed, so markdown elements are currently styled partly by hand and partly by browser defaults.

**Files:**
- Create: `src/experiments/wikistory/wikistory.module.css`
- Modify: `src/experiments/wikistory/page.tsx`

- [ ] **Step 1: Inventory the classes and the markdown comment**

```bash
grep -o 'className="[^"]*"' src/experiments/wikistory/page.tsx
sed -n '10,20p' src/experiments/wikistory/page.tsx
```

- [ ] **Step 2: Write `wikistory.module.css`**

Include an explicit block for markdown output. `react-markdown` renders bare `<h1>`, `<p>`, `<ul>`, `<li>`, `<em>`, `<strong>`, `<blockquote>`, so style them by element inside a wrapper class rather than trying to put classes on generated nodes:

```css
.page { max-width: 720px; margin: 0 auto; padding: var(--space-6) var(--space-4); }
.controls { display: flex; gap: var(--space-2); margin-bottom: var(--space-5); }

.story { font-size: var(--step-1); line-height: 1.65; color: var(--text); }
.story h1, .story h2, .story h3 {
  color: var(--text-strong);
  letter-spacing: -0.01em;
  margin: var(--space-5) 0 var(--space-2);
}
.story h1 { font-size: var(--step-3); }
.story h2 { font-size: var(--step-2); }
.story p { margin: 0 0 var(--space-3); }
.story ul, .story ol { margin: 0 0 var(--space-3); padding-left: var(--space-5); }
.story li { margin-bottom: var(--space-1); }
.story em { color: var(--text-muted); }
.story strong { color: var(--text-strong); font-weight: 640; }
.story blockquote {
  margin: var(--space-3) 0;
  padding-left: var(--space-3);
  border-left: 2px solid var(--border-strong);
  color: var(--text-muted);
}
.story code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: var(--surface);
  padding: 1px 4px;
  border-radius: 3px;
}
```

- [ ] **Step 3: Replace the classNames and wrap the markdown**

```tsx
import styles from './wikistory.module.css';
```

Wrap the `<ReactMarkdown>` element in `<div className={styles.story}>` so the element selectors above apply, and swap the remaining utility strings. Delete the stale comment about `@tailwindcss/typography`.

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npm run dev:restart
```

Open `/wikistory` and generate a story. Check that headings, paragraphs, lists, emphasis and any block quotes all render with deliberate spacing — this is the page most likely to look unstyled if a selector is missed.

```bash
grep -E 'className="[^"]*(flex|p-[0-9]|bg-|text-)' src/experiments/wikistory/page.tsx
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/experiments/wikistory
git commit -m "style(wikistory): replace tailwind utilities, style markdown explicitly"
```

---

### Task 21: Remove Tailwind

**Files:**
- Modify: `package.json`, `src/main.tsx`
- Delete: `tailwind.config.js`, `postcss.config.js`, `src/frontend/index.css`

- [ ] **Step 1: Confirm nothing still uses it**

```bash
grep -rn "tailwind" src/ index.html
grep -rEn 'className="[^"]*(flex |grid |p-[0-9]|px-|py-|mt-|mb-|gap-|text-[a-z]|bg-|rounded|w-full|items-|justify-)' src/experiments src/platform
```

Expected: no output from either. If anything appears, fix it before continuing.

- [ ] **Step 2: Delete the config and legacy stylesheet**

```bash
git rm tailwind.config.js postcss.config.js src/frontend/index.css
```

Remove the `import './frontend/index.css';` line from `src/main.tsx`. `tokens.css` is already imported by `src/App.tsx`.

- [ ] **Step 3: Drop the dependencies**

```bash
npm uninstall tailwindcss @tailwindcss/postcss autoprefixer postcss
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm test
npm run build
npm run dev:restart
```

Expected: build succeeds with no PostCSS plugin errors. Visit `/`, `/todo`, `/wikistory`, `/llm-duo-chat`, `/sky`, `/colony` and confirm each still renders correctly — a missing token import shows up as unstyled text.

- [ ] **Step 5: Commit**

```bash
git add -A package.json package-lock.json src/main.tsx
git rm tailwind.config.js postcss.config.js src/frontend/index.css
git commit -m "build: remove tailwind, postcss and autoprefixer"
```

---

### Task 22: Retire the legacy tree and finish the docs

**Files:**
- Modify: `src/App.tsx`, `tsconfig.app.json`, `package.json`, `CLAUDE.md`, `README.md`
- Rename: `vite.config.js` → `vite.config.ts`
- Delete: `src/frontend/`, `src/backend/`

- [ ] **Step 1: Confirm the legacy tree is empty of live code**

```bash
ls -R src/frontend src/backend 2>/dev/null
grep -rn "from '.*frontend/\|from '.*backend/" src/ --include=*.ts --include=*.tsx --include=*.jsx
```

Expected: only `src/frontend/App.jsx` and `src/frontend/App.css` remain, referenced solely by the fallback import in `src/App.tsx`.

- [ ] **Step 2: Remove the fallback**

In `src/App.tsx`, delete the `LegacyApp` import and replace the fallback branch with a not-found state:

```tsx
  if (!match) {
    return (
      <Shell chrome="colophon" experimentCount={localCount} onNavigate={navigate}>
        <main style={{ maxWidth: 640, margin: '0 auto', padding: 40 }}>
          <h1>Nothing here</h1>
          <p>No experiment owns <code>{pathname}</code>.</p>
        </main>
      </Shell>
    );
  }
```

- [ ] **Step 3: Delete the legacy trees**

```bash
git rm -r src/frontend src/backend
```

In `tsconfig.app.json`, drop `"src/frontend/**"` and `"src/backend/**"` from `exclude`, leaving only `"src/**/server/**"`.

- [ ] **Step 4: Rename the Vite config and source its hosts from `config.ts`**

```bash
git mv vite.config.js vite.config.ts
```

In `vite.config.ts`, import the shared list so hostnames are declared once:

```ts
import { HOSTNAMES, PORTS } from './src/platform/config.js';
```

Replace the hardcoded values:

```ts
    allowedHosts: HOSTNAMES.filter(host => host !== 'localhost') as string[],
```

```ts
      '/api': { target: `http://localhost:${PORTS.api}`, /* keep the existing configure hook verbatim */ },
      '/ws': { target: `ws://localhost:${PORTS.api}`, ws: true },
```

and `.listen(PORTS.httpRedirect, '0.0.0.0')` in the redirect plugin.

**Do not alter the `configure` hook or its comment** — it prevents zombie SSE scan loops from flooding Ollama.

- [ ] **Step 5: Stop emitting an unrunnable backend build**

In `package.json`:

```json
"build": "npm run build:sprites && vite build && tsc --noEmit -p tsconfig.server.json",
```

Delete `src/backend/tsconfig.json` if `git rm -r src/backend` did not already remove it.

- [ ] **Step 6: Rewrite CLAUDE.md's remaining stale sections**

Working through what Tasks 9–17 did not already fix:

- *Architecture* opening — replace the `src/frontend` / `src/backend` split with the slice layout
- *Frontend* — remove "styled with Tailwind CSS 4"; replace the `App.jsx` routing paragraph and the add-a-page recipe with: create `src/experiments/<id>/` with `manifest.ts` and `page.tsx`, add one line to `src/registry.ts`, and add `server/index.ts` plus a `mount()` line if it needs a backend
- *Frontend* — replace the *Current pages* list with a pointer to `src/registry.ts` as the source of truth, so it cannot drift again
- *Backend* — replace the routes paragraph with `/api/<id>` namespacing and the `SliceServer` contract (`router`, `init?`, `attach?`), including that a failing `init` disables one slice rather than the server
- *Backend* — CORS origins are generated from `src/platform/config.ts`, not hand-listed
- *Backend* — the build type-checks with `--noEmit` and emits no backend output
- *Tech stack* — drop Tailwind, add CSS Modules
- *HTTPS / proxy* — `vite.config.ts`, with `allowedHosts` sourced from `config.ts`

- [ ] **Step 7: Rewrite README.md's opening and fix its broken block**

Replace lines 1–16 (unreplaced `create-vite` boilerplate) with a short description: what the project is, the slice layout, how to run it, and that the dev server is a systemd user unit.

Fix the defect at lines 102–104 — a stray `const roadSprite = getSpriteUrl(...)` statement and an orphaned closing fence sitting after the "Coordinates are sheet-relative" paragraph. Delete both.

- [ ] **Step 8: Full verification**

```bash
npm run typecheck && npm test && npm run lint && npm run build
npm run dev:restart
systemctl --user status pages
```

Expected: all green, service active with no restart loop. Then walk every route: `/`, `/todo`, `/weather`, `/transit`, `/sky`, `/sky/map`, `/sprites`, `/wikistory`, `/llm-duo-chat`, `/image-hunt`, `/colony`, plus a deliberate `/nonsense` for the not-found state. Confirm the gallery shows nine local plates in three sections plus two external ↗ cards, and that `/transit` alone has no colophon.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: retire legacy src/frontend and src/backend, finish docs"
```

---

## Deferred

Recorded so they are not mistaken for oversights:

- **Absorbing `cosmic`, `dream`, `cult-game`.** Each is now a matter of adding one slice folder.
- **Real artwork.** Every plate uses generated placeholders until `public/art/<id>.webp` files exist and `manifest.art` points at them.
- **Roguelike and Cult Game ports.** `EXTERNAL_URLS` assigns 5178 and 5179; those services must be started on those ports, or the values updated, before the links resolve.
- **Typing `ColonyGame`.** Still `.jsx`, still unchecked.
- **Frontend tests.** No coverage; the Tailwind rewrites in particular were verified by eye.
- **Fixing sibling port collisions.** `cult-game` on 5174 and `cosmic` on 5177 are recorded in `NEIGHBOUR_PORTS` but not fixed.
