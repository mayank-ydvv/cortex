-- Per-user ownership and real row level security.
--
-- Applied to the live database via the Supabase migration API; kept here so
-- the schema can be rebuilt from scratch.
--
-- Until now RLS was enabled with no policies. That denies the public PostgREST
-- API entirely and works only because the app connects as the table owner, who
-- bypasses RLS. For multiple users that is not isolation, it is the absence of
-- it: the owner connection sees every row regardless of policy. See
-- src/db/client.ts `asUser`, which drops to the `authenticated` role so these
-- policies actually apply.

ALTER TABLE sources       ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE chunks        ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE chat_threads  ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE memories      ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE sources       ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE chunks        ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE chat_threads  ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE chat_messages ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE sources       ADD CONSTRAINT sources_user_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE chunks        ADD CONSTRAINT chunks_user_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE chat_threads  ADD CONSTRAINT chat_threads_user_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_user_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- external_id is unique only WITHIN an account. Two people importing their own
-- Claude export share conversation ids from their own exports; the old global
-- constraint would have made the second import silently overwrite the first
-- person's rows.
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_origin_external_id_key;
ALTER TABLE sources ADD  CONSTRAINT sources_user_origin_external_id_key
  UNIQUE (user_id, origin, external_id);

-- Every filtered query now leads with user_id, so the indexes do too.
CREATE INDEX IF NOT EXISTS chunks_user_occurred_at_idx ON chunks (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS chunks_user_idx             ON chunks (user_id);
CREATE INDEX IF NOT EXISTS sources_user_started_at_idx ON sources (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS chat_threads_user_idx       ON chat_threads (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_user_idx      ON chat_messages (user_id, thread_id, id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sources','chunks','chat_threads','chat_messages','memories'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO authenticated '
      'USING (user_id = (SELECT auth.uid())) '
      'WITH CHECK (user_id = (SELECT auth.uid()))',
      t || '_owner', t);
  END LOOP;
END $$;
