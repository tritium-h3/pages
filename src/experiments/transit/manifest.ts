import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'transit',
  title: 'Transit',
  blurb: 'An arrivals board worth mounting on a wall',
  section: 'tools',
  route: '/transit',
  chrome: 'none',
  hasServer: true,
};
