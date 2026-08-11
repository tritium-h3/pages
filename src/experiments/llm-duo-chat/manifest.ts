import type { ExperimentManifest } from '../../platform/manifest.js';

export const manifest: ExperimentManifest = {
  id: 'llm-duo-chat',
  title: 'LLM Duo Chat',
  blurb: 'Two local models, one conversation, no human',
  section: 'llm-toys',
  route: '/llm-duo-chat',
  chrome: 'colophon',
  hasServer: true,
};
