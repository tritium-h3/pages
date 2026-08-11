// Shapes that cross the wire between server/index.ts and page.tsx, as JSON
// messages over the /ws/llm-duo-chat WebSocket connection.

export interface Character {
  name: string;
  personality: string;
}

/** Sent by the client to kick off a conversation. */
export interface StartMessage {
  type: 'start';
}

/** Sent once by the server after 'start', before any dialogue chunks. */
export interface SetupMessage {
  type: 'setup';
  character1: Character;
  character2: Character;
  situation: string;
}

/** One streamed chunk of the current turn's response. */
export interface ChunkMessage {
  type: 'chunk';
  speaker: string;
  chunk: string;
}

/** Terminal message on success. */
export interface DoneMessage {
  type: 'done';
}

/** Terminal message on failure, either before or mid-conversation. */
export interface ErrorMessage {
  type: 'error';
  message: string;
}

/** Messages the server sends to the client. */
export type LLMDuoChatServerMessage = SetupMessage | ChunkMessage | DoneMessage | ErrorMessage;
