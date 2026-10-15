-- Switch embeddings from local bge-small (384 dims) to Gemini
-- gemini-embedding-001 truncated to 768 dims, so the app can run on Vercel.
--
-- Vectors from different models do not share a space, so existing embeddings
-- cannot be converted. They are cleared and recomputed by the normal
-- "awaiting embedding" sweep; the chunks themselves are kept.

DROP INDEX IF EXISTS chunks_embedding_idx;

UPDATE chunks SET embedding = NULL WHERE embedding IS NOT NULL;

ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(768);

CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);
