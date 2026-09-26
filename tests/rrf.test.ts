import { describe, expect, it } from 'vitest';
import { DEFAULT_K, fuse, type RankedHit } from '../src/search/rrf';

/** Build a list from chunk ids, assigning ranks 1..n. */
const list = (...ids: number[]): RankedHit[] =>
  ids.map((chunkId, i) => ({ chunkId, rank: i + 1, score: 1 - i * 0.1 }));

const rrf = (k: number, ...ranks: number[]) =>
  ranks.reduce((s, r) => s + 1 / (k + r), 0);

describe('fuse — scoring', () => {
  it('computes the sum of reciprocal ranks', () => {
    const vector = list(10, 20, 30);
    const keyword = list(20, 40);
    const out = fuse([vector, keyword]);

    const byId = new Map(out.map((h) => [h.chunkId, h]));
    // 20 is rank 2 in vector and rank 1 in keyword.
    expect(byId.get(20)!.score).toBeCloseTo(rrf(DEFAULT_K, 2, 1), 12);
    // 10 appears only in vector, at rank 1.
    expect(byId.get(10)!.score).toBeCloseTo(rrf(DEFAULT_K, 1), 12);
    // 40 appears only in keyword, at rank 2.
    expect(byId.get(40)!.score).toBeCloseTo(rrf(DEFAULT_K, 2), 12);
  });

  it('ranks a document present in both lists above one that tops a single list', () => {
    // This is the property that makes fusion worth doing: agreement beats
    // a strong showing in one leg alone.
    const vector = list(10, 20);
    const keyword = list(30, 20);
    const out = fuse([vector, keyword]);
    expect(out[0]!.chunkId).toBe(20);
  });

  it('respects a custom k', () => {
    const out = fuse([list(10)], 1);
    expect(out[0]!.score).toBeCloseTo(1 / 2, 12);
  });

  it('ignores the legs’ raw scores entirely', () => {
    // Identical ranks, wildly different raw scores -> identical fused scores.
    const a: RankedHit[] = [{ chunkId: 1, rank: 1, score: 0.99 }];
    const b: RankedHit[] = [{ chunkId: 2, rank: 1, score: 0.01 }];
    const out = fuse([a, b]);
    expect(out[0]!.score).toBeCloseTo(out[1]!.score, 12);
  });
});

describe('fuse — rank and score provenance', () => {
  it('records each list’s rank positionally, null where absent', () => {
    const out = fuse([list(10, 20), list(20)]);
    const byId = new Map(out.map((h) => [h.chunkId, h]));
    expect(byId.get(20)!.ranks).toEqual([2, 1]);
    expect(byId.get(10)!.ranks).toEqual([1, null]);
  });

  it('carries raw leg scores through for display', () => {
    const out = fuse([[{ chunkId: 7, rank: 1, score: 0.42 }], []]);
    expect(out[0]!.scores).toEqual([0.42, null]);
  });
});

describe('fuse — ordering is deterministic', () => {
  it('breaks ties by better single rank, then by chunk id', () => {
    // 100 and 200 both appear once at rank 1 -> identical scores.
    const out = fuse([list(200), list(100)]);
    expect(out.map((h) => h.chunkId)).toEqual([100, 200]);
  });

  it('prefers the document with the better single rank when scores tie', () => {
    const a: RankedHit[] = [{ chunkId: 1, rank: 3, score: 0 }];
    const b: RankedHit[] = [{ chunkId: 2, rank: 3, score: 0 }];
    const out = fuse([a, b]);
    expect(out.map((h) => h.chunkId)).toEqual([1, 2]);
  });

  it('produces the same order across repeated runs', () => {
    const run = () => fuse([list(5, 3, 9, 1), list(9, 1, 7)]).map((h) => h.chunkId);
    expect(run()).toEqual(run());
  });
});

describe('fuse — edge cases', () => {
  it('returns nothing for no lists', () => {
    expect(fuse([])).toEqual([]);
  });

  it('returns nothing when every list is empty', () => {
    expect(fuse([[], []])).toEqual([]);
  });

  it('handles one leg returning nothing', () => {
    // The realistic case: a date filter leaves the keyword leg with no matches.
    const out = fuse([list(10, 20), []]);
    expect(out.map((h) => h.chunkId)).toEqual([10, 20]);
    expect(out[0]!.ranks).toEqual([1, null]);
  });

  it('is idempotent when both lists are identical', () => {
    const out = fuse([list(10, 20), list(10, 20)]);
    expect(out.map((h) => h.chunkId)).toEqual([10, 20]);
    expect(out[0]!.score).toBeCloseTo(rrf(DEFAULT_K, 1, 1), 12);
  });

  it('keeps the better rank if a document is duplicated within one list', () => {
    const dupe: RankedHit[] = [
      { chunkId: 1, rank: 1, score: 0.9 },
      { chunkId: 1, rank: 5, score: 0.1 },
    ];
    const out = fuse([dupe]);
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBeCloseTo(rrf(DEFAULT_K, 1), 12);
  });

  it('scales to three or more lists', () => {
    const out = fuse([list(1), list(1), list(1)]);
    expect(out[0]!.score).toBeCloseTo(rrf(DEFAULT_K, 1, 1, 1), 12);
    expect(out[0]!.ranks).toEqual([1, 1, 1]);
  });
});
