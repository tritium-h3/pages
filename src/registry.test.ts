import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { REGISTRY } from './registry.js';
import { SECTIONS } from './platform/manifest.js';

describe('registry integrity', () => {
  it('has unique ids', () => {
    const ids = REGISTRY.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique routes', () => {
    const routes = REGISTRY.filter(e => !e.external).map(e => e.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('uses only declared sections', () => {
    const known = new Set(SECTIONS.map(s => s.id));
    for (const entry of REGISTRY) expect(known.has(entry.section)).toBe(true);
  });

  it('gives every entry a valid chrome mode', () => {
    for (const entry of REGISTRY) {
      expect(['colophon', 'none']).toContain(entry.chrome);
    }
  });

  it('gives local entries a loader and a route starting with /', () => {
    for (const entry of REGISTRY.filter(e => !e.external)) {
      expect(typeof entry.load).toBe('function');
      expect(entry.route.startsWith('/')).toBe(true);
    }
  });

  it('gives external entries an absolute href, no loader and no server', () => {
    for (const entry of REGISTRY.filter(e => e.external)) {
      expect(entry.external).toMatch(/^https?:\/\//);
      expect(entry.load).toBeUndefined();
      expect(entry.hasServer).toBe(false);
    }
  });

  it('uses ids that are url-safe slugs', () => {
    for (const entry of REGISTRY) expect(entry.id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('has artwork on disk for every entry that declares it', () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
    for (const entry of REGISTRY.filter(e => e.art)) {
      expect(existsSync(path.join(root, 'public', entry.art!))).toBe(true);
    }
  });
});

import { readFileSync } from 'fs';

describe('registry and server mount list agree', () => {
  const serverSource = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.ts'),
    'utf-8',
  );

  it('mounts every entry that declares a server', () => {
    for (const entry of REGISTRY.filter(e => e.hasServer)) {
      expect(serverSource).toContain(`mount('${entry.id}'`);
    }
  });

  it('registers every mounted id', () => {
    const mounted = [...serverSource.matchAll(/mount\('([a-z0-9-]+)'/g)].map(m => m[1]);
    const registered = new Set(REGISTRY.filter(e => e.hasServer).map(e => e.id));
    for (const id of mounted) expect(registered.has(id)).toBe(true);
  });
});
