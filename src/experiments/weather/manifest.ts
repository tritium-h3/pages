import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'weather',
  title: 'Weather',
  blurb: 'Forecast, plainly',
  section: 'tools',
  route: '/weather',
  chrome: 'colophon',
  hasServer: false,
};
