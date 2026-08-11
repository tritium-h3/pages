export interface SpriteGroup {
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
}

export interface SpriteGroupsFile {
  groups: SpriteGroup[];
}
