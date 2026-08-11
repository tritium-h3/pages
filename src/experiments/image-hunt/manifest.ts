import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'image-hunt',
  title: 'Image Hunt',
  blurb: 'Scavenger hunts generated over an image set',
  section: 'llm-toys',
  route: '/image-hunt',
  chrome: 'colophon',
  hasServer: true,
};
