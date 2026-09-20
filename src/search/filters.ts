/**
 * The shared candidate filter.
 *
 * Both ranked legs apply exactly the same WHERE clause so they rank over an
 * identical candidate set. If they diverged, RRF would be fusing two lists drawn
 * from different populations and the fused ranks would be meaningless.
 */
import postgres from 'postgres';

export interface CandidateFilter {
  from?: Date | null;
  to?: Date | null;
  project?: string | null;
}

/**
 * Build the shared WHERE fragment. Null bounds are omitted entirely rather than
 * passed as null comparisons, so the planner sees a plain range predicate it can
 * satisfy from chunks_occurred_at_idx.
 */
export function buildWhere(sql: postgres.Sql, f: CandidateFilter) {
  const parts = [sql`c.embedding IS NOT NULL`];
  if (f.from) parts.push(sql`c.occurred_at >= ${f.from}`);
  if (f.to) parts.push(sql`c.occurred_at < ${f.to}`);
  if (f.project) parts.push(sql`s.project = ${f.project}`);

  return parts.reduce((acc, p) => sql`${acc} AND ${p}`);
}
