const BACKEND_PORT = '5174';

export function getBackendOrigin(): string {
  return `${window.location.protocol}//${window.location.hostname}:${BACKEND_PORT}`;
}

export function getApiBaseUrl(): string {
  return `${getBackendOrigin()}/api`;
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}
