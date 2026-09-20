/**
 * Embedding provider.
 *
 * Embeddings run locally: Xenova/bge-small-en-v1.5 via onnxruntime, 384
 * dimensions, no API key and no per-call cost.
 *
 * The provider interface exists because this will not survive a move to Vercel —
 * onnxruntime-node ships native binaries that do not run on serverless. When that
 * happens, swapping providers must stay a one-file change rather than a rewrite.
 *
 * Note that retry-with-backoff, which a hosted API would need for 429s, is absent
 * here on purpose: local inference has no rate limit and no network. An API
 * provider implementing this interface would add it internally.
 */
import type { FeatureExtractionPipeline } from '@huggingface/transformers';

export const MODEL_ID = 'Xenova/bge-small-en-v1.5';
export const EMBEDDING_DIMENSIONS = 384;

/**
 * The model truncates silently past this. Anything longer loses its tail with no
 * error, so the chunker must stay under it rather than relying on the model.
 */
export const MAX_INPUT_TOKENS = 512;

/** Target size for a chunk, comfortably inside the limit. */
export const TARGET_CHUNK_TOKENS = 400;

/**
 * BGE models are trained asymmetrically: queries carry this prefix, documents do
 * not. Omitting it measurably degrades retrieval quality.
 */
export const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

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
  /** Embed passages for storage. No query prefix. */
  embedDocuments(texts: string[], onProgress?: (p: EmbedProgress) => void): Promise<number[][]>;
  /** Embed a search query. Applies the BGE query prefix. */
  embedQuery(text: string): Promise<number[]>;
}

/**
 * Batch size is about memory, not request overhead: there is no network here.
 * 32 keeps peak memory modest while still amortising the per-call cost.
 */
const DEFAULT_BATCH_SIZE = 32;

class LocalBgeProvider implements EmbeddingProvider {
  readonly id = MODEL_ID;
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly maxInputTokens = MAX_INPUT_TOKENS;

  #pipeline: Promise<FeatureExtractionPipeline> | null = null;

  constructor(private readonly batchSize = DEFAULT_BATCH_SIZE) {}

  /** Loaded once, lazily — the first call downloads the model (~34MB) and caches it. */
  #getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.#pipeline) {
      this.#pipeline = import('@huggingface/transformers').then((m) =>
        m.pipeline('feature-extraction', MODEL_ID),
      );
    }
    return this.#pipeline;
  }

  async #embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.#getPipeline();
    const out = await extractor(texts, { pooling: 'mean', normalize: true });
    return out.tolist() as number[][];
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
    const [vector] = await this.#embed([QUERY_PREFIX + text]);
    if (!vector) throw new Error('embedQuery produced no vector');
    return vector;
  }
}

let shared: EmbeddingProvider | null = null;

/** The process-wide provider. Shared so the model is loaded only once. */
export function getEmbeddingProvider(): EmbeddingProvider {
  shared ??= new LocalBgeProvider();
  return shared;
}
