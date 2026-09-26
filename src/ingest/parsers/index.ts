/**
 * Parser registry.
 *
 * Detection is structural, never by filename: an export can be renamed, and a
 * file called "claude.json" may be anything at all.
 */
import { claudeParser } from './claude';
import type { Origin, ParsedConversation, Parser } from './types';

export const PARSERS: Parser[] = [claudeParser];

export interface ParseOutcome {
  origin: Origin;
  conversations: ParsedConversation[];
}

/** Returns null when no registered parser recognises the structure. */
export function parseExport(json: unknown): ParseOutcome | null {
  for (const parser of PARSERS) {
    if (!parser.detect(json)) continue;
    return { origin: parser.origin, conversations: parser.parse(json) };
  }
  return null;
}
