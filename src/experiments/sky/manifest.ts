import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'sky',
  title: 'Sky Pantone',
  blurb: 'The sky right now, reduced to a single paint chip',
  section: 'tools',
  route: '/sky',
  chrome: 'colophon',
  hasServer: true,
};
