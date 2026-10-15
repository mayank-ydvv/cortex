/**
 * Embedding provider.
 *
 * Gemini `gemini-embedding-001` over the OpenAI-compatible endpoint, truncated
 * to 768 dimensions. Hosted rather than local because the app runs on Vercel:
 * the previous local model (bge-small via onnxruntime) was 287MB of native
 * binaries against a 250MB serverless function limit. This is the one-file swap
 * the provider interface was built for.
 *
 * Changing the model invalidates every stored vector -- different models do not
 * share a vector space -- so the switch landed alongside a migration to
 * vector(768) on an empty corpus.
 */

export const MODEL_ID = process.env.EMBEDDING_MODEL || 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Ceiling on a single chunk. Gemini accepts up to 2048 tokens, but the chunker
 * splits anything over this, and its sizes were tuned for retrieval precision:
 * smaller chunks match more precisely. Kept from the bge-small era on purpose.
 */
export const MAX_INPUT_TOKENS = 512;

/** Target size for a chunk. Unchanged by the model swap: it is a retrieval choice. */
export const TARGET_CHUNK_TOKENS = 400;

/**
 * Conservative characters-per-token estimate. Real tokenisation is unnecessary
 * for choosing split points, but the estimate must never UNDER-count or a chunk
 * could exceed the model limit and be truncated silently. Dense code tokenises
 * worse than prose, so 3 is used rather than the usual ~4.
 */
const CHARS_PER_TOKEN = 3;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface EmbedProgress {
  done: number;
  total: number;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  readonly maxInputTokens: number;
  /** Embed passages for storage. */
  embedDocuments(texts: string[], onProgress?: (p: EmbedProgress) => void): Promise<number[][]>;
  /** Embed a search query. */
  embedQuery(text: string): Promise<number[]>;
}

/** Inputs per request. Gemini accepts up to 100; fewer keeps each call quick. */
const DEFAULT_BATCH_SIZE = 64;

/** A stalled upstream must not hang an import. */
const REQUEST_TIMEOUT_MS = 30_000;

class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly id = MODEL_ID;
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly maxInputTokens = MAX_INPUT_TOKENS;

  constructor(
    private readonly apiKey = process.env.EMBEDDING_API_KEY || process.env.ANSWER_API_KEY,
    private readonly baseUrl = process.env.EMBEDDING_BASE_URL
      || 'https://generativelanguage.googleapis.com/v1beta/openai',
    private readonly batchSize = DEFAULT_BATCH_SIZE,
  ) {}

  async #embed(texts: string[], attempt = 0): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.apiKey) {
      throw new Error('No embedding key configured. Set EMBEDDING_API_KEY (or ANSWER_API_KEY).');
    }

    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: MODEL_ID, input: texts, dimensions: EMBEDDING_DIMENSIONS }),
    });

    // Free tiers rate-limit per minute. Back off and retry rather than failing a
    // whole import over a burst; give up after a few attempts so a daily quota
    // wall surfaces as an error instead of an endless wait.
    if (res.status === 429 && attempt < 4) {
      const body = await res.text().catch(() => '');
      const hinted = Number(/retry in ([\d.]+)s/i.exec(body)?.[1]);
      const wait = Number.isFinite(hinted) ? hinted * 1000 : 2 ** attempt * 2000;
      await new Promise((r) => setTimeout(r, Math.min(wait, 60_000)));
      return this.#embed(texts, attempt + 1);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Embedding request failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { data?: { embedding: number[]; index: number }[] };
    const data = json.data ?? [];
    if (data.length !== texts.length) {
      throw new Error(`Embedding returned ${data.length} vectors for ${texts.length} inputs.`);
    }
    // Order by index explicitly rather than trusting response order.
    return [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  async embedDocuments(
    texts: string[],
    onProgress?: (p: EmbedProgress) => void,
  ): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      results.push(...(await this.#embed(batch)));
      onProgress?.({ done: Math.min(i + batch.length, texts.length), total: texts.length });
    }
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.#embed([text]);
    if (!vector) throw new Error('embedQuery produced no vector');
    return vector;
  }
}

let shared: EmbeddingProvider | null = null;

/** The process-wide provider. */
export function getEmbeddingProvider(): EmbeddingProvider {
  shared ??= new GeminiEmbeddingProvider();
  return shared;
}
