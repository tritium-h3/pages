import { Router, Request, Response } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SliceServer } from '../../../platform/server/slice.js';
import type { SpriteGroupsFile } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 * GET /api/sprites/groups
 * Returns all saved sprite group definitions.
 * Games call this at startup to resolve sprite layouts without hardcoding.
 */
router.get('/groups', async (req: Request, res: Response) => {
  try {
    const data = await readGroups();
    res.json(data);
  } catch (error) {
    console.error('Error reading sprite groups:', error);
    res.status(500).json({ error: 'Failed to read sprite groups' });
  }
});

/**
 * POST /api/sprites/groups
 * Overwrites the saved sprite group definitions.
 * Body: { groups: SpriteGroup[] }
 */
router.post('/groups', async (req: Request, res: Response) => {
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

const slice: SliceServer = { router };
export default slice;
