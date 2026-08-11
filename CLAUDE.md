# pages — React + Vite multi-app project

A collection of mostly-disconnected React "pages" (small self-contained apps) served by Vite, backed by a TypeScript/Express server. Seeded from the former `.github/copilot-instructions.md` and extended by exploring the code.

## Architecture

Frontend (`src/frontend/`) and backend (`src/backend/`) run concurrently in dev.

### Frontend (`src/frontend/`)
- React 19, styled with Tailwind CSS 4, icons from `lucide-react`.
- **Routing is hand-rolled in `App.jsx`** — no router library. `App` keeps `pathname` in state, updates it via `window.history.pushState` + a `popstate` listener, and renders one page component per path. To add a page: create the component, import it in `App.jsx`, add a `pathname === '/x'` branch, and add a menu button.
- Current pages: `/weather`, `/colony` (Colony Builder game), `/wikistory`, `/todo`, `/llmduochat`, `/sprite-editor`, `/transit`.
- Entry: `main.jsx` → `App.jsx`. Mixed `.jsx`/`.tsx` — newer pages tend to be `.tsx`.
- **Reaching the backend:** migrated slices use the helpers in `src/platform/backendApi.ts` — `apiUrl(id, path)` builds `/api/<id>/...`, `healthUrl()` is the one route outside a slice namespace, `wsUrl(path)` builds a same-origin WebSocket URL. Unmigrated pages still use the older `src/frontend/backendApi.ts` (`apiUrl(path)`, single argument) until they migrate. Both go through the Vite dev server's same-origin `/api`/`/ws` proxy — neither hardcodes a host or port. Don't hardcode API URLs.

### Backend (`src/backend/`)
TypeScript/Express server (`index.ts`), used for:
1. **Ollama integration** — wraps the Ollama server so its raw interface isn't exposed.
2. **Long-term storage** — anything needing persistence. Migrated slices persist via `createJsonStore` into gitignored `data/` (e.g. `data/todos.json`); unmigrated routes still use ad hoc files (e.g. `sprite-groups.json`).
3. **Cross-user coordination** — features coordinating multiple users (e.g. WebSocket LLM Duo Chat).

