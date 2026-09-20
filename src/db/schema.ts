/**
 * Drizzle mirror of drizzle/0000_init.sql.
 *
 * The SQL file is the source of truth — it carries the extension, the generated
 * tsvector column and the HNSW index, none of which Drizzle Kit emits cleanly.
 * This file exists for typed queries against the same tables.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  vector,
} from 'drizzle-orm/pg-core';

/** Postgres tsvector. Drizzle has no built-in type for it. */
const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

export const EMBEDDING_DIMENSIONS = 384;

export const sources = pgTable(
  'sources',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    origin: text('origin').$type<'claude' | 'chatgpt' | 'manual'>().notNull(),
    externalId: text('external_id').notNull(),
    title: text('title'),
    project: text('project'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    rawPath: text('raw_path').notNull(),
    contentHash: text('content_hash').notNull(),
  },
  (t) => [
    unique('sources_origin_external_id_key').on(t.origin, t.externalId),
    index('sources_started_at_idx').on(t.startedAt.desc()),
  ],
);

export const chunks = pgTable(
  'chunks',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    sourceId: bigint('source_id', { mode: 'number' })
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    /** Nullable: ingest fills embeddings after insert so a failed run can resume. */
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    position: integer('position').notNull(),
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    /** The message's own timestamp. Never import time. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    contentHash: text('content_hash').notNull(),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', content)`),
  },
  (t) => [
    unique('chunks_source_id_position_key').on(t.sourceId, t.position),
    index('chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('chunks_tsv_idx').using('gin', t.tsv),
    index('chunks_occurred_at_idx').on(t.occurredAt.desc()),
    index('chunks_source_id_idx').on(t.sourceId),
  ],
);

/** Stubbed in this phase; populated later. */
export const memories = pgTable(
  'memories',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    chunkId: bigint('chunk_id', { mode: 'number' })
      .notNull()
      .references(() => chunks.id, { onDelete: 'cascade' }),
    type: text('type').$type<'decision' | 'fact' | 'question'>().notNull(),
    content: text('content').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    project: text('project'),
    entities: text('entities').array(),
  },
  (t) => [index('memories_decided_at_idx').on(t.decidedAt.desc())],
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
