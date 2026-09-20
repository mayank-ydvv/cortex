/**
 * The keyword leg: Postgres full-text search over the same filtered candidate set.
 *
 * This exists because exact tokens defeat vector search. Searching for a specific
 * package name or error code, cosine similarity will happily rank a chunk that
 * "discusses dependencies" above the chunk that literally names the package.
 *
 * ---------------------------------------------------------------------------
 * Why the tsquery is rewritten to OR
 * ---------------------------------------------------------------------------
 * websearch_to_tsquery ANDs every term: "JWT auth" becomes 'jwt' & 'auth'. One
 * absent term and the document is excluded outright. Two things make that fatal
 * here:
 *
 *   - Conversational queries carry several content words, and a chunk rarely
 *     contains all of them. Measured against a real chunk, "JWT auth" scored 0
 *     under AND and 0.10 under OR.
 *   - Stemming is asymmetric. "JWTs" stems to 'jwts' but "JWT" stems to 'jwt',
 *     and they do not match each other -- the exact-token problem this leg is
 *     supposed to SOLVE, reappearing inside the leg itself.
 *
 * Under AND the leg returns nothing for most real queries, so RRF silently
 * degenerates to vector-only and the three-leg design quietly becomes two.
 *
 * OR keeps it a RANKED LIST rather than a filter, which is what fusion needs.
 * Ranking still discriminates: ts_rank_cd scores a chunk matching two query
 * terms above one matching a single term, so more-relevant chunks still rise.
 *
 * Two behaviours are deliberately preserved:
 *   - Quoted phrases stay phrases ('session' <-> 'cooki'), because the swap only
 *     touches the ' & ' operator.
 *   - An explicit exclusion ("-kubernetes") keeps AND semantics. OR-ing a
 *     negated term would match nearly everything, inverting the user's intent.
 *
 * The rewrite operates on an already-parsed tsquery whose lexemes are normalised
 * and escaped by Postgres, so it introduces no injection surface.
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
    WITH q AS (
      SELECT CASE
        -- A query of pure stopwords parses to an empty tsquery. NULL matches
        -- nothing, which is correct, and avoids erroring.
        WHEN websearch_to_tsquery('english', ${queryText})::text = '' THEN NULL
        -- Respect an explicit exclusion rather than OR-ing a negation.
        WHEN websearch_to_tsquery('english', ${queryText})::text LIKE '%!%'
          THEN websearch_to_tsquery('english', ${queryText})
        ELSE replace(websearch_to_tsquery('english', ${queryText})::text, ' & ', ' | ')::tsquery
      END AS tsq
    )
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
