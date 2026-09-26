/**
 * Answering: retrieval first, then synthesis over what was retrieved.
 *
 * The order matters. The model never answers from its own knowledge; it is
 * given your own words and told to answer only from them. A fluent answer that
 * is not in the corpus is the failure this whole system exists to prevent, so
 * the prompt forbids it and every answer ships with the sources it used.
 */
import { search, type SearchExplain, type SearchHit, type SearchOptions } from '../search/index';
import { AnswerUnavailableError, getAnswerProvider } from './provider';

export interface AnswerResult {
  /** Null when no model is configured or the call failed; sources still returned. */
  answer: string | null;
  /** Why there is no answer, when there isn't one. */
  unavailable: { message: string; hint?: string } | null;
  sources: SearchHit[];
  explain: SearchExplain;
  model: string | null;
}

/** How many chunks to put in front of the model. */
const CONTEXT_CHUNKS = 12;

const SYSTEM = `You answer questions about the user's own past conversations and notes.

You are given NUMBERED EXCERPTS from their history. Follow these rules exactly:

1. Answer ONLY from the excerpts. Never use outside knowledge, and never guess.
2. If the excerpts do not contain the answer, say so plainly: "I couldn't find
   that in your history." Do not speculate or offer a generic answer. Saying you
   could not find it is a correct and useful answer.
3. Cite the excerpts you used with their numbers in square brackets, like [2].
   Every factual claim needs a citation.
4. Be direct. If asked "what is my height" and an excerpt says 180 cm, answer
   "You're 180 cm" and cite it. Do not pad the answer.
5. If excerpts disagree, prefer the most recent, say the newer one supersedes the
   older, and cite both. Each excerpt is dated.
6. Quote the user's own words when the exact wording matters.`;

function buildContext(hits: SearchHit[]): string {
  return hits
    .map((h, i) => {
      const when = h.occurredAt.toISOString().slice(0, 10);
      const who = h.role === 'user' ? 'you' : 'the assistant';
      return `[${i + 1}] ${when} · ${h.sourceTitle ?? 'untitled'} (${h.origin}, said by ${who})\n${h.content}`;
    })
    .join('\n\n---\n\n');
}

export async function answerQuestion(
  question: string,
  opts: SearchOptions = {},
): Promise<AnswerResult> {
  const { hits, explain } = await search(question, {
    ...opts,
    limit: opts.limit ?? CONTEXT_CHUNKS,
  });

  const provider = getAnswerProvider();

  if (hits.length === 0) {
    return {
      answer: null,
      unavailable: {
        message: 'Nothing in your history matched that.',
        hint: explain.range
          ? 'A date filter was applied — try removing the time phrase, or widening it.'
          : 'Try different wording, or check the import on the status page.',
      },
      sources: [],
      explain,
      model: provider.available ? provider.model : null,
    };
  }

  if (!provider.available) {
    return {
      answer: null,
      unavailable: {
        message: 'No answer model configured, so here are the matching excerpts.',
        hint: 'Add ANSWER_API_KEY to .env for written answers.',
      },
      sources: hits,
      explain,
      model: null,
    };
  }

  const user = `Question: ${question}\n\nExcerpts from the user's history:\n\n${buildContext(hits)}`;

  try {
    const answer = await provider.complete(SYSTEM, user);
    return { answer, unavailable: null, sources: hits, explain, model: provider.model };
  } catch (err) {
    const e = err instanceof AnswerUnavailableError ? err : null;
    return {
      answer: null,
      unavailable: {
        message: e?.message ?? (err instanceof Error ? err.message : String(err)),
        hint: e?.hint ?? 'Retrieval still worked — the matching excerpts are below.',
      },
      sources: hits,
      explain,
      model: provider.model,
    };
  }
}
