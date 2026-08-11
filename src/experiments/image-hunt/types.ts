// Shapes that cross the wire between server/index.ts, server/sessions.ts and page.tsx.

export interface SessionMatch {
  id: string;
  thumbUrl: string;
  pageUrl: string;
  title: string;
  reason: string;
  description: string; // the run's description that found this match
  model: string;       // the run's model that found this match
  foundAt: string;
}

export interface HuntSession {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  attempts: number; // cumulative across all runs
  matches: SessionMatch[];
}

export interface SessionSummary {
  id: string;
  label: string;
  attempts: number;
  matchCount: number;
  createdAt: string;
  updatedAt: string;
}
