# Structure Refresh — Design

**Date:** 2026-08-09
**Status:** Approved for planning

## Purpose

`pages` is a collection of small self-contained experiments. Its current structure was
built incrementally with weaker tooling and has drifted: routing is an if-ladder, styling
is split between two incompatible systems, backend modules belonging to one experiment sit
at the top level looking shared, runtime data is committed into the source tree, and the
front page is a column of buttons.

This refresh restructures the repository around **one folder per experiment**, replaces the
front page with a sectioned gallery of poster plates, and makes each page connect back to
the collection quietly rather than announcing it.

### Goals

1. Adding, reading, or removing an experiment touches one folder.
2. The front page presents the collection as something made, not a launcher.
3. Pages feel like they belong to one thing without saying so up front.
4. Absorbing a small sibling project later is a boring job.

### Non-goals

Explicitly out of scope for this work, recorded so they aren't lost:

- Absorbing `cosmic`, `dream`, or `cult-game` into the repo. The structure this creates
  makes each a later, self-contained job.
- Live data on the front page. Considered and rejected; may be revisited.
- A light theme. Single dark theme only.
- Frontend tests. Backend tests continue and grow; frontend stays untested for now.
- Per-camera narratives for Sky Pantone (a parked feature, unrelated to structure).
- Making `dist/backend` runnable. The backend runs under `tsx`; see Build.

---

## Repository shape

One slice per experiment. Backend-only code lives in a `server/` subfolder **inside** the
slice, which reduces the frontend/backend TypeScript split to two glob patterns.

```
data/                       gitignored, created at boot — runtime state
public/art/<id>.webp        poster plate artwork, added over time

src/
  main.tsx                  vite entry
  App.tsx                   shell + router
  server.ts                 express host
  registry.ts               ordered experiment list (frontend)

  platform/
    ollama.ts               moved unchanged
    storage.ts              atomic JSON persistence
    config.ts               hostnames, ports, external URLs
    backendApi.ts           apiUrl(id, path)
    ui/
      tokens.css            design tokens (custom properties)
      Shell.tsx  Plate.tsx  Colophon.tsx  Gallery.tsx
      *.module.css

  experiments/
    sky/
      manifest.ts  page.tsx  SkyMap.tsx  sky.module.css  types.ts
      server/ index.ts sky-cams.ts sky-frame.ts sky-source.ts
              frame-sources.ts sun.ts color.ts pantone.ts pantone.json
              *.test.ts
    sprites/
      manifest.ts  page.tsx  client.ts  types.ts  sprites.module.css
      sprite-groups.json     authored content — stays in repo
      server/ index.ts
    colony/
      manifest.ts  page.jsx  colony.module.css
      server/ index.ts
    transit/ · weather/ · todo/ · wikistory/ · llm-duo-chat/ · image-hunt/
```

### What this fixes

**Sky's modules stop looking shared.** `sun.ts`, `color.ts`, `pantone.ts`, `sky-*.ts` and
`frame-sources.ts` currently sit at the top of `src/backend/` alongside genuinely shared
code. Only Sky uses them.

**Route collisions become impossible.** All seven routers currently mount flat on `/api`.
Each slice now mounts at `/api/<id>`.

**Runtime data leaves the source tree.** `todos.json` and `image-hunt-sessions.json` are
runtime state living in `src/backend/`. They move to `data/`. `sprite-groups.json` is
authored content and stays in the repo, inside the `sprites` slice.

### Cross-slice dependencies

Colony consumes sprite groups, which the Sprite Tool owns. This is permitted under one
rule: **a slice may import only another slice's `client.ts` or `types.ts`** — never its
`page`, and never anything under `server/`. Colony imports `experiments/sprites/client.ts`.
Sprite group loading does not belong in `platform/`; it is not general infrastructure.

---

## Registry and routing

### Manifest

Each slice has a `manifest.ts` containing pure data with no imports, so both the browser
and the server can read it.

