import { createJsonStore } from '../../../platform/server/storage.js';
import type { HuntSession, SessionMatch, SessionSummary } from '../types.js';

interface SessionsFile {
  sessions: HuntSession[];
}

const store = createJsonStore<SessionsFile>('image-hunt-sessions', { sessions: [] });

async function readAll(): Promise<SessionsFile> {
  return store.read();
}

async function writeAll(file: SessionsFile): Promise<void> {
  await store.write(file);
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
