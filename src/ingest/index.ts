/**
 * Ingest orchestrator.
 *
 * Idempotency
 * -----------
 * Identity and change detection are separate concerns:
 *
 *   UNIQUE (origin, external_id)  -- identity: which conversation is this?
 *   content_hash                  -- change:   has it changed since last time?
 *
 * Hashing alone is not enough. A conversation you CONTINUED has a different
 * hash, so hash-only skipping would import it again as a duplicate rather than
 * updating it. Matching on identity first gives three outcomes: skip (same
 * hash), replace (different hash), insert (unseen).
 *
 * Resumability
 * ------------
 * Chunks are inserted with a NULL embedding, then filled in batches. A crash
 * mid-import leaves rows the next run sweeps up, so a failed 40-minute import
 * resumes rather than restarting -- and never re-embeds work already done.
 * The sweep is global, not per-file, so it also repairs earlier partial runs.
 *
 * On replace, embeddings are reused for chunks whose text is unchanged. Editing
 * the tail of a long conversation then re-importing costs only the new turns.
 */
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { chunkMessages, type ChunkDraft } from './chunk';
import { getEmbeddingProvider } from './embed';
import type { Origin, ParsedConversation } from './parsers/types';

export interface IngestSummary {
  sourcesInserted: number;
  sourcesUpdated: number;
  sourcesSkipped: number;
  chunksCreated: number;
  embeddingsReused: number;
  embeddingsComputed: number;
  timestampsInherited: number;
  chunksAwaitingEmbedding: number;
  errors: { externalId: string; message: string }[];
}