```ts
export interface ExperimentManifest {
  id: string;                    // 'sky' — slug; also the /api/<id> namespace
  title: string;                 // 'Sky Pantone'
  blurb: string;                 // one line, shown on the plate
  section: 'tools' | 'llm-toys' | 'games';
  route: string;                 // '/sky'
  art?: string;                  // '/art/sky.webp'; absent → generated placeholder
  chrome: 'colophon' | 'none';
  hasServer: boolean;
  external?: string;             // absolute URL; card links out and carries the ↗ mark
}
```

An entry with `external` set has no `load`, no `server/`, and `hasServer: false`.

### Registry

`src/registry.ts` is an ordered array pairing each manifest with a lazy loader:

```ts
{ ...skyManifest, load: () => import('./experiments/sky/page') }
```

`load` is optional in the entry type: external entries omit it, and the router treats an
entry without a loader as a link rather than a route.

`src/server.ts` holds a separate explicit list mounting slice servers. Two short explicit
lists, no filesystem globbing. A test asserts every manifest with `hasServer: true` is
mounted, so the lists cannot silently drift.

### Router

Hand-rolled, driven by the registry, replacing the if-ladder in `App.jsx`. Matching sorts
entries by route length descending, then takes the first entry where
`pathname === route || pathname.startsWith(route + '/')`. The remaining path segments are
passed to the page as a `subpath` prop; the experiment handles its own internal routing.
`React.lazy` per experiment gives code splitting.

Sub-routes are not gallery entries. `/sky/map` is reachable only from inside Sky Pantone,
after the nearest sky is shown.

---

## Backend

### Process model

One Express process on 5174, as today. All local experiments mount into it. Separate
processes for small experiments would mean separate ports, units and CORS lists for no
benefit at this size.

`chitty` and `roguelike` keep their own services. They are not proxied.

### Slice server contract

A slice's `server/index.ts` exports:

- `router` — an Express router, mounted at `/api/<id>`
- `init?()` — optional async setup run before `listen`
- `attach?(server)` — optional access to the raw `http.Server`

`attach` exists solely for LLM Duo Chat's WebSocket, which is the only reason the shared
`http.Server` is created.

### Init failure isolation

`pages.service` sets `Restart=always` with `RestartSec=3`. Today
`Promise.all([initTodoStorage(), initSessionStorage()])` has no `.catch`, so one failing
init means `listen` is never reached and systemd restarts every three seconds, quietly.
With more slices carrying `init?`, that risk grows.

**A slice whose `init()` throws is logged and marked unavailable; the server starts
anyway.** Its routes return 503. One broken experiment must not take the others offline.

### Storage

Todos, sprite groups and image-hunt sessions each hand-roll read-JSON/write-JSON, and each
can corrupt its file if the process dies mid-write. One helper replaces all three:

```ts
createJsonStore<T>(name: string, fallback: T): {
  read(): Promise<T>;
  write(value: T): Promise<void>;   // temp file + rename
}
```

Paths resolve from `import.meta.url`, not `process.cwd()`, and `data/` is created at boot.

### Configuration

`platform/config.ts` is the single source for hostnames, ports and external URLs. The CORS
allowlist is generated from the hostname list across schemes and ports rather than being
14 hand-maintained strings, and `vite.config.ts` imports the same list for `allowedHosts`.
Adding a hostname becomes a one-line change instead of edits in two files.

This requires renaming `vite.config.js` to `vite.config.ts` so it can import the module.

### Error handler fix

The error middleware in `src/backend/index.ts` takes three parameters. Express identifies
error handlers by an arity of four, so as written it is registered as ordinary middleware
and never catches anything. It gets the missing `next` parameter.

### Build

The backend runs under `tsx` and nothing executes `dist/backend`, yet `npm run build`
emits one that cannot run — a trap CLAUDE.md documents at length. The build becomes:

```
build:sprites && vite build && tsc --noEmit -p tsconfig.server.json
```

Same type checking, no misleading artifact. The `pantone.json` import-attribute workaround
becomes moot.

Two tsconfigs, split by glob:

- `tsconfig.app.json` — `src/**`, excluding `**/server/**`
- `tsconfig.server.json` — `src/server.ts`, `src/platform/**` excluding `ui/`,
  `src/experiments/**/server/**`, and slice `types.ts`

The `dev` npm script keeps its name; `pages.service` invokes `npm run dev` and needs no
edit. Only its internals change, to `tsx watch ./src/server.ts`.

