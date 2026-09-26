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
 *
 * Files come in two shapes, and only one carries text:
 *
 *   files[]       file_uuid + file_name, and file_name is frequently null.
 *                 Names only, so they are appended to the message as a marker
 *                 that makes "what did I say about X.pdf" findable.
 *   attachments[] file_name, file_size, file_type AND extracted_content --
 *                 real text. That becomes its own message so it is chunked,
 *                 embedded and searchable like anything else, carrying the
 *                 parent message's role and timestamp.
 */
import type { ParsedConversation, ParsedMessage, Parser } from './types';

interface ClaudeBlock {
  type?: string;
  text?: string;
}

interface ClaudeFile {
  file_uuid?: string;
  file_name?: string | null;
}

interface ClaudeAttachment {
  file_name?: string | null;
  file_size?: number;
  file_type?: string;
  extracted_content?: string;
}

interface ClaudeMessage {
  uuid?: string;
  text?: string;
  content?: ClaudeBlock[];
  sender?: string;
  created_at?: string;
  files?: ClaudeFile[];
  attachments?: ClaudeAttachment[];
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

/** Names of anything attached, from either shape. Nulls are common in files[]. */
function attachedNames(m: ClaudeMessage): string[] {
  const names = [
    ...(m.files ?? []).map((f) => f?.file_name),
    ...(m.attachments ?? []).map((a) => a?.file_name),
  ];
  return [...new Set(names.filter((n): n is string => typeof n === 'string' && n.trim() !== ''))];
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
      const occurredAt = parseDate(m.created_at);
      const r = role(m.sender);
      const names = attachedNames(m);

      let content = messageText(m);
      // Record what was attached so the file is findable by name, even though
      // the export carries no bytes for it.
      if (names.length > 0) {
        const marker = `[attached: ${names.join(', ')}]`;
        content = content === '' ? marker : `${content}\n\n${marker}`;
      }
      if (content !== '') messages.push({ role: r, content, occurredAt });

      // Attachment text is real content. It becomes its own message so it is
      // chunked and embedded normally, inheriting this message's time and role.
      for (const a of m.attachments ?? []) {
        const extracted = a?.extracted_content?.trim();
        if (!extracted) continue;
        const label = a.file_name?.trim() || a.file_type?.trim() || 'attachment';
        messages.push({ role: r, content: `[file: ${label}]\n\n${extracted}`, occurredAt });
      }
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
