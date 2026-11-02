import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'new-time',
  title: 'The New Time',
  blurb: 'A decimal clock: ten hours, ten dimes, ten minutes, a hundred seconds',
  section: 'tools',
  route: '/new-time',
  chrome: 'colophon',
  hasServer: false,
};
