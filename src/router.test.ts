import { describe, it, expect } from 'vitest';
import { matchRoute } from './router.js';
import type { RegistryEntry } from './registry.js';

const stub = (id: string, route: string, external?: string): RegistryEntry => ({
  id, route, title: id, blurb: '', section: 'tools', chrome: 'colophon',
  hasServer: false, external,
  load: external ? undefined : async () => ({ default: () => null }),
});

const entries = [stub('sky', '/sky'), stub('todo', '/todo'), stub('rl', '/rl', 'https://x.test')];

describe('matchRoute', () => {
  it('matches an exact route with an empty subpath', () => {
    expect(matchRoute('/sky', entries)).toMatchObject({ entry: { id: 'sky' }, subpath: [] });
  });

  it('matches a sub-route and returns its segments', () => {
    expect(matchRoute('/sky/map', entries)).toMatchObject({ entry: { id: 'sky' }, subpath: ['map'] });
  });

  it('returns multiple sub-segments in order', () => {
    expect(matchRoute('/sky/map/detail', entries)?.subpath).toEqual(['map', 'detail']);
  });

  it('returns null for an unknown path', () => {
    expect(matchRoute('/nope', entries)).toBeNull();
  });

  it('returns null for the root path', () => {
    expect(matchRoute('/', entries)).toBeNull();
  });

  it('never matches an external entry', () => {
    expect(matchRoute('/rl', entries)).toBeNull();
  });

  it('does not treat a prefix collision as a sub-route', () => {
    expect(matchRoute('/skyfall', entries)).toBeNull();
  });

  it('prefers the longest matching route', () => {
    const nested = [stub('sky', '/sky'), stub('skymap', '/sky/map')];
    expect(matchRoute('/sky/map', nested)?.entry.id).toBe('skymap');
  });

  it('ignores a trailing slash', () => {
    expect(matchRoute('/sky/', entries)).toMatchObject({ entry: { id: 'sky' }, subpath: [] });
  });
});