- Listens on **port 5174** (`PORT` env override). Single `http.Server` shares Express + WebSocket.
- Routes live in `src/backend/routes/` and are mounted under `/api` in `index.ts`: `mbta`, `llm-duo-chat`, `wikipedia-story`, `sprite-groups`. Health: `GET /api/health`. Migrated slices (e.g. `todo`) mount instead at `/api/<id>` via `mount(id, slice)` in `src/server.ts` — see `src/experiments/<id>/server/index.ts`.
- Adding a legacy route: create `routes/<name>.ts` exporting a router, import and `app.use('/api', <name>Router)` in `index.ts`. If it needs init (storage, WebSocket), export an init fn and call it before/after `server.listen` like `initLLMDuoChatWebSocket(server)`.
- CORS origins are an explicit allowlist in `index.ts` (localhost, `samarkand.hopto.org`, `torment-nexus.local`). New hostnames must be added there.
- Run with `tsx watch` in dev; built with `tsc -p src/backend/tsconfig.json`. Note ESM `.js` import specifiers in TS source (e.g. `from './routes/mbta.js'`).
- **The backend always runs via `tsx`, never from `dist/`** — `pages.service` is `npm run dev`, and no script executes `dist/backend`. `npm run build` type-checks the backend and emits output, but that output is not directly runnable under plain `node`: `pantone.ts` imports `pantone.json` without an import attribute (the attribute form can't compile under `module: ES2020`), which `node` rejects at runtime. Fine while `tsx` is the only runner; see the comment in `pantone.ts` if you ever need `dist/backend` to run.

#### Ollama library (`src/backend/ollama.ts`)
- Server runs on port **11434**. Default model `qwen3:12b`, keep-alive `60m`.
- Streaming: `generateStream()`, `chatStream()`. Non-streaming: `generate()`, `chat()`. Also `listModels()`, `healthCheck()`.

```typescript
import { ollama } from './ollama.js';
for await (const chunk of ollama.generateStream({
  model: 'qwen3:12b', prompt: 'Tell me a story',
  keep_alive: '60m', options: { temperature: 0.8 },
})) { console.log(chunk); }
```

## Tech stack
- React 19 · Vite (**rolldown-vite**, pinned via `overrides`) · Tailwind CSS 4 · Express + TypeScript · `concurrently` · `lucide-react` · `react-markdown` · `ws` (WebSocket).

## Dev workflow

### Dev server (systemd user service)
The dev server runs as a systemd **user service** (`pages.service`) and starts at boot. It runs frontend (Vite, 5173) and backend (Express, 5174) together via `concurrently`.
- `systemctl --user status pages` — status
- `systemctl --user stop pages` — stop
- `journalctl --user -u pages -f` — follow logs

**Restart rule for agent changes:** after edits affecting frontend/backend runtime behavior during an active dev session, prefer:
```bash
npm run dev:status      # show whether ports 5173/5174/4173 are in use
npm run dev:restart     # systemctl --user restart pages
```
This avoids stale process state.

### HTTPS / proxy (`vite.config.js`)
- Vite serves HTTPS using certs at `/etc/ssl/certs/samarkand_hopto_org.pem` and `/home/tritium/myserver.key`.
- A small plugin runs an HTTP→HTTPS 301 redirect server on port **5172** (map external port 80 there).
- Vite proxies `/api` → `http://localhost:5174` and `/ws` (WebSocket) → `ws://localhost:5174`.
- `allowedHosts`: `torment-nexus.local`, `samarkand.hopto.org`.

### Scripts
- `npm run dev` / `npm start` — Vite + backend via `concurrently`.
- `npm run build` — `build:sprites` → `vite build` → backend `tsc`.
- `npm run build:sprites` — regenerate the sprite manifest (see below).
- `npm run lint` — ESLint. `npm run preview` — preview prod build.

### Materials
`materials/` holds reference material (e.g. `moth_setting_bible.md`) that is **not necessarily exposed in the final product** — background/worldbuilding, not shipped assets.

## TMX + sprite manifest
- TMX source: `assets/colony-db-map.tmx`. Orthogonal, `100x100`, tile `16x16`.
- Tilesets / `firstgid`: `colony-db32-other-ready` → `1`; `colony-db32-grounds-ready` → `1106`; `colony-db32-buildings-ready` → `2126`.
- `scripts/build-sprites.mjs` treats TMX tileset dimensions as authoritative when slicing; TMX layer data is base64+zlib decoded and persisted to `public/sprites/manifest.json`.
- Manifest contains per-sheet sprite records (`row`, `column`, `index`, `gid`, `url`), lookup maps (`spritesById`, `spritesByGid`, `spriteUrlsByGid`), parsed `tmx` metadata, and `suggested` / `mappings` helper sections.

## Sprite Groups system
Named multi-tile rectangular regions within a sprite sheet, so games look up layouts without hardcoding row/column coords.

### Schema (`src/backend/sprite-groups.json`)
```json
{ "groups": [ { "name": "BUILDING_GREY_5", "sheet": "colony-db32-buildings-ready",
  "startRow": 0, "startCol": 0, "widthTiles": 4, "heightTiles": 4 } ] }
```
Coordinates are sheet-relative and stable across manifest rebuilds.

### Backend API (`src/backend/routes/sprite-groups.ts`)
- `GET /api/sprite-groups` — full `{ groups }` file; called by games on startup.
- `POST /api/sprite-groups` — overwrites the file; called only by the Sprite Group Editor.

### Frontend helpers (`src/frontend/sprites.ts`)
- Types `SpriteGroup`, `SpriteGroupsFile` (mirrored in the backend route).
- `loadSpriteGroups()` — fetches `GET /api/sprite-groups`.
- `resolveSpriteGroup(group, manifest)` — returns a `(string | null)[][]` tile-URL grid (rows × cols) for `drawImage` loops; `null` = intentionally empty/transparent tile.

### ColonyGame integration
Each `BUILDING_TYPES` entry has a `spriteGroup` field naming its group. On mount, `loadSpriteGroups()` and `loadSpriteManifest()` run in parallel; per type the loader resolves `type.spriteGroup`, falling back to hardcoded `BUILDING_SPRITE_LAYOUT`, then to solid-color rects. Footprint sizes derive from the resolved grid at runtime — no hardcoded footprint constant.
**Rendering rule:** skip `null` tile URLs entirely (transparent); draw a fallback color rect only when a URL is non-null but its image hasn't loaded yet.

### Sprite Group Editor (`/sprite-editor`, `src/frontend/SpriteEditor.tsx`)
Visual group-definition page: three sheet tabs (Other/Grounds/Buildings, keys `1`/`2`/`3`), click-drag to select a rectangle, name it to add it, Save posts all groups to `POST /api/sprite-groups`. Zoom `+`/`-`; `Esc` cancels, `Enter` confirms name; tiles load progressively via `requestAnimationFrame`-debounced redraws.
