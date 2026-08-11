export type SectionId = 'tools' | 'llm-toys' | 'games';

export type ChromeMode = 'colophon' | 'none';

export interface ExperimentManifest {
  /** url-safe slug; also the /api/<id> namespace */
  id: string;
  title: string;
  /** one line, shown on the plate */
  blurb: string;
  section: SectionId;
  /** path this experiment owns; it also owns everything beneath it */
  route: string;
  /** e.g. '/art/sky.webp'; when absent a deterministic placeholder is drawn */
  art?: string;
  chrome: ChromeMode;
  hasServer: boolean;
  /** absolute URL; when set the card is a link out and carries the ↗ mark */
  external?: string;
}

export interface Section {
  id: SectionId;
  title: string;
  blurb: string;
}

export interface ExperimentPageProps {
  /** path segments below the experiment's route; [] at its root */
  subpath: string[];
}

export const SECTIONS: Section[] = [
  { id: 'tools', title: 'Tools', blurb: 'Things I actually use' },
  { id: 'llm-toys', title: 'LLM Toys', blurb: 'Everything that talks back' },
  { id: 'games', title: 'Game Ideas', blurb: 'Half-built worlds' },
];
