import { describe, it, expect } from 'vitest';
import { trackGame } from './track.js';

const RUY = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O'];

describe('trackGame', () => {
  it('starts with 32 pieces named by their starting square', () => {
    const t = trackGame([]);
    expect(t.positions[0].size).toBe(32);
    expect(t.positions[0].get('w-g1')).toEqual({ id: 'w-g1', color: 'w', type: 'n', square: 'g1' });
  });

  it('follows a piece as it moves', () => {
    const t = trackGame(RUY);
    expect(t.positions[3].get('w-g1')!.square).toBe('f3');
    expect(t.moves[2]).toMatchObject({ ply: 3, moverId: 'w-g1', moverType: 'n', from: 'g1', to: 'f3' });
  });

  it('records captures and removes the victim', () => {
    const t = trackGame(RUY);
    expect(t.moves[6]).toMatchObject({ moverId: 'w-f1', capturedId: 'b-b8', capturedType: 'n', captureSquare: 'c6' });
    expect(t.positions[7].has('b-b8')).toBe(false);
    expect(t.moves[7]).toMatchObject({ moverId: 'b-d7', capturedId: 'w-f1' });
  });

  it('moves the rook when castling', () => {
    const t = trackGame(RUY);
    expect(t.moves[8]).toMatchObject({ moverId: 'w-e1', castle: 'king', rookId: 'w-h1', rookTo: 'f1' });
    expect(t.positions[9].get('w-h1')!.square).toBe('f1');
    expect(t.positions[9].get('w-e1')!.square).toBe('g1');
  });

  it('handles en passant', () => {
    const t = trackGame(['e4', 'a6', 'e5', 'd5', 'exd6']);
    expect(t.moves[4]).toMatchObject({ moverId: 'w-e2', capturedId: 'b-d7', captureSquare: 'd5', to: 'd6' });
    expect(t.positions[5].has('b-d7')).toBe(false);
  });

  it('keeps identity through promotion', () => {
    const t = trackGame(['h4', 'g5', 'hxg5', 'h6', 'gxh6', 'Bg7', 'hxg7', 'Nf6', 'gxh8=Q']);
    expect(t.moves[8]).toMatchObject({ moverId: 'w-h2', moverType: 'p', promotion: 'q', capturedId: 'b-h8' });
    expect(t.positions[9].get('w-h2')).toMatchObject({ type: 'q', square: 'h8' });
  });

  it('flags check and mate', () => {
    const t = trackGame(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']);
    expect(t.moves[6]).toMatchObject({ check: true, mate: true, capturedId: 'b-f7' });
  });

  it('lists pieces in the same order every ply, so the page can render them without reordering', () => {
    const t = trackGame(RUY);
    const order = [...t.positions[0].keys()];
    for (const pos of t.positions) expect([...pos.keys()]).toEqual(order.filter(id => pos.has(id)));
  });

  it('throws on an illegal move', () => {
    expect(() => trackGame(['e4', 'e4'])).toThrow();
  });
});
