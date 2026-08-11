import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'wikistory',
  title: 'WikiStory',
  blurb: 'A story spun out of a random article',
  section: 'llm-toys',
  route: '/wikistory',
  chrome: 'colophon',
  hasServer: true,
};