export interface IngestOptions {
  origin: Origin;
  rawPath: string;
  project?: string | null;
  dryRun?: boolean;
  log?: (line: string) => void;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Stable hash of a conversation's meaningful content, independent of key order. */
export function hashConversation(c: ParsedConversation): string {
  return sha256(
    JSON.stringify({
      externalId: c.externalId,
      title: c.title,
      startedAt: c.startedAt.toISOString(),
      messages: c.messages.map((m) => ({
        role: m.role,
        content: m.content,
        occurredAt: m.occurredAt?.toISOString() ?? null,
      })),
    }),
  );
}

const emptySummary = (): IngestSummary => ({
  sourcesInserted: 0,
  sourcesUpdated: 0,
  sourcesSkipped: 0,
  chunksCreated: 0,
  embeddingsReused: 0,
  embeddingsComputed: 0,
  timestampsInherited: 0,
  chunksAwaitingEmbedding: 0,
  errors: [],
});

export async function ingestConversations(
  sql: postgres.Sql,
  conversations: ParsedConversation[],
  opts: IngestOptions,
): Promise<IngestSummary> {
  const summary = emptySummary();
  const log = opts.log ?? (() => {});

  for (const [i, conv] of conversations.entries()) {
    const label = `[${i + 1}/${conversations.length}] ${conv.title ?? conv.externalId}`;
    try {
      const hash = hashConversation(conv);

      const [existing] = await sql<{ id: number; content_hash: string }[]>`
        SELECT id, content_hash FROM sources
        WHERE origin = ${opts.origin} AND external_id = ${conv.externalId}
      `;

      if (existing && existing.content_hash === hash) {
        summary.sourcesSkipped += 1;
        log(`  skip    ${label}`);
        continue;
      }

      const { chunks, inheritedTimestamps } = chunkMessages(conv.messages, conv.startedAt);
      if (chunks.length === 0) {
        summary.sourcesSkipped += 1;
        log(`  empty   ${label}`);
        continue;
      }

      if (opts.dryRun) {
        const verb = existing ? 'update' : 'insert';
        log(`  ${verb.padEnd(7)} ${label} -> ${chunks.length} chunks`);
        if (existing) summary.sourcesUpdated += 1;
        else summary.sourcesInserted += 1;
        summary.chunksCreated += chunks.length;
        summary.timestampsInherited += inheritedTimestamps;
        continue;
      }

      const reused = await sql.begin(async (tx) => {
        let sourceId: number;
        // content_hash -> embedding, for chunks whose text survived the edit.
        const priorEmbeddings = new Map<string, string>();

        if (existing) {
          const prior = await tx<{ content_hash: string; embedding: string | null }[]>`
            SELECT content_hash, embedding::text AS embedding
            FROM chunks WHERE source_id = ${existing.id} AND embedding IS NOT NULL
          `;
          for (const p of prior) {
            if (p.embedding) priorEmbeddings.set(p.content_hash, p.embedding);
          }

          await tx`DELETE FROM chunks WHERE source_id = ${existing.id}`;
          await tx`
            UPDATE sources
            SET title = ${conv.title}, started_at = ${conv.startedAt},
                content_hash = ${hash}, raw_path = ${opts.rawPath},
                imported_at = now(),
                project = COALESCE(${opts.project ?? null}, project)
            WHERE id = ${existing.id}
          `;
          sourceId = existing.id;
        } else {
          const [row] = await tx<{ id: number }[]>`
            INSERT INTO sources (origin, external_id, title, project, started_at, raw_path, content_hash)
            VALUES (${opts.origin}, ${conv.externalId}, ${conv.title},
                    ${opts.project ?? null}, ${conv.startedAt}, ${opts.rawPath}, ${hash})
            RETURNING id
          `;
          sourceId = row!.id;
        }

        let reusedCount = 0;
        for (const chunk of chunks) {
          const chunkHash = sha256(chunk.content);
          const recycled = priorEmbeddings.get(chunkHash) ?? null;
          if (recycled) reusedCount += 1;

          await tx`
            INSERT INTO chunks (source_id, content, embedding, position, role, occurred_at, content_hash)
            VALUES (${sourceId}, ${chunk.content},
                    ${recycled ? sql`${recycled}::vector` : null},
                    ${chunk.position}, ${chunk.role}, ${chunk.occurredAt}, ${chunkHash})
          `;
        }
        return reusedCount;
      });

      if (existing) summary.sourcesUpdated += 1;
      else summary.sourcesInserted += 1;
      summary.chunksCreated += chunks.length;
      summary.embeddingsReused += reused;
      summary.timestampsInherited += inheritedTimestamps;

      const verb = existing ? 'update' : 'insert';
      const note = reused > 0 ? `, ${reused} embeddings reused` : '';
      log(`  ${verb.padEnd(7)} ${label} -> ${chunks.length} chunks${note}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ externalId: conv.externalId, message });
      log(`  ERROR   ${label}: ${message}`);
    }
  }

  return summary;
}

/**
 * Embed every chunk still missing a vector.
 *
 * Global by design: it repairs partial earlier runs, not just this one. Until a
 * chunk has an embedding it is invisible to the vector leg, so any remainder is
 * reported rather than left silent.
 */
export async function embedPendingChunks(
  sql: postgres.Sql,
  summary: IngestSummary,
  log: (line: string) => void = () => {},
  batchSize = 64,
): Promise<void> {
  const embedder = getEmbeddingProvider();

  const [pendingCount] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM chunks WHERE embedding IS NULL
  `;
  const total = Number(pendingCount?.count ?? 0);
  if (total === 0) {
    log('  nothing to embed');
    return;
  }

  log(`  embedding ${total} chunk(s)...`);
  let done = 0;

  for (;;) {
    const pending = await sql<{ id: number; content: string }[]>`
      SELECT id, content FROM chunks WHERE embedding IS NULL ORDER BY id LIMIT ${batchSize}
    `;
    if (pending.length === 0) break;

    const vectors = await embedder.embedDocuments(pending.map((p) => p.content));

    await sql.begin(async (tx) => {
      for (const [i, row] of pending.entries()) {
        await tx`
          UPDATE chunks SET embedding = ${`[${vectors[i]!.join(',')}]`}::vector WHERE id = ${row.id}
        `;
      }
    });

    done += pending.length;
    summary.embeddingsComputed += pending.length;
    const pct = Math.round((done / total) * 100);
    const bar = '#'.repeat(Math.round(pct / 5)).padEnd(20, '-');
    process.stdout.write(`\r  [${bar}] ${pct}%  ${done}/${total}`);
  }
  process.stdout.write('\n');

  const [remaining] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM chunks WHERE embedding IS NULL
  `;
  summary.chunksAwaitingEmbedding = Number(remaining?.count ?? 0);
}

export function formatSummary(s: IngestSummary): string {
  const lines = [
    '',
    'Summary',
    '  sources inserted      ' + s.sourcesInserted,
    '  sources updated       ' + s.sourcesUpdated,
    '  sources skipped       ' + s.sourcesSkipped,
    '  chunks created        ' + s.chunksCreated,
    '  embeddings computed   ' + s.embeddingsComputed,
    '  embeddings reused     ' + s.embeddingsReused,
  ];

  // Surfaced prominently: a high count means the export lacked per-message
  // timestamps, which quietly weakens every time-scoped query.
  lines.push(
    `  timestamps inherited  ${s.timestampsInherited}` +
      (s.timestampsInherited > 0 ? '   <- inherited conversation start, not import time' : ''),
  );

  if (s.chunksAwaitingEmbedding > 0) {
    lines.push(
      `  AWAITING EMBEDDING    ${s.chunksAwaitingEmbedding}   <- invisible to vector search; re-run ingest`,
    );
  }
  if (s.errors.length > 0) {
    lines.push(`  errors                ${s.errors.length}`);
    for (const e of s.errors.slice(0, 10)) lines.push(`    ${e.externalId}: ${e.message}`);
  }
  return lines.join('\n');
}
