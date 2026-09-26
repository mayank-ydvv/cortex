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
  /**
   * Set when the file is a Claude export MANIFEST rather than the data itself.
   * Claude's export mails you a small JSON index listing download URLs for
   * several zips; the conversations live in one of those. Uploading the
   * manifest is an easy and very common mistake, so it gets named explicitly
   * instead of being reported as an unrecognised export.
   */
  manifest?: {
    files: { filename: string; category: string; url?: string }[];
    conversationsFile: string | null;
    singleUseUrls: boolean;
  };
}

/** True when the object is Claude's export manifest rather than export data. */
function asManifest(json: unknown): DetectionReport['manifest'] | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.data_files)) return null;

  const files = (o.data_files as Record<string, unknown>[])
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      filename: String(f.filename ?? '(unnamed)'),
      category: String(f.category ?? 'unknown'),
      // Only surfaced as a link after the host check below, never rendered raw.
      url: typeof f.export_url === 'string' ? f.export_url : undefined,
    }));
  if (files.length === 0) return null;

  const conversations =
    files.find((f) => f.category === 'conversations') ??
    files.find((f) => /conversation/i.test(f.filename));

  return {
    files,
    conversationsFile: conversations?.filename ?? null,
    singleUseUrls: typeof o.instructions === 'string' && /once/i.test(o.instructions),
  };
}

/** Describe a parsed JSON export without assuming a schema. */
export function inspectJson(json: unknown): DetectionReport {
  const manifest = asManifest(json);
  if (manifest) {
    return {
      origin: 'claude',
      shape: `Claude export manifest listing ${manifest.files.length} download(s)`,
      topLevelKeys: Object.keys(json as object),
      itemCount: manifest.files.length,
      manifest,
    };
  }

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
