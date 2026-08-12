# pages

A collection of mostly-disconnected React "pages" — small self-contained experiments — served by Vite and backed by a shared TypeScript/Express server. Each experiment lives as a **slice** under `src/experiments/<id>/`: its own frontend page plus, if it needs one, its own `server/` with backend routes namespaced at `/api/<id>`. A thin platform layer (`src/platform/`) wires slices together — `src/registry.ts` drives frontend routing and the gallery, `src/server.ts` mounts each slice's backend routes — so adding an experiment never means touching a menu or a router switch by hand. See `CLAUDE.md` for the full architecture writeup.

## Running it

```bash
npm run dev
```

starts Vite (frontend, port 5173) and the Express backend (port 5174) together via `concurrently`. In this environment the dev server normally runs as a **systemd user service** (`pages.service`), started at boot and kept alive by `Restart=always`:

```bash
systemctl --user status pages    # status
systemctl --user stop pages      # stop
journalctl --user -u pages -f    # follow logs
npm run dev:restart              # restart after changes (systemctl --user restart pages)
```

`npm run build` builds the frontend and type-checks the backend (`tsc --noEmit`) — the backend itself always runs via `tsx`, never a compiled artifact.

## Sprite sheet build

Sprite sheets placed in `assets/*.png` can be split into labeled tile sprites with:

```bash
npm run build:sprites
```

## Dev restart workflow

If the dev server needs a clean restart after changes, use:

```bash
npm run dev:restart
```

To check whether common dev ports are already in use before restarting:

```bash
npm run dev:status
```

This command:

- stops processes using common project dev ports (`5173`, `5174`, `4173`)
- stops workspace-scoped stale processes
- starts a fresh `npm run dev` session

Recommended workflow during active development:

1. `npm run dev:status`
2. `npm run dev:restart` (after runtime-affecting changes)

The build script:

- slices each PNG into tiles (auto-detected from filename, e.g. `db32` -> `32x32`)
- skips fully transparent tiles
- writes split images to `public/sprites/<sheet-name>/`
- writes a manifest to `public/sprites/manifest.json`

### Optional labels

To assign custom labels, create `assets/sprite-labels.json` using `assets/sprite-labels.example.json` as a template.

### Frontend usage

Use `src/experiments/sprites/client.ts`:

```ts
import {
  loadSpriteManifest,
  getSpriteUrl,
  loadSpriteGroups,
  resolveSpriteGroup,
} from '../experiments/sprites/client.js';

// Load manifest (tile URLs, TMX data, etc.)
const manifest = await loadSpriteManifest();
const tileUrl = getSpriteUrl(manifest, 'colony-db32-grounds-ready:0,0');

// Load sprite group definitions saved via the Sprite Tool
const { groups } = await loadSpriteGroups();
const group = groups.find(g => g.name === 'BUILDING_GREY_5');

// Resolve to a 2-D URL grid (null = transparent/empty tile)
const tileGrid = resolveSpriteGroup(group, manifest);
// tileGrid[row][col] is a URL string or null
```

### Defining multi-tile sprites (Sprite Tool)

Navigate to `/sprites` to visually map rectangular regions of a sprite sheet to named groups. Groups are saved to `src/experiments/sprites/sprite-groups.json` via `POST /api/sprites/groups` and served to games at startup via `GET /api/sprites/groups`.

Group schema:

```json
{
  "name": "BUILDING_GREY_5",
  "sheet": "colony-db32-buildings-ready",
  "startRow": 0, "startCol": 0,
  "widthTiles": 4, "heightTiles": 4
}
```

Coordinates are sheet-relative and stable across manifest rebuilds. Games look up a group by name and call `resolveSpriteGroup()` to get tile URLs — no hardcoded row/column constants needed.

## TMX and manifest layout (current understanding)

- TMX source is `assets/colony-db-map.tmx`.
- Map is orthogonal `100x100` with `16x16` tiles.
- Tilesets are:
	- `colony-db32-other-ready` (firstgid `1`)
	- `colony-db32-grounds-ready` (firstgid `1106`)
	- `colony-db32-buildings-ready` (firstgid `2126`)
- TMX layers are zlib+base64 encoded; build script decodes them and records non-empty cell pairs as `[index, gid]` in `manifest.tmx.layers[].cells`.
- `build-sprites.mjs` uses TMX tileset dimensions as authoritative tile size for slicing.
- Manifest fields produced for runtime selection:
	- `sheets[]` with per-sprite `row`, `column`, `index`, `gid`, `url`
	- `spritesById`, `spritesByGid`, `spriteUrlsByGid`
	- `tmx` metadata (`map`, `tilesets`, `layers`)
	- `suggested` URL buckets and `mappings.buildingTypeToGid|buildingTypeToUrl`
