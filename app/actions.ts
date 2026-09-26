'use server';

import { revalidatePath } from 'next/cache';
import { getSql } from '../src/db/client';
import {
  embedPendingChunks,
  ingestConversations,
  type IngestSummary,
} from '../src/ingest/index';
import { inspectJson, type DetectionReport } from '../src/ingest/parsers/detect';
import { readArchive } from '../src/ingest/archive';
import { ExportFetchError, assertAllowedHost, fetchExport } from '../src/ingest/fetch-export';
import { manualProject, parseManual } from '../src/ingest/parsers/manual';
import type { ParsedConversation } from '../src/ingest/parsers/types';
import { getEmbeddingProvider } from '../src/ingest/embed';

export interface ImportedFile {
  name: string;
  status: 'imported' | 'skipped' | 'unsupported' | 'manifest' | 'error';
  message: string;
  /** Guidance shown under the message when a step failed recoverably. */
  hint?: string;
  /** Where a downloaded archive was saved, so a single-use link is never lost. */
  savedTo?: string;
  /** Files found inside an uploaded or fetched archive. */
  archive?: { name: string; bytes: number }[];
  /** Present when a JSON export could not be parsed: what the file actually contains. */
  report?: DetectionReport & { sampleKeys?: string[]; sample?: string };
}

export interface ImportResult {
  files: ImportedFile[];
  summary: IngestSummary | null;
  pendingEmbeddings: number;
}

const TEXT_EXT = /\.(md|markdown|txt)$/i;

/**
 * Import uploaded files.
 *
 * Chunks are inserted WITHOUT embeddings and this returns immediately. Embedding
 * runs separately, in batches, driven by the client. That keeps a multi-minute
 * job out of a single request without needing a queue: it reuses the nullable
 * embedding column that already makes ingest resumable.
 */
