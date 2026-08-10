import { describe, it, expect } from 'vitest';
import { corsOrigins, HOSTNAMES, PORTS, EXTERNAL_URLS } from './config.js';

describe('corsOrigins', () => {
  it('covers every hostname across both schemes, bare and with the vite/api ports', () => {
    const origins = corsOrigins();
    for (const host of HOSTNAMES) {
      for (const scheme of ['http', 'https']) {
        expect(origins).toContain(`${scheme}://${host}`);
        expect(origins).toContain(`${scheme}://${host}:${PORTS.vite}`);
        expect(origins).toContain(`${scheme}://${host}:${PORTS.api}`);
      }
    }
  });

  it('preserves every origin the old hand-written allowlist contained', () => {
    const origins = corsOrigins();
    const legacy = [
      'http://localhost:5173', 'http://localhost:5174',
      'http://samarkand.hopto.org', 'http://samarkand.hopto.org:5173',
      'http://samarkand.hopto.org:5174', 'https://samarkand.hopto.org',
      'https://samarkand.hopto.org:5173', 'https://samarkand.hopto.org:5174',
      'http://torment-nexus.local', 'http://torment-nexus.local:5173',
      'http://torment-nexus.local:5174', 'https://torment-nexus.local',
      'https://torment-nexus.local:5173', 'https://torment-nexus.local:5174',
    ];
    for (const origin of legacy) expect(origins).toContain(origin);
  });

  it('returns no duplicates', () => {
    const origins = corsOrigins();
    expect(new Set(origins).size).toBe(origins.length);
  });
});

describe('external URLs', () => {
  it('are absolute', () => {
    for (const url of Object.values(EXTERNAL_URLS)) {
      expect(url).toMatch(/^https?:\/\//);
    }
  });
});
