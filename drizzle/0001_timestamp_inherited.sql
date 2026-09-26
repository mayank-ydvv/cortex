-- Record timestamp inheritance as a fact rather than inferring it.
--
-- The status page previously guessed by comparing occurred_at to the
-- conversation's started_at. That flags every conversation's opening turn,
-- whose timestamp legitimately equals the start, so it over-reports badly --
-- 10 of 11 chunks on a fixture set where nothing was actually inherited.
--
-- A warning that cries wolf trains you to ignore it, which is worse than no
-- warning at all in a system whose whole purpose is surfacing silent failures.
ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS timestamp_inherited boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN chunks.timestamp_inherited IS
  'True when the source message carried no timestamp and inherited the conversation start. Never means import time.';
