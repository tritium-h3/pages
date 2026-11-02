import { describe, it, expect } from 'vitest';
import { analyzeGame, describeMove, pieceLabel } from './replay.js';

const RUY = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O'];
const SCHOLAR = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];

describe('analyzeGame lives', () => {
  it('records a captured piece and who took it', () => {
    const a = analyzeGame(RUY);
    expect(a.lives.get('b-b8')).toMatchObject({
      moves: [expect.objectContaining({ ply: 4 })],
      ending: { kind: 'captured', ply: 7, byId: 'w-f1', byType: 'b' },
    });
    expect(a.lives.get('w-f1')!.captures.map(m => m.ply)).toEqual([7]);
  });

  it('counts castling as a move for the rook', () => {
    expect(analyzeGame(RUY).lives.get('w-h1')!.moves.map(m => m.ply)).toEqual([9]);
  });

  it('measures the longest idle stretch, including up to the end', () => {
    const a = analyzeGame(RUY);
    expect(a.lives.get('w-a1')!.longestIdle).toBe(9);
    expect(a.lives.get('w-g1')!.longestIdle).toBe(6);
  });

  it('knows mate from both sides, and survivors', () => {
    const a = analyzeGame(SCHOLAR);
    expect(a.lives.get('w-d1')!.ending).toEqual({ kind: 'gave-mate', ply: 7 });
    expect(a.lives.get('w-d1')!.checksGiven).toBe(1);
    expect(a.lives.get('b-e8')!.ending).toEqual({ kind: 'checkmated', ply: 7 });
    expect(a.lives.get('w-a1')!.ending).toEqual({ kind: 'survived' });
  });

  it('records promotion', () => {
    const a = analyzeGame(['h4', 'g5', 'hxg5', 'h6', 'gxh6', 'Bg7', 'hxg7', 'Nf6', 'gxh8=Q']);
    expect(a.lives.get('w-h2')!.promotedTo).toBe('q');
  });
});

describe('analyzeGame relations', () => {
  it('lists attackers and defenders by piece id', () => {
    const a = analyzeGame(RUY);
    const c6 = a.relations[7].get('w-f1')!;
    expect(c6.attackedBy.sort()).toEqual(['b-b7', 'b-d7']);
    expect(c6.defendedBy).toEqual([]);
    expect(a.relations[7].get('b-d7')!.attackedBy).toEqual(['w-f1']);
    expect(a.relations[7].get('b-d7')!.defendedBy).toContain('b-d8');
    expect(a.relations[7].get('b-d8')!.defends).toContain('b-d7');
  });
});

describe('describeMove', () => {
  it('describes moves, captures, castling, en passant, promotion and mate', () => {
    const ruy = analyzeGame(RUY).track.moves;
    expect(describeMove(ruy[2])).toBe("White's knight moved from g1 to f3.");
    expect(describeMove(ruy[6])).toBe("White's bishop took Black's knight on c6.");
    expect(describeMove(ruy[8])).toBe('White castled kingside, the king to g1 and the rook to f1.');
    const ep = analyzeGame(['e4', 'a6', 'e5', 'd5', 'exd6']).track.moves[4];
    expect(describeMove(ep)).toBe("White's pawn took Black's pawn on d5 en passant.");
    const promo = analyzeGame(['h4', 'g5', 'hxg5', 'h6', 'gxh6', 'Bg7', 'hxg7', 'Nf6', 'gxh8=Q']).track.moves[8];
    expect(describeMove(promo)).toBe("White's pawn took Black's rook on h8 and became a queen, giving check.");
    expect(describeMove(analyzeGame(SCHOLAR).track.moves[6])).toBe("White's queen took Black's pawn on f7, checkmate.");
  });
});

describe('pieceLabel', () => {
  it('names a piece', () => expect(pieceLabel('b', 'n')).toBe('Black knight'));
});
