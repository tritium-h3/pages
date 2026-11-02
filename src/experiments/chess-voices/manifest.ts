import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'chess-voices',
  title: 'Chess Voices',
  blurb: 'Real games, narrated by the pieces',
  section: 'llm-toys',
  route: '/chess-voices',
  chrome: 'colophon',
  hasServer: true,
};
