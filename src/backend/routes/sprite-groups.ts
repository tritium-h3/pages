import { Router, Request, Response } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Types (mirrored in src/frontend/sprites.ts — keep in sync)
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

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DATA_FILE = path.join(__dirname, '..', 'sprite-groups.json');

async function readGroups(): Promise<SpriteGroupsFile> {
  if (!existsSync(DATA_FILE)) {
    return { groups: [] };
  }
  const raw = await readFile(DATA_FILE, 'utf-8');
  return JSON.parse(raw) as SpriteGroupsFile;
}

async function writeGroups(data: SpriteGroupsFile): Promise<void> {
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const router = Router();

/**
 * GET /api/sprite-groups
 * Returns all saved sprite group definitions.
 * Games call this at startup to resolve sprite layouts without hardcoding.
 */
router.get('/sprite-groups', async (req: Request, res: Response) => {
  try {
    const data = await readGroups();
    res.json(data);
  } catch (error) {
    console.error('Error reading sprite groups:', error);
    res.status(500).json({ error: 'Failed to read sprite groups' });
  }
});

/**
 * POST /api/sprite-groups
 * Overwrites the saved sprite group definitions.
 * Body: { groups: SpriteGroup[] }
 */
router.post('/sprite-groups', async (req: Request, res: Response) => {
  try {
    const body = req.body as SpriteGroupsFile;
    if (!body || !Array.isArray(body.groups)) {
      res.status(400).json({ error: 'Invalid body: expected { groups: SpriteGroup[] }' });
      return;
    }
    await writeGroups(body);
    res.json({ ok: true, count: body.groups.length });
  } catch (error) {
    console.error('Error writing sprite groups:', error);
    res.status(500).json({ error: 'Failed to write sprite groups' });
  }
});

export default router;
