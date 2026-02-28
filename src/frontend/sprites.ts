export type SpriteManifest = {
  generatedAt: string;
  sheets: Array<{
    name: string;
    sourceFile: string;
    tileWidth: number;
    tileHeight: number;
    columns: number;
    rows: number;
    sprites: Array<{
      id: string;
      label: string;
      row: number;
      column: number;
      index: number;
      gid: number | null;
      width: number;
      height: number;
      url: string;
    }>;
  }>;
  spritesById: Record<string, string>;
  spritesByGid: Record<string, string>;
  spriteUrlsByGid: Record<string, string>;
  tmx: null | {
    sourceFile: string;
    map: {
      width: number;
      height: number;
      tileWidth: number;
      tileHeight: number;
      orientation: string | null;
    };
    tilesets: Array<{
      name: string;
      firstGid: number;
      lastGid: number;
      tileWidth: number;
      tileHeight: number;
      imageSource: string | null;
    }>;
    layers: Array<{
      name: string;
      width: number;
      height: number;
      usedGids: number[];
      usedSpriteUrls: string[];
      cells: Array<[number, number]>;
    }>;
  };
  suggested: {
    groundSpriteUrls: string[];
    buildingSpriteUrls: string[];
  };
  mappings: {
    buildingTypeToGid: Record<string, number>;
    buildingTypeToUrl: Record<string, string>;
  };
};

export async function loadSpriteManifest(): Promise<SpriteManifest> {
  const response = await fetch('/sprites/manifest.json');
  if (!response.ok) {
    throw new Error(`Failed to load sprite manifest: ${response.status}`);
  }
  return (await response.json()) as SpriteManifest;
}

export function getSpriteUrl(manifest: SpriteManifest, id: string): string | null {
  return manifest.spritesById[id] ?? null;
}

// ---------------------------------------------------------------------------
// Sprite groups — named multi-tile rectangular regions within a sprite sheet.
// Games load these at runtime to replace hardcoded sprite layout constants.
// ---------------------------------------------------------------------------

export type SpriteGroup = {
  /** Semantic name used by game logic, e.g. "MINE" or "GREENHOUSE" */
  name: string;
  /** Sprite sheet name, e.g. "colony-db32-buildings-ready" */
  sheet: string;
  /** Top-left row of the region (0-indexed, sheet-relative) */
  startRow: number;
  /** Top-left column of the region (0-indexed, sheet-relative) */
  startCol: number;
  /** Width of the region in tiles */
  widthTiles: number;
  /** Height of the region in tiles */
  heightTiles: number;
};

export type SpriteGroupsFile = {
  groups: SpriteGroup[];
};

/**
 * Load the persisted sprite group definitions from the backend.
 * Returns { groups: [] } if the backend has none saved yet.
 */
export async function loadSpriteGroups(): Promise<SpriteGroupsFile> {
  // Import lazily to avoid circular deps; backendApi is frontend-only
  const { apiUrl } = await import('./backendApi');
  const response = await fetch(apiUrl('/sprite-groups'));
  if (!response.ok) {
    throw new Error(`Failed to load sprite groups: ${response.status}`);
  }
  return (await response.json()) as SpriteGroupsFile;
}

/**
 * Resolve a SpriteGroup into a 2-D grid of tile URLs (rows × cols).
 * Missing/empty tiles are represented as null.
 * The returned grid can be used directly in canvas drawImage loops.
 */
export function resolveSpriteGroup(
  group: SpriteGroup,
  manifest: SpriteManifest,
): (string | null)[][] {
  const sheet = manifest.sheets.find((s) => s.name === group.sheet);
  if (!sheet) return [];

  const spriteUrlByCoord = new Map(
    sheet.sprites.map((sprite) => [`${sprite.row},${sprite.column}`, sprite.url]),
  );

  const grid: (string | null)[][] = [];
  for (let dy = 0; dy < group.heightTiles; dy++) {
    const row: (string | null)[] = [];
    for (let dx = 0; dx < group.widthTiles; dx++) {
      row.push(spriteUrlByCoord.get(`${group.startRow + dy},${group.startCol + dx}`) ?? null);
    }
    grid.push(row);
  }
  return grid;
}