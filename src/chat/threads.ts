/**
 * Saved chat threads.
 *
 * Conversations you have WITH the engine, stored so you can leave and come
 * back. Separate from the imported corpus on purpose: your questions are not
 * memories, and indexing them would have the engine answering out of its own
 * previous output.
 */
import { asUser } from '../db/client';

export interface StoredSource {
  n: number;
  chunkId: number;
  sourceId: number;
  title: string | null;
  origin: string;
  occurredAt: string;
  role: string;
  content: string;
  vectorRank: number | null;
  keywordRank: number | null;
}

export interface ThreadSummary {
  id: number;
  title: string;
  updatedAt: Date;
  messageCount: number;
}

export interface StoredMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sources: StoredSource[] | null;
  note: string | null;
  createdAt: Date;
}

/**
 * A thread's title is the first question, trimmed -- not model-generated.
 * Generating one would double the API calls per new chat, and the free tier
 * here is measured in tens of requests per day.
 */
export function titleFromQuestion(question: string): string {
  const line = question.trim().replace(/\s+/g, ' ');
  if (line === '') return 'New chat';
  return line.length > 60 ? `${line.slice(0, 60).trimEnd()}…` : line;
}

export async function createThread(userId: string, title: string): Promise<number> {
  return asUser(userId, async (tx) => {
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO chat_threads (user_id, title) VALUES (${userId}, ${title}) RETURNING id
    `;
    return row!.id;
  });
}

export async function listThreads(userId: string, limit = 100): Promise<ThreadSummary[]> {
  const rows = await asUser(userId, (tx) => tx<{ id: number; title: string; updated_at: Date; n: string }[]>`
    SELECT t.id, t.title, t.updated_at, count(m.id)::text AS n
    FROM chat_threads t
    LEFT JOIN chat_messages m ON m.thread_id = t.id
    WHERE t.user_id = ${userId}
    GROUP BY t.id
    ORDER BY t.updated_at DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updated_at,
    messageCount: Number(r.n),
  }));
}

export async function getMessages(userId: string, threadId: number): Promise<StoredMessage[]> {
  const rows = await asUser(userId, (tx) => tx<{
    id: number; role: 'user' | 'assistant'; content: string;
    sources: StoredSource[] | null; note: string | null; created_at: Date;
  }[]>`
    SELECT id, role, content, sources, note, created_at
    FROM chat_messages
    WHERE thread_id = ${threadId} AND user_id = ${userId}
    ORDER BY id
  `);
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    sources: r.sources,
    note: r.note,
    createdAt: r.created_at,
  }));
}

export async function appendMessage(
  userId: string,
  threadId: number,
  role: 'user' | 'assistant',
  content: string,
  sources?: StoredSource[] | null,
  note?: string | null,
): Promise<number> {
  return asUser(userId, async (tx) => {
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO chat_messages (user_id, thread_id, role, content, sources, note)
      VALUES (${userId}, ${threadId}, ${role}, ${content},
              ${sources ? tx.json(sources as never) : null}, ${note ?? null})
      RETURNING id
    `;
    await tx`UPDATE chat_threads SET updated_at = now()
             WHERE id = ${threadId} AND user_id = ${userId}`;
    return row!.id;
  });
}

export async function deleteThread(userId: string, threadId: number): Promise<void> {
  await asUser(userId, (tx) =>
    tx`DELETE FROM chat_threads WHERE id = ${threadId} AND user_id = ${userId}`);
}

export async function renameThread(userId: string, threadId: number, title: string): Promise<void> {
  await asUser(userId, (tx) =>
    tx`UPDATE chat_threads SET title = ${title}
       WHERE id = ${threadId} AND user_id = ${userId}`);
}

/**
 * Build the text used for RETRIEVAL on a follow-up.
 *
 * A bare follow-up like "and my weight?" retrieves almost nothing on its own --
 * it has no content words to match. Prepending the previous question restores
 * the subject, so search behaves the way the conversation reads.
 *
 * A heuristic rather than a model call: condensing history properly would
 * double the requests per turn, and the free tier is measured in tens per day.
 * Short follow-ups are exactly the case it helps; a long self-contained
 * question is left alone because it needs no help.
 */
const FOLLOW_UP_CHARS = 80;

export function retrievalQuery(question: string, priorUserMessages: string[]): string {
  const q = question.trim();
  if (q.length > FOLLOW_UP_CHARS || priorUserMessages.length === 0) return q;
  const previous = priorUserMessages[priorUserMessages.length - 1]!.trim();
  return previous === '' ? q : `${previous} ${q}`;
}
