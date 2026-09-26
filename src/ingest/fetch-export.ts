/**
 * Fetching an export archive from its manifest URL.
 *
 * Two safety properties matter here.
 *
 * 1. Export URLs are SINGLE USE. The bytes are written to disk the moment they
 *    arrive, before anything tries to parse them, so a later failure costs you a
 *    retry rather than the whole export.
 *
 * 2. The URLs come out of an uploaded file, which is untrusted input. Fetching
 *    them unchecked would let any uploaded JSON point the server at an arbitrary
 *    host. Only known export hosts are allowed.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Hosts an export may legitimately be served from. */
const ALLOWED_HOSTS = new Set(['claude.ai', 'www.claude.ai', 'chat.openai.com', 'chatgpt.com']);

export interface FetchedExport {
  url: string;
  savedTo: string;
  bytes: Uint8Array;
}

export class ExportFetchError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = 'ExportFetchError';
  }
}

export function assertAllowedHost(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ExportFetchError(`Not a valid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'https:') {
    throw new ExportFetchError(`Refusing a non-HTTPS export URL (${url.protocol}).`);
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new ExportFetchError(
      `Refusing to fetch from ${url.hostname}.`,
      'Export URLs must point at a known chat export host. This guard exists because the URL came from an uploaded file.',
    );
  }
  return url;
}

/**
 * Download an export archive and persist it before returning.
 *
 * @param dir where to keep the archive, so a single-use link is never spent twice
 */
export async function fetchExport(
  rawUrl: string,
  filename: string,
  dir: string,
): Promise<FetchedExport> {
  const url = assertAllowedHost(rawUrl);

  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (err) {
    throw new ExportFetchError(
      `Could not reach ${url.hostname}: ${err instanceof Error ? err.message : String(err)}`,
      'Check your connection. The export link has not been consumed if the request never completed.',
    );
  }

  if (!res.ok) {
    const auth = res.status === 401 || res.status === 403;
    throw new ExportFetchError(
      `${url.hostname} returned ${res.status} ${res.statusText}.`,
      auth
        ? 'These links are tied to your signed-in browser session, so the server cannot fetch them. Download the archive in your browser and upload the .zip instead.'
        : 'The link may already have been used — each export URL works only once. Request a fresh export if so.',
    );
  }

  const bytes = new Uint8Array(await res.arrayBuffer());

  // Persist before parsing. A single-use link must never be spent on an attempt
  // that then throws away the bytes.
  await mkdir(dir, { recursive: true });
  const savedTo = join(dir, filename);
  await writeFile(savedTo, bytes);

  return { url: url.toString(), savedTo, bytes };
}
