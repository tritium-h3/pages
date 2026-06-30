// API calls go through the Vite dev server's same-origin proxy
// (`/api` and `/ws` are proxied to the backend in vite.config.js).
// Using relative/same-origin URLs means the browser uses the page's own
// protocol + host, so it works over both HTTP and HTTPS without the
// backend needing TLS, and avoids mixed-content blocking.

export function getApiBaseUrl(): string {
  return '/api';
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}

// Build a same-origin WebSocket URL (e.g. wss://host:5173/ws/...),
// routed to the backend through the Vite `/ws` proxy.
export function wsUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${normalizedPath}`;
}
