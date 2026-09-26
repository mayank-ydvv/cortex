'use server';

import { revalidatePath } from 'next/cache';
import { answerQuestion } from '../src/answer/index';
import {
  appendMessage,
  createThread,
  deleteThread as removeThread,
  getMessages,
  listThreads,
  renameThread as setTitle,
  retrievalQuery,
  titleFromQuestion,
  type StoredSource,
  type ThreadSummary,
} from '../src/chat/threads';

export interface ClientMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sources: StoredSource[] | null;
  note: string | null;
}

export interface ClientThread {
  id: number;
  title: string;
  updatedAt: string;
  messageCount: number;
}

/** How many prior turns to replay to the model. Enough for context, not the world. */
const HISTORY_TURNS = 8;

const toClientThread = (t: ThreadSummary): ClientThread => ({
  id: t.id,
  title: t.title,
  updatedAt: t.updatedAt.toISOString(),
  messageCount: t.messageCount,
});

export async function fetchThreads(): Promise<ClientThread[]> {
  return (await listThreads()).map(toClientThread);
}

export async function fetchMessages(threadId: number): Promise<ClientMessage[]> {
  return (await getMessages(threadId)).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    sources: m.sources,
    note: m.note,
  }));
}

export interface SendResult {
  threadId: number;
  title: string;
  userMessage: ClientMessage;
  assistantMessage: ClientMessage;
  model: string | null;
  timeExpression: string | null;
  range: { from: string; to: string } | null;
  warnings: string[];
}

/**
 * Send a message, answering from the corpus and persisting both turns.
 *
 * Creates the thread on the first message rather than up front, so clicking
 * "new chat" and changing your mind does not litter the sidebar with empties.
 */
export async function sendMessage(
  threadId: number | null,
  question: string,
): Promise<SendResult> {
  const q = question.trim();
  if (q === '') throw new Error('Empty message.');

  const existing = threadId ? await getMessages(threadId) : [];

  const id = threadId ?? (await createThread(titleFromQuestion(q)));
  const title = threadId
    ? ''
    : titleFromQuestion(q);

  // Prior turns give the model continuity; prior QUESTIONS additionally give
  // retrieval its subject back when the new message is a bare follow-up.
  const history = existing.slice(-HISTORY_TURNS).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const priorQuestions = existing.filter((m) => m.role === 'user').map((m) => m.content);

  const result = await answerQuestion(q, {
    history,
    retrieveWith: retrievalQuery(q, priorQuestions),
  });

  const sources: StoredSource[] = result.sources.map((h, i) => ({
    n: i + 1,
    chunkId: h.chunkId,
    sourceId: h.sourceId,
    title: h.sourceTitle,
    origin: h.origin,
    occurredAt: h.occurredAt.toISOString(),
    role: h.role,
    content: h.content,
    vectorRank: h.vectorRank,
    keywordRank: h.keywordRank,
  }));

  const userId = await appendMessage(id, 'user', q);
  const note = result.answer
    ? null
    : [result.unavailable?.message, result.unavailable?.hint].filter(Boolean).join(' ');

  const assistantId = await appendMessage(
    id,
    'assistant',
    result.answer ?? '',
    sources.length > 0 ? sources : null,
    note || null,
  );

  revalidatePath('/');

  return {
    threadId: id,
    title: title || (await listThreads()).find((t) => t.id === id)?.title || '',
    userMessage: { id: userId, role: 'user', content: q, sources: null, note: null },
    assistantMessage: {
      id: assistantId,
      role: 'assistant',
      content: result.answer ?? '',
      sources: sources.length > 0 ? sources : null,
      note: note || null,
    },
    model: result.model,
    timeExpression: result.explain.timeExpression,
    range: result.explain.range
      ? {
          from: result.explain.range.from.toISOString(),
          to: result.explain.range.to.toISOString(),
        }
      : null,
    warnings: result.explain.warnings,
  };
}

export async function deleteThread(threadId: number): Promise<void> {
  await removeThread(threadId);
  revalidatePath('/');
}

export async function renameThread(threadId: number, title: string): Promise<void> {
  const clean = title.trim();
  if (clean === '') return;
  await setTitle(threadId, clean.slice(0, 120));
  revalidatePath('/');
}
