-- Saved chats.
--
-- These are conversations you have WITH the memory engine, and are distinct
-- from `sources`/`chunks`, which are the imported history being searched. The
-- separation matters: your questions are not memories, and indexing them would
-- make the engine start answering out of its own output.

CREATE TABLE IF NOT EXISTS chat_threads (
  id         bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Bumped on every message so the sidebar can order by recent activity
  -- rather than by creation, which is what these apps actually do.
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         bigint      PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  thread_id  bigint      NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text        NOT NULL,

  -- The excerpts an answer was built from, stored so a reopened thread still
  -- shows its citations. Retrieval is not deterministic over time -- the corpus
  -- grows -- so re-running the search later would not reproduce them.
  sources    jsonb,

  -- Set when the assistant could not answer, so a reopened thread explains
  -- itself rather than showing a bare gap.
  note       text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_threads_updated_at_idx  ON chat_threads (updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_thread_id_idx  ON chat_messages (thread_id, id);

-- Same reasoning as the other tables: this database is reachable through a
-- public PostgREST API, and these rows contain your questions. RLS with no
-- policies denies that API; the app connects as owner and bypasses it.
ALTER TABLE chat_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
