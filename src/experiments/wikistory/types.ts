// Shapes that cross the wire between server/index.ts and page.tsx, as
// Server-Sent Events on the story-generation stream.

/** The random Wikipedia article the story is based on, sent once up front. */
export interface WikiEvent {
  type: 'wiki';
  title: string;
  extract: string;
  url?: string;
}

/** One streamed chunk of the generated story text. */
export interface StoryChunkEvent {
  type: 'story';
  chunk: string;
}

/** Terminal event on success. */
export interface DoneEvent {
  type: 'done';
}

/** Terminal event on failure, either before or mid-stream. */
export interface ErrorEvent {
  type: 'error';
  message: string;
}

export type WikiStoryEvent = WikiEvent | StoryChunkEvent | DoneEvent | ErrorEvent;
