/**
 * Parser for my own notes: markdown or plain text.
 *
 * Unlike the Claude and ChatGPT parsers, this format is ours to define, so there
 * is nothing to reverse-engineer. Optional YAML-ish frontmatter carries the
 * metadata:
 *
 *     ---
 *     title: Auth notes
 *     date: 2026-09-17
 *     project: api
 *     ---
 *     We settled on short-lived JWTs...
 *
 * `date` matters. Without it the file's mtime is used, which is a real timestamp
 * but not necessarily when the note was written, so ingest reports it as
 * inherited. Import time is never used.
 */
import { basename } from 'node:path';
import type { ParsedConversation, ParsedMessage } from './types';

export interface ManualInput {
  text: string;
  path: string;
  /** Filesystem mtime, the fallback when frontmatter carries no date. */
  mtime: Date;
}

interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

function splitFrontmatter(text: string): Frontmatter {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { fields: {}, body: text };

  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) fields[kv[1]!.toLowerCase()] = kv[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return { fields, body: text.slice(match[0].length) };
}

/** First markdown heading, else the filename without extension. */
function deriveTitle(body: string, path: string): string {
  const heading = body.match(/^#{1,6}\s+(.+)$/m);
  if (heading) return heading[1]!.trim();
  return basename(path).replace(/\.[^.]+$/, '');
}

export function parseManual(input: ManualInput): ParsedConversation {
  const { fields, body } = splitFrontmatter(input.text);

  const raw = fields.date ?? fields.created ?? fields.occurred_at;
  const parsed = raw ? new Date(raw) : null;
  const dated = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;

  const startedAt = dated ?? input.mtime;

  const message: ParsedMessage = {
    role: 'user',
    content: body.trim(),
    // null signals "inherit", which the chunker counts and ingest reports.
    occurredAt: dated,
  };

  return {
    externalId: input.path,
    title: fields.title ?? deriveTitle(body, input.path),
    startedAt,
    messages: [message],
  };
}

/** Frontmatter project, if present. Overridden by the CLI's --project flag. */
export function manualProject(text: string): string | null {
  return splitFrontmatter(text).fields.project ?? null;
}
