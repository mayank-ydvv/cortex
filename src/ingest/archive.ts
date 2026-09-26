/**
 * Zip handling for chat exports.
 *
 * Claude's export is delivered as several zips; the conversations live in one of
 * them. Rather than making you unzip and hunt for the right file, the importer
 * reads the archive directly and picks out the JSON.
 */
import { unzipSync } from 'fflate';

export interface ArchiveEntry {
  name: string;
  bytes: number;
  /** Decoded text, only for entries that look like JSON. */
  text?: string;
}

export interface ArchiveContents {
  entries: ArchiveEntry[];
  /** The entry most likely to hold the conversations, if one stands out. */
  conversations: ArchiveEntry | null;
}

/** Ignore macOS resource forks and directory markers. */
function isNoise(name: string): boolean {
  return name.startsWith('__MACOSX/') || name.endsWith('/') || name.split('/').pop()!.startsWith('.');
}

/**
 * Read a zip and decode its JSON entries.
 *
 * Selection is by name first (an entry actually called "conversations"), then by
 * size, because an export's conversation file is almost always the largest JSON
 * in the archive. Both are heuristics about WHICH FILE to read, never about what
 * is inside it -- the contents are still reported rather than parsed blind.
 */
export function readArchive(data: Uint8Array): ArchiveContents {
  const unzipped = unzipSync(data);
  const decoder = new TextDecoder();

  const entries: ArchiveEntry[] = Object.entries(unzipped)
    .filter(([name]) => !isNoise(name))
    .map(([name, bytes]) => {
      const entry: ArchiveEntry = { name, bytes: bytes.length };
      if (/\.(json|jsonl)$/i.test(name)) entry.text = decoder.decode(bytes);
      return entry;
    })
    .sort((a, b) => b.bytes - a.bytes);

  const json = entries.filter((e) => e.text !== undefined);
  const byName = json.find((e) => /conversation/i.test(e.name));

  return { entries, conversations: byName ?? json[0] ?? null };
}
