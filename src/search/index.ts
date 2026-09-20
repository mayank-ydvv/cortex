/**
 * Retrieval: the three legs.
 *
 *   1. SQL filters  -- date range and project, applied identically to both legs
 *                      so they rank over the same candidate set.
 *   2. Vector       -- pgvector cosine, for conceptual matching.
 *   3. Keyword      -- Postgres full-text, for exact tokens.
 *
 * Legs 2 and 3 run in parallel and are fused with RRF.
 *
 * Every search also produces a full explain trace. It is cheap to compute and it
 * is the only way to tell a date-parsing bug from a retrieval bug when results
 * look wrong, so it is never optional.
 */
import { getSql } from '../db/client.js';
import { getEmbeddingProvider } from '../ingest/embed.js';
import type { CandidateFilter } from './filters.js';
import { fuse, type FusedHit, type RankedHit, DEFAULT_K } from './rrf.js';
import { keywordSearch } from './keyword.js';
import { parseTimeRange, type TimeRange } from './time.js';
import { vectorSearch } from './vector.js';

export interface SearchOptions {
  /** Results to return. */
  limit?: number;
  project?: string | null;
  /** Override the parsed range. Isolates parser bugs from retrieval bugs. */
  from?: Date | null;
  to?: Date | null;
  /** Injected for determinism in tests and golden-set entries. */
  now?: Date;
  tz?: string;
  /** Rows fetched per leg before fusion. Must exceed `limit` for fusion to matter. */
  candidateDepth?: number;
  k?: number;
}

export interface SearchHit {
  chunkId: number;
  content: string;
  role: 'user' | 'assistant';
  occurredAt: Date;
  sourceId: number;
  sourceTitle: string | null;
  origin: string;
  project: string | null;
  /** Position in each leg, so you can see WHY this surfaced. null means absent. */
  vectorRank: number | null;
  keywordRank: number | null;
  vectorScore: number | null;
  keywordScore: number | null;
  fusedScore: number;
}

export interface SearchExplain {
  query: string;
  /** What actually got embedded, after the time phrase was stripped. */
  cleanedText: string;
  timeExpression: string | null;
  range: TimeRange | null;
  rangeSource: 'parsed' | 'override' | 'none';
  project: string | null;
  candidateDepth: number;
  k: number;
  vector: RankedHit[];
  keyword: RankedHit[];
  fused: FusedHit[];
  warnings: string[];
}

export interface SearchResult {
  hits: SearchHit[];
  explain: SearchExplain;
}

const DEFAULT_LIMIT = 10;
/** Each leg fetches this many before fusion; fusion needs material to work with. */
const DEFAULT_CANDIDATE_DEPTH = 50;

export async function search(query: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const depth = opts.candidateDepth ?? DEFAULT_CANDIDATE_DEPTH;
  const k = opts.k ?? DEFAULT_K;
  const now = opts.now ?? new Date();
  const tz = opts.tz ?? process.env.MEMORY_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Always parse, even when the range is overridden: the time phrase must be
  // stripped from the text either way or it pollutes the embedding.
  const parsed = parseTimeRange(query, now, tz);

  const overridden = Boolean(opts.from || opts.to);
  const range: TimeRange | null = overridden
    ? { from: opts.from ?? new Date(0), to: opts.to ?? now, expression: '(override)' }
    : parsed.range;

  const filter: CandidateFilter = {
    from: range?.from ?? null,
    to: range?.to ?? null,
    project: opts.project ?? null,
  };

  const sql = getSql();
  const embedder = getEmbeddingProvider();
  const queryEmbedding = await embedder.embedQuery(parsed.cleanedText);

  // Both legs run concurrently over the same candidate set.
  const [vectorLeg, keywordHits] = await Promise.all([
    vectorSearch(sql, queryEmbedding, filter, depth),
    keywordSearch(sql, parsed.cleanedText, filter, depth),
  ]);

  const fused = fuse([vectorLeg.hits, keywordHits], k);

  const warnings: string[] = [];
  if (vectorLeg.possiblyTruncated) {
    warnings.push(
      `Vector leg returned ${vectorLeg.hits.length}/${depth} rows under a date filter. ` +
        'The HNSW index may be post-filtering; results could be incomplete.',
    );
  }
  if (keywordHits.length === 0) {
    warnings.push('Keyword leg matched nothing; ranking is vector-only.');
  }
  if (vectorLeg.hits.length === 0 && keywordHits.length === 0) {
    warnings.push('Both legs empty. Either the corpus is empty or the date filter excluded everything.');
  }

  const explain: SearchExplain = {
    query,
    cleanedText: parsed.cleanedText,
    timeExpression: parsed.range?.expression ?? null,
    range,
    rangeSource: overridden ? 'override' : parsed.range ? 'parsed' : 'none',
    project: opts.project ?? null,
    candidateDepth: depth,
    k,
    vector: vectorLeg.hits,
    keyword: keywordHits,
    fused,
    warnings,
  };

  const top = fused.slice(0, limit);
  if (top.length === 0) return { hits: [], explain };

  const hits = await hydrate(sql, top);
  return { hits, explain };
}

/** Fetch content and citation fields for the fused top N, preserving fused order. */
async function hydrate(sql: ReturnType<typeof getSql>, top: FusedHit[]): Promise<SearchHit[]> {
  const ids = top.map((h) => h.chunkId);

  const rows = await sql<
    {
      id: number;
      content: string;
      role: 'user' | 'assistant';
      occurred_at: Date;
      source_id: number;
      title: string | null;
      origin: string;
      project: string | null;
    }[]
  >`
    SELECT c.id, c.content, c.role, c.occurred_at,
           s.id AS source_id, s.title, s.origin, s.project
    FROM chunks c
    JOIN sources s ON s.id = c.source_id
    WHERE c.id = ANY(${ids}::bigint[])
  `;

  const byId = new Map(rows.map((r) => [Number(r.id), r]));

  return top.flatMap((f) => {
    const r = byId.get(f.chunkId);
    if (!r) return [];
    return [
      {
        chunkId: f.chunkId,
        content: r.content,
        role: r.role,
        occurredAt: r.occurred_at,
        sourceId: Number(r.source_id),
        sourceTitle: r.title,
        origin: r.origin,
        project: r.project,
        vectorRank: f.ranks[0] ?? null,
        keywordRank: f.ranks[1] ?? null,
        vectorScore: f.scores[0] ?? null,
        keywordScore: f.scores[1] ?? null,
        fusedScore: f.score,
      },
    ];
  });
}
