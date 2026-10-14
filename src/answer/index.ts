/**
 * Answering: retrieval first, then synthesis over what was retrieved.
 *
 * The order matters. The model never answers from its own knowledge; it is
 * given your own words and told to answer only from them. A fluent answer that
 * is not in the corpus is the failure this whole system exists to prevent, so
 * the prompt forbids it and every answer ships with the sources it used.
 */
import { search, type SearchExplain, type SearchHit, type SearchOptions } from '../search/index';
import { AnswerUnavailableError, getAnswerProvider, type ChatTurn } from './provider';

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

/**
 * Deliberately short.
 *
 * A longer version of this prompt, with an explicit GROUNDING section spelling
 * out every prohibition, made the model refuse questions it could plainly
 * answer: it returned "I couldn't find that" against excerpts that contained
 * the answer three times over. Piling on warnings about not hallucinating
 * pushes a model toward declining rather than toward accuracy. Stating the job
 * first, and the limit once, measurably works better.
 */
const SYSTEM = `You answer questions about the user's own past conversations and notes.

Read the numbered excerpts and answer directly and briefly. Cite the excerpts
you used like [2]; every factual claim needs one. Quote their own words when the
exact wording matters.

Use only the excerpts, and never invent specifics that are not written in them.
If excerpts disagree, prefer the most recent, say it supersedes the older, and
cite both — every excerpt is dated.

If the excerpts genuinely do not address the question, say "I couldn't find that
in your history."`;

function buildContext(hits: SearchHit[]): string {
  return hits
    .map((h, i) => {
      const when = h.occurredAt.toISOString().slice(0, 10);
      const who = h.role === 'user' ? 'you' : 'the assistant';
      return `[${i + 1}] ${when} · ${h.sourceTitle ?? 'untitled'} (${h.origin}, said by ${who})\n${h.content}`;
    })
    .join('\n\n---\n\n');
}

export interface AnswerOptions extends SearchOptions {
  /** Whose corpus to answer from. Inherited from SearchOptions. */
  /** Prior turns in this thread, so a follow-up reads as a continuation. */
  history?: ChatTurn[];
  /**
   * Text to retrieve with, when it should differ from the question. A bare
   * follow-up needs its subject restored before it can match anything.
   */
  retrieveWith?: string;
}

export async function answerQuestion(
  question: string,
  opts: AnswerOptions = {},
): Promise<AnswerResult> {
  const { hits, explain } = await search(opts.retrieveWith ?? question, {
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
    const answer = await provider.complete(SYSTEM, user, opts.history ?? []);
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
