/**
 * Answer provider.
 *
 * Behind an interface for the same reason embeddings are: the backing service
 * is a deployment detail, and swapping it must stay a one-file change.
 *
 * Uses plain fetch against an OpenAI-compatible endpoint rather than a vendor
 * SDK, so no dependency is added and any compatible provider works by changing
 * two environment variables.
 */

export interface AnswerProvider {
  readonly id: string;
  readonly model: string;
  /** False when no key is configured; callers fall back to showing sources. */
  readonly available: boolean;
  complete(system: string, user: string, signal?: AbortSignal): Promise<string>;
}

export class AnswerUnavailableError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = 'AnswerUnavailableError';
  }
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';

class OpenAICompatibleProvider implements AnswerProvider {
  readonly id: string;
  readonly model: string;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly baseUrl: string,
    model: string,
  ) {
    this.model = model;
    this.id = `${new URL(baseUrl).hostname} · ${model}`;
  }

  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(system: string, user: string, signal?: AbortSignal): Promise<string> {
    if (!this.apiKey) {
      throw new AnswerUnavailableError(
        'No answer model is configured.',
        'Add an API key to .env to get written answers. Results are still listed below.',
      );
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        // OpenRouter asks callers to identify themselves; harmless elsewhere.
        'HTTP-Referer': 'http://localhost:3200',
        'X-Title': 'memory-engine',
      },
      body: JSON.stringify({
        model: this.model,
        // Low temperature: this is a lookup over your own words, not writing.
        temperature: 0.1,
        max_tokens: 700,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const snippet = body.slice(0, 300);
      if (res.status === 401 || res.status === 403) {
        throw new AnswerUnavailableError(
          `The answer model rejected the key (${res.status}).`,
          'Check the key in .env. Retrieval still works without it.',
        );
      }
      if (res.status === 429) {
        throw new AnswerUnavailableError(
          'Rate limited by the answer model.',
          'Free tiers are capped. Wait a moment, or switch ANSWER_MODEL in .env.',
        );
      }
      throw new AnswerUnavailableError(`Answer model returned ${res.status}. ${snippet}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };

    if (json.error?.message) throw new AnswerUnavailableError(json.error.message);

    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new AnswerUnavailableError('The answer model returned nothing.');
    return text;
  }
}

let shared: AnswerProvider | null = null;

export function getAnswerProvider(): AnswerProvider {
  if (!shared) {
    shared = new OpenAICompatibleProvider(
      process.env.ANSWER_API_KEY || process.env.OPENROUTER_API_KEY,
      process.env.ANSWER_BASE_URL || DEFAULT_BASE_URL,
      process.env.ANSWER_MODEL || DEFAULT_MODEL,
    );
  }
  return shared;
}

/** Test seam. */
export function setAnswerProvider(p: AnswerProvider | null): void {
  shared = p;
}
