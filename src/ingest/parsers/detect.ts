/**
 * Export format detection.
 *
 * The Claude and ChatGPT parsers are deliberately NOT implemented yet. Both
 * exports are JSON but differently shaped, and the shapes change over time.
 * Writing them from memory of the format produces a parser that works on the
 * file I imagined and silently mangles the one you actually have -- most
 * damagingly the timestamps, which would degrade every time-scoped query
 * without raising an error.
 *
 * So instead of guessing, this reports what it found and asks for the file.
 * `pnpm ingest <file> --inspect` prints the structure needed to write it.
 */
import type { Origin } from './types';

export interface DetectionReport {
  origin: Origin | null;
  /** Human-readable description of what the file looks like. */
  shape: string;
  topLevelKeys: string[];
  itemCount: number | null;
}

/** Describe a parsed JSON export without assuming a schema. */
export function inspectJson(json: unknown): DetectionReport {
  if (Array.isArray(json)) {
    const first = json[0];
    const keys = first && typeof first === 'object' ? Object.keys(first as object) : [];
    return {
      origin: guessFromKeys(keys),
      shape: `array of ${json.length} object(s)`,
      topLevelKeys: keys,
      itemCount: json.length,
    };
  }

  if (json && typeof json === 'object') {
    const keys = Object.keys(json as object);
    return {
      origin: guessFromKeys(keys),
      shape: 'single object',
      topLevelKeys: keys,
      itemCount: null,
    };
  }

  return { origin: null, shape: typeof json, topLevelKeys: [], itemCount: null };
}

/**
 * A hint only, never a licence to parse. Both formats have carried these keys at
 * some point, but field names and nesting have changed across export versions.
 */
function guessFromKeys(keys: string[]): Origin | null {
  const k = new Set(keys.map((s) => s.toLowerCase()));
  if (k.has('chat_messages') || (k.has('uuid') && k.has('name'))) return 'claude';
  if (k.has('mapping') || k.has('conversation_id')) return 'chatgpt';
  return null;
}
