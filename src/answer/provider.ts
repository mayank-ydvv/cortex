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

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnswerProvider {
  readonly id: string;
  readonly model: string;
  /** False when no key is configured; callers fall back to showing sources. */
  readonly available: boolean;
  /** `history` carries prior turns so follow-ups resolve against them. */
  complete(
    system: string,
    user: string,
    history?: ChatTurn[],
    signal?: AbortSignal,
  ): Promise<string>;
}

export class AnswerUnavailableError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = 'AnswerUnavailableError';
  }
}

/** A hung request must not hang the page. */
const REQUEST_TIMEOUT_MS = 45_000;

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

  async complete(
    system: string,
    user: string,
    history: ChatTurn[] = [],
    signal?: AbortSignal,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new AnswerUnavailableError(
        'No answer model is configured.',
        'Add an API key to .env to get written answers. Results are still listed below.',
      );
    }

    // Bound every call. Without this a stalled upstream blocks the request
    // indefinitely, and the page just spins with no way to recover.
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: combined,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        // OpenRouter asks callers to identify themselves; harmless elsewhere.
        'HTTP-Referer': 'http://localhost:3200',
        'X-Title': 'cortex',
      },
      body: JSON.stringify({
        model: this.model,
        // Low temperature: this is a lookup over your own words, not writing.
        temperature: 0.1,
        // Generous: a thinking model spends part of this budget before
        // emitting any answer, and a clipped answer is worse than a slow one.
        max_tokens: 2000,
        messages: [
          { role: 'system', content: system },
          ...history,
          { role: 'user', content: user },
        ],
      }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new AnswerUnavailableError(
          `The answer model did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`,
          'Retrieval still worked — the matching excerpts are below.',
        );
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AnswerUnavailableError('The request was cancelled.');
      }
      throw new AnswerUnavailableError(
        `Could not reach the answer model: ${err instanceof Error ? err.message : String(err)}`,
        'Check your connection. Retrieval still works without it.',
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = extractError(body);

      if (res.status === 401 || res.status === 403) {
        throw new AnswerUnavailableError(
          `The answer model rejected the key (${res.status}).`,
          'Check ANSWER_API_KEY in .env. Retrieval still works without it.',
        );
      }

      if (res.status === 429) {
        // Google states the daily cap and a retry delay in the error body.
        // Surfacing both matters: on a free tier the cap is the real limit,
        // and a generic "rate limited" leaves you guessing whether to wait
        // 30 seconds or until tomorrow.
        const limit = /limit:\s*(\d+)/.exec(err)?.[1];
        const retry = /retry in ([\d.]+)s/i.exec(err)?.[1];
        throw new AnswerUnavailableError(
          limit
            ? `Daily free-tier quota reached for ${this.model} (${limit} requests/day).`
            : 'Rate limited by the answer model.',
          retry
            ? `Retry in about ${Math.ceil(Number(retry))}s, or set a different ANSWER_MODEL in .env.`
            : 'Wait a moment, or set a different ANSWER_MODEL in .env.',
        );
      }

      if (res.status === 404) {
        throw new AnswerUnavailableError(
          `Model "${this.model}" is not available.`,
          'It may have been retired. Change ANSWER_MODEL in .env.',
        );
      }

      throw new AnswerUnavailableError(
        `Answer model returned ${res.status}.`,
        err.slice(0, 200) || undefined,
      );
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      error?: { message?: string };
    };

    if (json.error?.message) throw new AnswerUnavailableError(json.error.message);

    const choice = json.choices?.[0];
    const text = choice?.message?.content?.trim();

    if (!text) {
      // Gemini's reasoning tokens count against max_tokens, so a thinking model
      // can spend the whole budget before emitting anything.
      throw new AnswerUnavailableError(
        'The answer model returned an empty response.',
        choice?.finish_reason === 'length'
          ? 'It ran out of output budget. Try a smaller ANSWER_MODEL or a shorter question.'
          : 'This is usually transient. The matching excerpts are below either way.',
      );
    }
    return text;
  }
}

/**
 * Pull a readable message out of an error body.
 * Google wraps errors in an ARRAY -- [{ error: {...} }] -- which the plain
 * OpenAI shape does not, so both are handled.
 */
function extractError(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    const msg = (obj as { error?: { message?: string } })?.error?.message;
    if (typeof msg === 'string') return msg;
  } catch {
    // not JSON; fall through to the raw body
  }
  return body;
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
