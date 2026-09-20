-- Personal Memory Engine — initial schema.
--
-- Hand-authored rather than generated, because Drizzle Kit cannot emit
-- CREATE EXTENSION or a generated tsvector column cleanly.
--
-- Embedding dimension is 384: Xenova/bge-small-en-v1.5, running locally.
-- Changing the embedding model invalidates every stored vector and requires
-- both a migration and a full re-embed.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- sources: one row per imported artifact (a conversation, or a note).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  origin       text        NOT NULL CHECK (origin IN ('claude', 'chatgpt', 'manual')),
  external_id  text        NOT NULL,
  title        text,
  project      text,
  started_at   timestamptz NOT NULL,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  raw_path     text        NOT NULL,
  content_hash text        NOT NULL,

  -- Identity, not content. This is what makes re-running ingest idempotent.
  -- content_hash then decides skip-vs-replace, so a conversation you continued
  -- updates in place instead of importing as a duplicate.
  CONSTRAINT sources_origin_external_id_key UNIQUE (origin, external_id)
);

-- ---------------------------------------------------------------------------
-- chunks: the retrievable units. One per conversation turn, split further only
-- when a turn exceeds the embedding model's input limit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chunks (
  id           bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_id    bigint      NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  content      text        NOT NULL,

  -- Nullable on purpose. Ingest inserts chunks in one transaction, then fills
  -- embeddings in batches. A crash mid-import leaves rows with a NULL embedding
  -- that the next run sweeps up, so a failed import resumes instead of
  -- restarting and re-paying for work already done.
  embedding    vector(384),

  position     integer     NOT NULL,
  role         text        NOT NULL CHECK (role IN ('user', 'assistant')),

  -- The message's own timestamp. Never import time. See CLAUDE.md standing rule 2.
  occurred_at  timestamptz NOT NULL,

  -- Lets a re-ingest reuse the embedding of a chunk whose text did not change.
  content_hash text        NOT NULL,

  -- The 'english' regconfig literal is mandatory: bare to_tsvector(content) is
  -- STABLE, not IMMUTABLE, and Postgres rejects it in a generated column.
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,

  CONSTRAINT chunks_source_id_position_key UNIQUE (source_id, position)
);

-- ---------------------------------------------------------------------------
-- memories: structured records extracted from chunks.
-- Stubbed in this phase; population comes later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memories (
  id         bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  chunk_id   bigint NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  type       text   NOT NULL CHECK (type IN ('decision', 'fact', 'question')),
  content    text   NOT NULL,
  decided_at timestamptz,
  project    text,
  entities   text[]
);

-- ---------------------------------------------------------------------------
-- Indexes.
-- ---------------------------------------------------------------------------

-- Vector leg. HNSW over IVFFlat because it needs no pre-existing data
-- distribution: it can be built on an empty table and stays optimal as the
-- corpus grows with each new export.
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

-- Keyword leg.
CREATE INDEX IF NOT EXISTS chunks_tsv_idx
  ON chunks USING gin (tsv);

-- Date filter. This is what makes the time window an index range scan, and so
-- what makes the exact-scan path cheap enough to rely on when the window is
-- narrow enough that HNSW would post-filter down to nothing.
CREATE INDEX IF NOT EXISTS chunks_occurred_at_idx
  ON chunks (occurred_at DESC);

CREATE INDEX IF NOT EXISTS chunks_source_id_idx    ON chunks (source_id);
CREATE INDEX IF NOT EXISTS sources_started_at_idx  ON sources (started_at DESC);
CREATE INDEX IF NOT EXISTS memories_decided_at_idx ON memories (decided_at DESC);

-- ---------------------------------------------------------------------------
-- Row level security.
--
-- This database is reachable through Supabase's auto-generated PostgREST API.
-- Without RLS, anyone holding the project's anon key could read the entire
-- corpus -- which here means every conversation the owner has ever had.
--
-- RLS is enabled with NO policies, which denies all access through PostgREST.
-- The application connects directly as the table owner, and owners bypass RLS,
-- so the CLI and local UI are unaffected.
--
-- If this ever moves behind a deployed app with real users, these tables need
-- actual policies. Enabling RLS without policies is a lock, not an auth model.
-- ---------------------------------------------------------------------------
ALTER TABLE sources  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
