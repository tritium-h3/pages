import type { ComponentType } from 'react';
import type { ExperimentManifest, ExperimentPageProps } from './platform/manifest.js';
import { EXTERNAL_URLS } from './platform/config.js';
import { manifest as todoManifest } from './experiments/todo/manifest.js';
import { manifest as weatherManifest } from './experiments/weather/manifest.js';

export interface RegistryEntry extends ExperimentManifest {
  /** absent for external entries, which are links rather than routes */
  load?: () => Promise<{ default: ComponentType<ExperimentPageProps> }>;
}

export const REGISTRY: RegistryEntry[] = [
  { ...todoManifest, load: () => import('./experiments/todo/page.js') },
  { ...weatherManifest, load: () => import('./experiments/weather/page.js') },
  {
    id: 'roguelike',
    title: 'Roguelike',
    blurb: 'Outgrew this repo — its own engine, its own service',
    section: 'games',
    route: '/roguelike',
    chrome: 'none',
    hasServer: false,
    external: EXTERNAL_URLS.roguelike,
  },
  {
    id: 'cult-game',
    title: 'Cult Game',
    blurb: 'Faction management, elsewhere',
    section: 'games',
    route: '/cult-game',
    chrome: 'none',
    hasServer: false,
    external: EXTERNAL_URLS.cultGame,
  },
];
