import { describe, it, expect } from 'vitest';
import { apiUrl, healthUrl } from './backendApi.js';

describe('apiUrl', () => {
  it('namespaces by experiment id', () => {
    expect(apiUrl('sky', '/cams')).toBe('/api/sky/cams');
  });

  it('accepts a path without a leading slash', () => {
    expect(apiUrl('sky', 'cams')).toBe('/api/sky/cams');
  });

  it('collapses the slice root to a bare namespace', () => {
    expect(apiUrl('todo', '/')).toBe('/api/todo');
  });

  it('keeps query strings intact', () => {
    expect(apiUrl('sky', '/frame/abc?asOf=1')).toBe('/api/sky/frame/abc?asOf=1');
  });
});

describe('healthUrl', () => {
  it('sits outside any slice namespace', () => {
    expect(healthUrl()).toBe('/api/health');
  });
});
