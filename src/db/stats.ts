/**
 * Read-only queries backing the browse and status pages.
 */
import { asUser, getSql } from './client';

export interface CorpusStats {
  sources: number;
  chunks: number;
  awaitingEmbedding: number;
  /** Chunks the ingest recorded as having inherited their conversation's start time. */
  inherited: number;
  earliest: Date | null;
  latest: Date | null;
  byOrigin: { origin: string; sources: number; chunks: number }[];
  projects: string[];
}

export async function getCorpusStats(userId: string): Promise<CorpusStats> {
  return asUser(userId, async (sql) => {

  const [totals] = await sql<
    { sources: string; chunks: string; awaiting: string; earliest: Date | null; latest: Date | null }[]
  >`
    SELECT (SELECT count(*) FROM sources)::text AS sources,
           (SELECT count(*) FROM chunks)::text  AS chunks,
           (SELECT count(*) FROM chunks WHERE embedding IS NULL)::text AS awaiting,
           (SELECT min(occurred_at) FROM chunks) AS earliest,
           (SELECT max(occurred_at) FROM chunks) AS latest
  `;

  const [inherited] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM chunks WHERE timestamp_inherited
  `;

  const byOrigin = await sql<{ origin: string; sources: string; chunks: string }[]>`
    SELECT s.origin,
           count(DISTINCT s.id)::text AS sources,
           count(c.id)::text          AS chunks
    FROM sources s LEFT JOIN chunks c ON c.source_id = s.id
    GROUP BY s.origin ORDER BY s.origin
  `;

  const projects = await sql<{ project: string }[]>`
    SELECT DISTINCT project FROM sources WHERE project IS NOT NULL ORDER BY project
  `;

  return {
    sources: Number(totals?.sources ?? 0),
    chunks: Number(totals?.chunks ?? 0),
    awaitingEmbedding: Number(totals?.awaiting ?? 0),
    inherited: Number(inherited?.n ?? 0),
    earliest: totals?.earliest ?? null,
    latest: totals?.latest ?? null,
    byOrigin: byOrigin.map((r) => ({
      origin: r.origin,
      sources: Number(r.sources),
      chunks: Number(r.chunks),
    })),
    projects: projects.map((p) => p.project),
  };
  });
}

export interface SourceRow {
  id: number;
  origin: string;
  title: string | null;
  project: string | null;
  startedAt: Date;
  chunkCount: number;
  firstLine: string | null;
}

export async function listSources(
  userId: string,
  opts: { project?: string; origin?: string } = {},
): Promise<SourceRow[]> {
  return asUser(userId, async (sql) => {

  const rows = await sql<
    {
      id: number; origin: string; title: string | null; project: string | null;
      started_at: Date; chunk_count: string; first_line: string | null;
    }[]
  >`
    SELECT s.id, s.origin, s.title, s.project, s.started_at,
           count(c.id)::text AS chunk_count,
           (SELECT left(c2.content, 160) FROM chunks c2
             WHERE c2.source_id = s.id ORDER BY c2.position LIMIT 1) AS first_line
    FROM sources s LEFT JOIN chunks c ON c.source_id = s.id
    WHERE (${opts.project ?? null}::text IS NULL OR s.project = ${opts.project ?? null})
      AND (${opts.origin ?? null}::text  IS NULL OR s.origin  = ${opts.origin ?? null})
    GROUP BY s.id
    ORDER BY s.started_at DESC
    LIMIT 300
  `;

  return rows.map((r) => ({
    id: r.id,
    origin: r.origin,
    title: r.title,
    project: r.project,
    startedAt: r.started_at,
    chunkCount: Number(r.chunk_count),
    firstLine: r.first_line,
  }));
  });
}

export interface DbStatus {
  configured: boolean;
  reachable: boolean;
  error: string | null;
}

/** Distinguishes "no DATABASE_URL yet" from "configured but unreachable". */
export async function checkDb(): Promise<DbStatus> {
  if (!process.env.DATABASE_URL) {
    return { configured: false, reachable: false, error: null };
  }
  try {
    await getSql()`SELECT 1`;
    return { configured: true, reachable: true, error: null };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
