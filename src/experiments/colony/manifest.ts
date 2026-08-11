import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'colony',
  title: 'Colony Builder',
  blurb: 'Tile-based colony sim on a hand-drawn map',
  section: 'games',
  route: '/colony',
  chrome: 'colophon',
  hasServer: false,
};
