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

// Write atomically: write to a temp file then rename into place (rename is
// atomic on the same filesystem). The backend is a restart-happy dev service
// (`npm run dev:restart`) and writes fire on every match, so a plain
// overwrite could be truncated mid-write and lose all saved sessions. Every
// writer holds `withLock`, so the shared temp path can't collide.
async function writeAll(file: SessionsFile): Promise<void> {
  const tmp = `${SESSIONS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(file, null, 2));
  await fs.rename(tmp, SESSIONS_FILE);
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