export async function importFiles(formData: FormData): Promise<ImportResult> {
  const uploads = formData.getAll('files').filter((f): f is File => f instanceof File);
  const project = (formData.get('project') as string | null)?.trim() || null;

  const files: ImportedFile[] = [];
  const conversations: ParsedConversation[] = [];
  const projects = new Map<string, string | null>();

  for (const file of uploads) {
    try {
      const text = await file.text();

      if (TEXT_EXT.test(file.name)) {
        const conv = parseManual({
          text,
          path: `upload://${file.name}`,
          mtime: new Date(file.lastModified),
        });
        conversations.push(conv);
        projects.set(conv.externalId, project ?? manualProject(text));
        files.push({ name: file.name, status: 'imported', message: 'queued for import' });
        continue;
      }

      if (file.name.toLowerCase().endsWith('.zip')) {
        const archive = readArchive(new Uint8Array(await file.arrayBuffer()));
        files.push(describeArchive(file.name, archive, 'uploaded archive'));
        continue;
      }

      if (file.name.toLowerCase().endsWith('.json')) {
        // Deliberately not parsed. Guessing an export's shape produces a parser
        // that silently mangles timestamps, which degrades every time-scoped
        // query with no error. Report the real structure instead.
        const json = JSON.parse(text);
        const report = inspectJson(json);

        // A manifest is an index of downloads, not the export itself. Saying
        // "unrecognised" here would send you hunting for a bug that is not there.
        if (report.manifest) {
          files.push(await handleManifest(file.name, json, report));
          continue;
        }

        const first = Array.isArray(json) ? json[0] : json;
        const sample =
          first && typeof first === 'object'
            ? JSON.stringify(first, null, 2).slice(0, 2400)
            : String(first).slice(0, 2400);

        files.push({
          name: file.name,
          status: 'unsupported',
          message: `Looks like: ${report.origin ?? 'an unrecognised export'}. No parser yet — structure shown below.`,
          report: { ...report, sample },
        });
        continue;
      }

      files.push({
        name: file.name,
        status: 'skipped',
        message: 'Unsupported file type. Use .md, .txt or a .json export.',
      });
    } catch (err) {
      files.push({
        name: file.name,
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let summary: IngestSummary | null = null;
  const sql = getSql();

  if (conversations.length > 0) {
    // Group by resolved project so each file keeps its own frontmatter tag.
    // The form's project field, when set, overrides frontmatter for every file.
    const byProject = new Map<string | null, ParsedConversation[]>();
    for (const conv of conversations) {
      const p = projects.get(conv.externalId) ?? null;
      byProject.set(p, [...(byProject.get(p) ?? []), conv]);
    }

    summary = {
      sourcesInserted: 0, sourcesUpdated: 0, sourcesSkipped: 0, chunksCreated: 0,
      embeddingsReused: 0, embeddingsComputed: 0, timestampsInherited: 0,
      chunksAwaitingEmbedding: 0, errors: [],
    };

    for (const [groupProject, convs] of byProject) {
      const part = await ingestConversations(sql, convs, {
        origin: 'manual',
        rawPath: 'upload://',
        project: groupProject,
      });
      summary.sourcesInserted += part.sourcesInserted;
      summary.sourcesUpdated += part.sourcesUpdated;
      summary.sourcesSkipped += part.sourcesSkipped;
      summary.chunksCreated += part.chunksCreated;
      summary.embeddingsReused += part.embeddingsReused;
      summary.timestampsInherited += part.timestampsInherited;
      summary.errors.push(...part.errors);
    }
  }

  const [pending] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM chunks WHERE embedding IS NULL
  `;

  revalidatePath('/status');
  revalidatePath('/browse');

  return { files, summary, pendingEmbeddings: Number(pending?.n ?? 0) };
}

export interface EmbedBatchResult {
  embedded: number;
  remaining: number;
}

/**
 * Embed one batch of pending chunks.
 *
 * Deliberately bounded rather than draining everything: the client calls this in
 * a loop so a long import shows real progress and no single request runs for
 * minutes. Safe to call at any time — it is the same sweep `pnpm ingest` runs.
 */
export async function embedBatch(size = 64): Promise<EmbedBatchResult> {
  const sql = getSql();

  const pending = await sql<{ id: number; content: string }[]>`
    SELECT id, content FROM chunks WHERE embedding IS NULL ORDER BY id LIMIT ${size}
  `;

  if (pending.length > 0) {
    const vectors = await getEmbeddingProvider().embedDocuments(pending.map((p) => p.content));
    await sql.begin(async (tx) => {
      for (const [i, row] of pending.entries()) {
        await tx`UPDATE chunks SET embedding = ${`[${vectors[i]!.join(',')}]`}::vector WHERE id = ${row.id}`;
      }
    });
  }

  const [left] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM chunks WHERE embedding IS NULL
  `;
  const remaining = Number(left?.n ?? 0);

  if (remaining === 0) {
    revalidatePath('/status');
    revalidatePath('/');
  }

  return { embedded: pending.length, remaining };
}

/** Re-export so the status page can trigger a full sweep from the CLI path too. */
export async function embedAll(): Promise<number> {
  const sql = getSql();
  const summary: IngestSummary = {
    sourcesInserted: 0, sourcesUpdated: 0, sourcesSkipped: 0, chunksCreated: 0,
    embeddingsReused: 0, embeddingsComputed: 0, timestampsInherited: 0,
    chunksAwaitingEmbedding: 0, errors: [],
  };
  await embedPendingChunks(sql, summary);
  revalidatePath('/status');
  return summary.embeddingsComputed;
}


/** Directory for downloaded archives. Kept so a single-use link is never spent twice. */
const EXPORT_DIR = '.exports';

/** Summarise an archive's contents and report the conversation file's structure. */
function describeArchive(
  name: string,
  archive: ReturnType<typeof readArchive>,
  origin: string,
  savedTo?: string,
): ImportedFile {
  const listing = archive.entries.map((e) => ({ name: e.name, bytes: e.bytes }));

  if (!archive.conversations?.text) {
    return {
      name,
      status: 'unsupported',
      message: `Opened the ${origin}, but found no JSON inside it.`,
      hint: 'If this is the light_metadata, design_chats or frames archive, the one you want is the conversations archive.',
      archive: listing,
      savedTo,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(archive.conversations.text);
  } catch (err) {
    return {
      name,
      status: 'error',
      message: `${archive.conversations.name} inside the ${origin} is not valid JSON.`,
      hint: err instanceof Error ? err.message : String(err),
      archive: listing,
      savedTo,
    };
  }

  const report = inspectJson(parsed);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const sample =
    first && typeof first === 'object'
      ? JSON.stringify(first, null, 2).slice(0, 3000)
      : String(first).slice(0, 3000);

  return {
    name,
    status: 'unsupported',
    message:
      `Opened ${archive.conversations.name} from the ${origin}. ` +
      'No parser for this format yet — its real structure is below.',
    hint: 'Paste the structure below into chat and the parser gets written against it.',
    archive: listing,
    savedTo,
    report: { ...report, sample },
  };
}

/**
 * Try to complete the export automatically from its manifest.
 *
 * Falls back to instructions rather than failing outright, because these links
 * are single use and may be tied to a browser session the server does not have.
 */
async function handleManifest(
  name: string,
  json: unknown,
  report: DetectionReport,
): Promise<ImportedFile> {
  const manifest = report.manifest!;
  const raw = json as { data_files?: { category?: string; filename?: string; export_url?: string }[] };

  const target =
    raw.data_files?.find((f) => f.category === 'conversations') ??
    raw.data_files?.find((f) => /conversation/i.test(String(f.filename ?? '')));

  if (!target?.export_url) {
    return {
      name,
      status: 'manifest',
      message: 'This manifest lists no conversations download.',
      report,
    };
  }

  try {
    const fetched = await fetchExport(
      target.export_url,
      target.filename ?? 'conversations.zip',
      EXPORT_DIR,
    );
    const archive = readArchive(fetched.bytes);
    const described = describeArchive(name, archive, 'downloaded archive', fetched.savedTo);
    return {
      ...described,
      message: `Downloaded ${target.filename} automatically. ${described.message}`,
    };
  } catch (err) {
    const fetchErr = err instanceof ExportFetchError ? err : null;

    // Automatic download is blocked, so hand back a direct link instead. Only
    // links that pass the host check are surfaced -- the URL came from an
    // uploaded file and must not be rendered unvetted.
    const vetted = report.manifest!.files.map((f) => {
      if (!f.url) return { ...f, url: undefined };
      try {
        assertAllowedHost(f.url);
        return f;
      } catch {
        return { ...f, url: undefined };
      }
    });

    return {
      name,
      status: 'manifest',
      message: fetchErr
        ? `Could not download automatically. ${fetchErr.message}`
        : `Could not download automatically: ${err instanceof Error ? err.message : String(err)}`,
      hint:
        fetchErr?.hint ??
        'Download the conversations archive in your browser and upload the .zip here instead.',
      report: { ...report, manifest: { ...report.manifest!, files: vetted } },
    };
  }
}
