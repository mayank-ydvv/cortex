/**
 * The keyword leg: Postgres full-text search over the same filtered candidate set.
 *
 * This exists because exact tokens defeat vector search. Searching for a specific
 * package name or error code, cosine similarity will happily rank a chunk that
 * "discusses dependencies" above the chunk that literally names the package.
 *
 * websearch_to_tsquery is used rather than plainto_tsquery because it accepts
 * quoted phrases and OR/- operators, and because it never throws on punctuation
 * the way to_tsquery does. A query of pure stopwords yields an empty tsquery,
 * which correctly matches nothing rather than erroring.
 */
import type postgres from 'postgres';
import type { RankedHit } from './rrf.js';
import { buildWhere, type CandidateFilter } from './filters.js';

export async function keywordSearch(
  sql: postgres.Sql,
  queryText: string,
  filter: CandidateFilter,
  limit: number,
): Promise<RankedHit[]> {
  const where = buildWhere(sql, filter);

  const rows = await sql<{ chunk_id: number; rank_score: number; rank: number }[]>`
    WITH q AS (SELECT websearch_to_tsquery('english', ${queryText}) AS tsq)
    SELECT c.id AS chunk_id,
           ts_rank_cd(c.tsv, q.tsq) AS rank_score,
           ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.tsv, q.tsq) DESC, c.id) AS rank
    FROM chunks c
    JOIN sources s ON s.id = c.source_id
    CROSS JOIN q
    WHERE ${where}
      AND q.tsq IS NOT NULL
      AND c.tsv @@ q.tsq
    ORDER BY ts_rank_cd(c.tsv, q.tsq) DESC, c.id
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    chunkId: Number(r.chunk_id),
    rank: Number(r.rank),
    score: Number(r.rank_score),
  }));
}
