import { describe, it, expect } from 'vitest';
import { trackGame } from './track.js';
import { waitingSquare } from './playback.js';

const track = trackGame(['e4', 'e5', 'Nf3']);
const idle = { playing: true, revealed: true, nextReady: false, failed: false };

describe('waitingSquare', () => {
  it("points at the next mover while its ply isn't ready", () => {
    expect(waitingSquare(track, 1, idle)).toBe('e7');
  });

  it('shows nothing once the stream has failed', () => {
    expect(waitingSquare(track, 1, { ...idle, failed: true })).toBeUndefined();
  });

  it('shows nothing when paused, mid-reveal, ready, or at the end', () => {
    expect(waitingSquare(track, 1, { ...idle, playing: false })).toBeUndefined();
    expect(waitingSquare(track, 1, { ...idle, revealed: false })).toBeUndefined();
    expect(waitingSquare(track, 1, { ...idle, nextReady: true })).toBeUndefined();
    expect(waitingSquare(track, 3, idle)).toBeUndefined();
  });
});
