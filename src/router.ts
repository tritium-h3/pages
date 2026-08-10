import type { RegistryEntry } from './registry.js';

export interface RouteMatch {
  entry: RegistryEntry;
  subpath: string[];
}

/** Finds the experiment owning `pathname`. An experiment owns its route and
 *  everything beneath it; sub-routes are handed to the page as `subpath`.
 *  External entries are links, never routes, so they never match. */
export function matchRoute(pathname: string, entries: RegistryEntry[]): RouteMatch | null {
  const normalized = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;

  const routable = entries
    .filter(entry => !entry.external && entry.load)
    .sort((a, b) => b.route.length - a.route.length);

  for (const entry of routable) {
    if (normalized === entry.route) return { entry, subpath: [] };
    if (normalized.startsWith(`${entry.route}/`)) {
      return { entry, subpath: normalized.slice(entry.route.length + 1).split('/') };
    }
  }
  return null;
}