---

## Design system

### Tailwind removal

Tailwind is legacy — it came from earlier experiments, while the newer pages (Sky Pantone,
Image Hunt, Transit) already use hand-written CSS. The newer style is the target.

- Delete `tailwind.config.js` and `postcss.config.js`
- Drop `tailwindcss`, `@tailwindcss/postcss`, `autoprefixer`, `postcss`
- `index.css` loses `@import "tailwindcss"` and becomes `platform/ui/tokens.css`
- Rewrite three pages into CSS Modules: **WikiStory** (32 utility classes),
  **TodoList** (24), **LLM Duo Chat** (24)

WikiStory's `react-markdown` output currently leans on browser defaults for lists and
headings, and the file notes that `@tailwindcss/typography` was never installed. Its module
must style markdown elements explicitly.

### Tokens

`platform/ui/tokens.css` holds custom properties — section hues, surfaces, type scale,
radii, spacing. Every CSS Module reads them through `var()`. Single dark theme.

### Gallery

Sections render as tinted bands with a display heading. Each card is a poster plate whose
art comes from `manifest.art`. When `art` is absent the plate renders a **deterministic
placeholder derived from a hash of the experiment id** — stable across reloads, visibly
different per card, so an un-arted gallery looks intentional rather than unfinished.
Supplying real artwork later is a file copy plus one manifest field.

| Section | Cards |
| --- | --- |
| **Tools** | Transit · Sky Pantone · Weather · Todo · Sprite Tool |
| **LLM toys** | WikiStory · LLM Duo Chat · Image Hunt |
| **Game ideas** | Colony Builder · Roguelike ↗ · Cult game ↗ |

External entries carry an ↗ mark on the card rather than occupying a separate section.
Nine local experiments, two external.

`chitty` is deliberately omitted from the gallery — it is private, not an oversight.

### Chrome

`manifest.chrome` is `'colophon'` or `'none'`.

The colophon is a plain element at the end of the page's document flow — a hairline rule
and one quiet line, `◇ pages — one of nine experiments · esc`. No scroll listeners, no fade
behaviour, no corner marks. On a page that fills the viewport you scroll past it to find
the colophon, which is the intended behaviour: the collection is discovered *after* the
thing is used, not before.

`esc` returns to the gallery from every page, including those with `chrome: 'none'`, and is
undocumented on screen.

**Transit sets `'none'`.** It is a wall display and shows no connection to anything. Sky
Pantone and Weather do *not* opt out; they are interactive enough to take the colophon.

---

## External links and ports

Ports are currently allocated ad hoc across projects, and two conflicts already exist:

| Project | Ports | Status |
| --- | --- | --- |
| pages | 5172 redirect · 5173 vite · 5174 backend | running |
| chitty | 5175 vite · 5176 backend · 5177 redirect | running |
| cult-game | **5174 backend** · vite default **5173** | not running |
| cosmic | **5177 vite** | not running |
| roguelike | 3001 backend | not running |

`cult-game` hardcodes the same backend port as pages and would default Vite to the same
port too; `cosmic` sits on chitty's redirect port. Starting either today breaks something.

The allocation table lives in `platform/config.ts` beside the external URLs, so collisions
are visible in one place rather than discovered by breakage. Fixing the sibling projects'
ports is out of scope here.

External hrefs are static. Chitty resolves to `https://samarkand.hopto.org:5175` but is not
carded. Roguelike and Cult game get entries whose links are dead until those services run —
no health checks, consistent with the no-live-data decision. **Their port assignments must
be confirmed before the links are useful.**

---

## Documentation

`CLAUDE.md` is agent-facing instruction, so a stale version actively misleads. It is
**updated as part of each migration step, not batched at the end** — the file must never
describe a structure the repo isn't in. Same rule for `README.md`.

### CLAUDE.md — what goes stale

Nearly all of it. Sections needing rewrite, roughly in file order:

