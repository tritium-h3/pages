import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'sprites',
  title: 'Sprite Tool',
  blurb: 'Name rectangular regions of a sheet so games stop hardcoding coordinates',
  section: 'tools',
  route: '/sprites',
  chrome: 'colophon',
  hasServer: true,
};
