// API calls go through the Vite dev server's same-origin proxy (`/api` and
// `/ws` are proxied to the backend in vite.config.ts). Same-origin URLs mean
// the browser uses the page's own protocol and host, so this works over both
// HTTP and HTTPS without the backend needing TLS.

/** Builds a path into an experiment's namespace: apiUrl('todo', '/') -> /api/todo */
export function apiUrl(id: string, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized === '/' ? `/api/${id}` : `/api/${id}${normalized}`;
}

/** Health is the one route outside a slice namespace. */
export function healthUrl(): string {
  return '/api/health';
}

export function wsUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${normalized}`;
}