| Claim | Becomes |
| --- | --- |
| `src/frontend/` and `src/backend/` split | slices under `src/experiments/`, `platform/` |
| "styled with Tailwind CSS 4" (twice — Frontend and Tech stack) | CSS Modules + tokens |
| "Routing is hand-rolled in `App.jsx`" and the add-a-page recipe | registry + manifest recipe |
| Current pages list | already wrong — missing `/imagehunt`, `/sky`, `/sky/map` |
| `apiUrl('/health')` | `apiUrl(id, path)` |
| Routes in `src/backend/routes/`, mounted flat on `/api` | `/api/<id>` per slice |
| Add-a-route recipe, `initTodoStorage()` / `initLLMDuoChatWebSocket()` | slice contract: `router`, `init?`, `attach?` |
| CORS allowlist "in `index.ts`" | generated from `platform/config.ts` |
| The `dist/backend` / `pantone.json` trap paragraph | delete — obsolete under `--noEmit` |
| `src/backend/ollama.ts` | `src/platform/ollama.ts` |
| `vite.config.js`, its `allowedHosts` | `vite.config.ts`, importing `config.ts` |
| Build script description | `--noEmit` for the server |
| Sprite Groups: schema path, `src/frontend/sprites.ts`, `/sprite-editor`, `/api/sprite-groups` | `experiments/sprites/`, `client.ts`, `/sprites`, `/api/sprites` |
| Storage examples citing `todos.json` | `data/`, via `createJsonStore` |

The Sprite Groups and TMX sections keep their substance — only paths and endpoints move.
The ColonyGame integration rules (fallback chain, `null`-tile rendering) stay as written.

### README.md

Lines 1–16 are unreplaced `create-vite` boilerplate and get replaced with an actual
description of the project and its layout. The sprite documentation stays but needs the
same path and endpoint corrections as above.

It also carries a **pre-existing defect at lines 102–104**: a stray
`const roadSprite = getSpriteUrl(...)` statement and an orphaned closing code fence, left
by a bad edit. Fixed in passing.

## Testing

Vitest, colocated. Existing backend tests (`sun`, `color`, `pantone`, `sky-*`, `ollama`,
`wikipedia`, `frame-sources`) travel with their slices unchanged.

New tests:

- **Registry integrity** — ids and routes unique; sections valid; `chrome` valid; every
  `hasServer: true` manifest is mounted in `server.ts`; external entries have an href and
  no server; any `art` path that is set exists on disk.
- **Storage helper** — atomic write survives an interrupted write; fallback returned when
  the file is absent; round-trip.
- **Config** — CORS origin generation covers every hostname across schemes and ports.

---

## Migration order

Each step leaves the application working, **and leaves `CLAUDE.md` accurate** — doc updates
belong to the step that invalidates them, not to a cleanup pass at the end. See
Documentation.

1. **Platform and shell.** `platform/`, tokens, registry, router, `Shell`, `Plate`,
   `Colophon`, gallery with placeholder art. Built alongside the existing `App.jsx`;
   nothing moved yet.
2. **Slices, easiest first:** `todo` → `weather` → `transit` → `wikistory` →
   `image-hunt` → `llm-duo-chat` → `sprites` → `sky` → `colony`.
3. **Tailwind removal** and the three page rewrites.
4. **Cleanup.** Delete `App.jsx` and the `back-btn--*` CSS; move `todos.json` and
   `image-hunt-sessions.json` into `data/`; switch the build to `--noEmit`; rename
   `vite.config.js`; rewrite `README.md`'s boilerplate opening and fix its broken
   lines 102–104.

`ColonyGame.jsx` moves but does not convert to TypeScript. It is 607 lines of canvas game
and converting it in the same pass is where this migration would go sideways. It becomes
`colony/page.jsx`; typing it is a later job. Everything else becomes `.tsx`, including
`App` and `main`.

---

## Risks

**`sky` and `colony` are the large moves.** Sky has seven backend modules plus a sub-route;
Colony has the sprite-group dependency and the largest single file. Everything sequenced
before them is small enough to be routine, so problems surface on cheap slices first.

**The Tailwind rewrites have no test coverage.** Three pages change appearance with nothing
automated to catch regressions. Mitigation: one page at a time, verified against the
running dev server before moving on.

**Restart discipline.** Because the dev server is a systemd unit, changes affecting runtime
behaviour need `npm run dev:restart` rather than relying on watch mode, particularly when
`server.ts` or the mount list changes.
