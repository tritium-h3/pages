import type { Track } from './track.js';

export interface PlaybackState {
  playing: boolean;
  /** every bubble for the current ply is showing */
  revealed: boolean;
  /** the next ply's thoughts have all arrived */
  nextReady: boolean;
  /** the stream ended in an error; nothing more is coming */
  failed: boolean;
}

/** Where to show the pulsing "…": over the next mover, while playback is
 *  waiting on generation. */
export function waitingSquare(track: Track, ply: number, s: PlaybackState): string | undefined {
  if (s.failed || !s.playing || !s.revealed || s.nextReady || ply >= track.moves.length) return undefined;
  return track.positions[ply].get(track.moves[ply].moverId)?.square;
}
