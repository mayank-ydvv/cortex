/**
 * Reciprocal Rank Fusion.
 *
 * Combines several ranked lists into one. For each document:
 *
 *     score = SUM over lists it appears in of  1 / (k + rank)
 *
 * The point of RRF is that it uses only RANK, never the underlying score. Cosine
 * distance and ts_rank are not on comparable scales and cannot be meaningfully
 * added, averaged or weighted against each other. Ranks can. Each list's raw
 * score is carried through for display but takes no part in the arithmetic.
 */

export interface RankedHit {
  chunkId: number;
  /** 1-based position within its own list. */
  rank: number;
  /** The leg's own score (cosine distance, ts_rank). Display only — never fused. */
  score: number;
}

export interface FusedHit {
  chunkId: number;
  /** The fused RRF score. */
  score: number;
  /** Rank in each input list, positionally aligned with the input; null if absent. */
  ranks: (number | null)[];
  /** Raw leg scores, positionally aligned; null if absent. */
  scores: (number | null)[];
}

/**
 * k dampens the influence of top ranks. 60 is the value from the original paper
 * and the project default. At small list sizes it flattens differences
 * considerably — across a 50-item list the spread is only about 2x — so fusion
 * behaves close to rank-count voting. That is expected, not a bug.
 */
export const DEFAULT_K = 60;

/**
 * Fuse ranked lists. Returns all documents appearing in at least one list,
 * ordered by descending fused score.
 *
 * Ties are broken deterministically: better single rank first, then lower
 * chunkId. Without this, equal-scoring documents would order unpredictably and
 * the golden set would flap between runs.
 */
export function fuse(lists: RankedHit[][], k: number = DEFAULT_K): FusedHit[] {
  const n = lists.length;
  const acc = new Map<number, FusedHit>();

  lists.forEach((list, listIndex) => {
    for (const hit of list) {
      let entry = acc.get(hit.chunkId);
      if (!entry) {
        entry = {
          chunkId: hit.chunkId,
          score: 0,
          ranks: new Array<number | null>(n).fill(null),
          scores: new Array<number | null>(n).fill(null),
        };
        acc.set(hit.chunkId, entry);
      }
      // A document should not appear twice in one list; if it does, keep the
      // better rank rather than double-counting it.
      const existing = entry.ranks[listIndex];
      if (existing !== null && existing <= hit.rank) continue;
      if (existing !== null) entry.score -= 1 / (k + existing);

      entry.ranks[listIndex] = hit.rank;
      entry.scores[listIndex] = hit.score;
      entry.score += 1 / (k + hit.rank);
    }
  });

  const bestRank = (h: FusedHit) =>
    h.ranks.reduce<number>((min, r) => (r !== null && r < min ? r : min), Number.POSITIVE_INFINITY);

  return [...acc.values()].sort(
    (a, b) =>
      b.score - a.score ||
      bestRank(a) - bestRank(b) ||
      a.chunkId - b.chunkId,
  );
}
