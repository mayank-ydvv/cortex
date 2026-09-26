/**
 * Ingest CLI.
 *
 * Stays a terminal command rather than moving into the web UI: embedding a
 * multi-year export is a long batch job, and putting it behind an HTTP route
 * would need job queuing and progress streaming that belong to a later phase.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { Command } from 'commander';
import { closeDb, getSql } from '../db/client';
import {
  embedPendingChunks,
  formatSummary,
  ingestConversations,
  type IngestSummary,
} from '../ingest/index';
import { inspectJson } from '../ingest/parsers/detect';
import { parseExport } from '../ingest/parsers/index';
import { readArchive } from '../ingest/archive';
import { manualProject, parseManual } from '../ingest/parsers/manual';
import type { ParsedConversation } from '../ingest/parsers/types';

const program = new Command()
  .name('ingest')
  .argument('<path>', 'file or directory to import')
  .option('-p, --project <name>', 'tag imported sources with a project')
  .option('--dry-run', 'report what would happen without writing or embedding')
  .option('--inspect', 'print the structure of a JSON export and exit')
  .parse();

const opts = program.opts();
const target = resolve(program.args[0]!);

const MARKDOWN = new Set(['.md', '.markdown', '.txt']);

async function collectFiles(path: string): Promise<string[]> {
  const info = await stat(path);
  if (info.isFile()) return [path];

  const entries = await readdir(path, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(path, e.name);
    if (e.isDirectory()) out.push(...(await collectFiles(full)));
    else if (MARKDOWN.has(extname(e.name).toLowerCase())) out.push(full);
  }
  return out.sort();
}

async function main() {
  const info = await stat(target);

  // A zip export: read the conversations file straight out of the archive.
  if (info.isFile() && extname(target).toLowerCase() === '.zip') {
    const archive = readArchive(new Uint8Array(await readFile(target)));
    if (!archive.conversations?.text) {
      console.log(`\nNo JSON found inside ${target}.`);
      console.log('Files in the archive:', archive.entries.map((e) => e.name).join(', '));
      return;
    }
    console.log(`\nReading ${archive.conversations.name} from ${target}`);
    await importJson(JSON.parse(archive.conversations.text), target);
    return;
  }

  if (info.isFile() && extname(target).toLowerCase() === '.json') {
    await importJson(JSON.parse(await readFile(target, 'utf8')), target);
    return;
  }

  await importNotes();
}

/** Import a parsed export, or report its structure if nothing recognises it. */
async function importJson(json: unknown, rawPath: string) {
  const recognised = parseExport(json);

  if (recognised) {
    console.log(
      `\nRecognised a ${recognised.origin} export: ${recognised.conversations.length} conversation(s).\n`,
    );
    const sql = getSql();
    const summary = await ingestConversations(sql, recognised.conversations, {
      origin: recognised.origin,
      rawPath,
      project: opts.project ?? null,
      dryRun: opts.dryRun,
      log: (l) => console.log(l),
    });

    if (opts.dryRun) {
      console.log(formatSummary(summary));
      console.log('\n(dry run - nothing was written and nothing was embedded)');
      return;
    }
    await embedPendingChunks(sql, summary, (l) => console.log(l));
    console.log(formatSummary(summary));
    return;
  }

  {
    const report = inspectJson(json);
    console.log(`\nInspecting ${rawPath}\n`);
    console.log(`  shape:           ${report.shape}`);
    console.log(`  top-level keys:  ${report.topLevelKeys.join(', ') || '(none)'}`);
    if (report.itemCount !== null) console.log(`  items:           ${report.itemCount}`);
    console.log(`  looks like:      ${report.origin ?? 'unrecognised'}`);
    console.log(
      '\nNo parser recognises this structure. Guessing it would produce a parser that\n' +
        'silently mangles timestamps, degrading every time-scoped query with no error.\n' +
        'Share the structure above and the parser gets written against it.\n',
    );
  }
}

/** Import markdown and text notes from a file or directory. */
async function importNotes() {
  const files = await collectFiles(target);
  if (files.length === 0) {
    console.log('No .md, .markdown or .txt files found.');
    return;
  }

  console.log(`\nIngesting ${files.length} file(s) from ${target}\n`);

  const conversations: ParsedConversation[] = [];
  const projects = new Map<string, string | null>();

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const info2 = await stat(file);
    conversations.push(parseManual({ text, path: file, mtime: info2.mtime }));
    projects.set(file, opts.project ?? manualProject(text));
  }

  const sql = getSql();
  let summary: IngestSummary;

  // Group by project so each import carries the right tag.
  const byProject = new Map<string | null, ParsedConversation[]>();
  for (const conv of conversations) {
    const p = projects.get(conv.externalId) ?? null;
    byProject.set(p, [...(byProject.get(p) ?? []), conv]);
  }

  const merged: IngestSummary = {
    sourcesInserted: 0, sourcesUpdated: 0, sourcesSkipped: 0, chunksCreated: 0,
    embeddingsReused: 0, embeddingsComputed: 0, timestampsInherited: 0,
    chunksAwaitingEmbedding: 0, errors: [],
  };

  for (const [project, convs] of byProject) {
    summary = await ingestConversations(sql, convs, {
      origin: 'manual',
      rawPath: target,
      project,
      dryRun: opts.dryRun,
      log: (l) => console.log(l),
    });
    merged.sourcesInserted += summary.sourcesInserted;
    merged.sourcesUpdated += summary.sourcesUpdated;
    merged.sourcesSkipped += summary.sourcesSkipped;
    merged.chunksCreated += summary.chunksCreated;
    merged.embeddingsReused += summary.embeddingsReused;
    merged.timestampsInherited += summary.timestampsInherited;
    merged.errors.push(...summary.errors);
  }

  if (opts.dryRun) {
    console.log(formatSummary(merged));
    console.log('\n(dry run - nothing was written and nothing was embedded)');
    return;
  }

  await embedPendingChunks(sql, merged, (l) => console.log(l));
  console.log(formatSummary(merged));
}

main()
  .catch((err) => {
    console.error('\nIngest failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
