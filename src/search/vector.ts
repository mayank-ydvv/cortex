/**
 * The vector leg: pgvector cosine similarity over the filtered candidate set.
 *
 * This is where the single most important correctness issue in the system lives.
 *
 * An HNSW index POST-filters. It walks the graph for the `ef_search` nearest
 * neighbours globally, and only then discards the ones failing the WHERE clause.
 * So "auth last week" over a corpus where last week is 0.5% of chunks can return
 * two rows -- not because only two matched, but because the index never looked
 * in the right place. That is silent, and it defeats the entire premise that a
 * date filter narrows before ranking.
 *
 * Two mitigations, both applied here:
 *
 *   1. hnsw.iterative_scan = relaxed_order (pgvector 0.8.0+, default off) lets
 *      the planner re-enter the index until it has enough post-filter rows.
 *   2. hnsw.ef_search = 200 widens the initial candidate pool.
 *
 * For a sufficiently narrow window the planner will instead choose a sequential
 * scan over the date-filtered rows. That is EXACT rather than approximate and is
 * cheap at personal scale, so it is left alone.
 *
 * Neither mitigation is a guarantee, so the leg also counts how many candidates
 * actually match the filter. A short result set only indicates post-filtering if
 * MORE candidates existed than were returned -- otherwise the window genuinely
 * holds that few rows, and warning about it would be crying wolf.
 */
import type postgres from 'postgres';
import type { RankedHit } from './rrf';
import { buildWhere, type CandidateFilter } from './filters';

export interface VectorLegResult {
  hits: RankedHit[];
  /** Rows matching the filter, regardless of how many the ANN scan surfaced. */
  candidateCount: number;
  /**
   * True only when candidates existed that the scan did not return -- the actual
   * signature of HNSW post-filtering, rather than a merely small candidate set.
   */
  possiblyTruncated: boolean;
}

export async function vectorSearch(
  sql: postgres.Sql,
  queryEmbedding: number[],
  filter: CandidateFilter,
  limit: number,
): Promise<VectorLegResult> {
  const where = buildWhere(sql, filter);
  const vec = `[${queryEmbedding.join(',')}]`;

  const { rows, candidateCount } = await sql.begin(async (tx) => {
    // SET LOCAL keeps these scoped to this transaction rather than the pooled
    // connection, which would leak the settings to unrelated queries.
    await tx`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`;
    await tx`SET LOCAL hnsw.ef_search = 200`;

    const found = await tx<{ chunk_id: number; distance: number; rank: number }[]>`
      SELECT c.id AS chunk_id,
             c.embedding <=> ${vec}::vector AS distance,
             ROW_NUMBER() OVER (ORDER BY c.embedding <=> ${vec}::vector) AS rank
      FROM chunks c
      JOIN sources s ON s.id = c.source_id
      WHERE ${where}
      ORDER BY c.embedding <=> ${vec}::vector
      LIMIT ${limit}
    `;

    // Exact count over the same predicate. This is what distinguishes "the index
    // stopped early" from "the window only holds this many rows".
    const [counted] = await tx<{ n: string }[]>`
      SELECT count(*)::text AS n
      FROM chunks c JOIN sources s ON s.id = c.source_id
      WHERE ${where}
    `;

    return { rows: found, candidateCount: Number(counted?.n ?? 0) };
  });

  const wanted = Math.min(limit, candidateCount);

  return {
    hits: rows.map((r) => ({
      chunkId: Number(r.chunk_id),
      rank: Number(r.rank),
      score: Number(r.distance),
    })),
    candidateCount,
    possiblyTruncated: rows.length < wanted,
  };
}
