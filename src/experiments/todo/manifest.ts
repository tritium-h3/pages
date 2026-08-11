import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'todo',
  title: 'Todo',
  blurb: 'A list, kept simple',
  section: 'tools',
  route: '/todo',
  chrome: 'colophon',
  hasServer: true,
};
