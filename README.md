# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

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

Use `src/frontend/sprites.ts`:

```ts
import {
  loadSpriteManifest,
  getSpriteUrl,
  loadSpriteGroups,
  resolveSpriteGroup,
} from './sprites';

// Load manifest (tile URLs, TMX data, etc.)
const manifest = await loadSpriteManifest();
const tileUrl = getSpriteUrl(manifest, 'colony-db32-grounds-ready:0,0');

// Load sprite group definitions saved via the Sprite Group Editor
const { groups } = await loadSpriteGroups();
const group = groups.find(g => g.name === 'BUILDING_GREY_5');

// Resolve to a 2-D URL grid (null = transparent/empty tile)
const tileGrid = resolveSpriteGroup(group, manifest);
// tileGrid[row][col] is a URL string or null
```

### Defining multi-tile sprites (Sprite Group Editor)

Navigate to `/sprite-editor` to visually map rectangular regions of a sprite sheet to named groups. Groups are saved to `src/backend/sprite-groups.json` via `POST /api/sprite-groups` and served to games at startup via `GET /api/sprite-groups`.

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
const roadSprite = getSpriteUrl(manifest, 'colony-db32-grounds-ready:0,0');
```

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
