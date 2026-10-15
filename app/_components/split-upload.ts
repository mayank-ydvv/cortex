/**
 * Split uploads to fit a hosted request limit.
 *
 * Vercel caps a request body at ~4.5MB no matter what the server action allows,
 * and a real chat export is routinely several times that. So large exports are
 * opened in the browser and re-sent as several smaller, still-valid exports:
 * a conversations array is cut into slices, each a complete JSON array. The
 * server sees ordinary exports and needs no special path.
 *
 * Only arrays are split. A manifest is tiny, and any other JSON shape is sent
 * whole so the server can report its real structure instead of a fragment.
 */
import { unzipSync, strFromU8 } from 'fflate';

/** Stay well under the platform limit; multipart overhead is small but real. */
export const MAX_REQUEST_BYTES = 3.5 * 1024 * 1024;

const isNoise = (name: string) =>
  name.startsWith('__MACOSX/') || name.endsWith('/') || name.split('/').pop()!.startsWith('.');

/** Cut a JSON array into files that each serialise under the byte budget. */
function sliceArray(items: unknown[], baseName: string, lastModified: number): File[] {
  const out: File[] = [];
  let batch: string[] = [];
  let size = 2;

  const flush = () => {
    if (batch.length === 0) return;
    const name = `${baseName} (part ${out.length + 1}).json`;
    out.push(new File([`[${batch.join(',')}]`], name, { type: 'application/json', lastModified }));
    batch = [];
    size = 2;
  };

  for (const item of items) {
    const s = JSON.stringify(item);
    const bytes = new Blob([s]).size + 1;
    if (size + bytes > MAX_REQUEST_BYTES) flush();
    // A single item over budget goes alone; the server reports it if it fails.
    batch.push(s);
    size += bytes;
  }
  flush();
  return out;
}

/** The JSON text inside an archive most likely to hold conversations. */
function conversationsFromZip(bytes: Uint8Array): { name: string; text: string } | null {
  const entries = unzipSync(bytes, { filter: (f) => !isNoise(f.name) && f.name.endsWith('.json') });
  const names = Object.keys(entries);
  if (names.length === 0) return null;
  const pick =
    names.find((n) => /(^|\/)conversations\.json$/i.test(n)) ??
    names.sort((a, b) => entries[b]!.length - entries[a]!.length)[0]!;
  return { name: pick, text: strFromU8(entries[pick]!) };
}

/**
 * Turn the chosen files into upload-ready files, splitting any large export.
 * Throws a readable error for a large file that cannot be split.
 */
export async function prepareUploads(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    if (file.size <= MAX_REQUEST_BYTES) {
      out.push(file);
      continue;
    }

    const lower = file.name.toLowerCase();
    let text: string | null = null;
    let base = file.name.replace(/\.(json|zip)$/i, '');

    if (lower.endsWith('.json')) {
      text = await file.text();
    } else if (lower.endsWith('.zip')) {
      const found = conversationsFromZip(new Uint8Array(await file.arrayBuffer()));
      if (!found) throw new Error(`${file.name}: no JSON found inside the archive.`);
      text = found.text;
      base = `${base} ${found.name.split('/').pop()!.replace(/\.json$/i, '')}`;
      if (new Blob([text]).size <= MAX_REQUEST_BYTES) {
        out.push(new File([text], `${base}.json`, { type: 'application/json', lastModified: file.lastModified }));
        continue;
      }
    } else {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      throw new Error(
        `${file.name} is ${mb}MB; files other than chat exports must be under ${MAX_REQUEST_BYTES / 1024 / 1024}MB.`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${file.name} is not valid JSON.`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`${file.name} is too large to upload and is not a list of conversations, so it cannot be split.`);
    }
    out.push(...sliceArray(parsed, base, file.lastModified));
  }
  return out;
}

/** Group files into requests that each stay under the byte budget. */
export function batchBySize(files: File[]): File[][] {
  const batches: File[][] = [];
  let current: File[] = [];
  let size = 0;
  for (const f of files) {
    if (current.length > 0 && size + f.size > MAX_REQUEST_BYTES) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(f);
    size += f.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
