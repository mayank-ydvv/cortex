/**
 * Claude export parser.
 *
 * Written against a real export (110 conversations, 819 messages), not against
 * a remembered schema. The shape is:
 *
 *   [ { uuid, name, summary, created_at, updated_at, account, chat_messages: [
 *       { uuid, text, content[], sender, created_at, updated_at,
 *         attachments[], files[], parent_message_uuid } ] } ]
 *
 * Four things in that data decide how this is written:
 *
 * 1. `text` and `content` disagree. In the sample, `text` was longer than the
 *    joined text blocks in 105 messages and shorter in none, so `text` is the
 *    complete rendering and `content` is the fallback. Using `content` alone
 *    would silently drop characters off the end of long answers.
 *
 * 2. 233 of 819 messages carry no text at all -- 224 with an empty content
 *    array, the rest thinking-only or empty text blocks. They are skipped and
 *    counted, rather than stored as empty chunks that match nothing.
 *
 * 3. `content` also carries tool_use (522), tool_result (480) and thinking
 *    (238) blocks. None are conversation, and indexing them would bury real
 *    answers under JSON payloads, so only text blocks are read.
 *
 * 4. 37 conversations have no name, so the title falls back through summary to
 *    the first human message. An uncitable result is a failure in this system.
 */
import type { ParsedConversation, ParsedMessage, Parser } from './types';

interface ClaudeBlock {
  type?: string;
  text?: string;
}

interface ClaudeMessage {
  uuid?: string;
  text?: string;
  content?: ClaudeBlock[];
  sender?: string;
  created_at?: string;
}

interface ClaudeConversation {
  uuid?: string;
  name?: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: ClaudeMessage[];
}

/** Join only the text blocks; tool_use, tool_result and thinking are not conversation. */
function joinTextBlocks(content: ClaudeBlock[] | undefined): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!.trim())
    .filter((t) => t !== '')
    .join('\n\n');
}

/** `text` is the complete rendering; blocks are the fallback when it is absent. */
function messageText(m: ClaudeMessage): string {
  const direct = typeof m.text === 'string' ? m.text.trim() : '';
  if (direct !== '') return direct;
  return joinTextBlocks(m.content);
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Claude uses "human"; everything else in the export is the assistant. */
function role(sender: unknown): 'user' | 'assistant' {
  return sender === 'human' ? 'user' : 'assistant';
}

/** First line of text, trimmed to something that reads as a title. */
function titleFromText(text: string): string | null {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l !== '');
  if (!line) return null;
  return line.length > 70 ? `${line.slice(0, 70).trimEnd()}…` : line;
}

function deriveTitle(c: ClaudeConversation, messages: ParsedMessage[]): string | null {
  const name = c.name?.trim();
  if (name) return name;

  const summary = c.summary?.trim();
  if (summary) return titleFromText(summary);

  const firstUser = messages.find((m) => m.role === 'user');
  return firstUser ? titleFromText(firstUser.content) : null;
}

export function parseClaudeExport(json: unknown): ParsedConversation[] {
  if (!Array.isArray(json)) return [];

  const out: ParsedConversation[] = [];

  for (const raw of json as ClaudeConversation[]) {
    if (!raw || typeof raw !== 'object') continue;

    const externalId = typeof raw.uuid === 'string' && raw.uuid ? raw.uuid : null;
    if (!externalId) continue; // no stable identity means no idempotent re-import

    const messages: ParsedMessage[] = [];
    for (const m of raw.chat_messages ?? []) {
      const content = messageText(m);
      if (content === '') continue; // tool-only, thinking-only or genuinely empty
      messages.push({ role: role(m.sender), content, occurredAt: parseDate(m.created_at) });
    }

    if (messages.length === 0) continue;

    // Prefer the conversation's own timestamp; fall back to its earliest dated
    // message. Never import time -- that would break every time-scoped query.
    const dated = messages.map((m) => m.occurredAt).filter((d): d is Date => d !== null);
    const startedAt =
      parseDate(raw.created_at) ??
      (dated.length > 0 ? new Date(Math.min(...dated.map((d) => d.getTime()))) : null);

    if (!startedAt) continue; // nothing real to anchor the conversation to

    out.push({
      externalId,
      title: deriveTitle(raw, messages),
      startedAt,
      messages,
    });
  }

  return out;
}

export const claudeParser: Parser = {
  origin: 'claude',
  detect(json: unknown): boolean {
    if (!Array.isArray(json) || json.length === 0) return false;
    const first = json[0];
    return (
      !!first &&
      typeof first === 'object' &&
      'uuid' in first &&
      'chat_messages' in first &&
      Array.isArray((first as ClaudeConversation).chat_messages)
    );
  },
  parse: parseClaudeExport,
};
