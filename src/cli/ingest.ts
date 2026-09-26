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

  // JSON: a Claude or ChatGPT export. Report its shape rather than guessing.
  if (info.isFile() && extname(target).toLowerCase() === '.json') {
    const report = inspectJson(JSON.parse(await readFile(target, 'utf8')));
    console.log(`\nInspecting ${target}\n`);
    console.log(`  shape:           ${report.shape}`);
    console.log(`  top-level keys:  ${report.topLevelKeys.join(', ') || '(none)'}`);
    if (report.itemCount !== null) console.log(`  items:           ${report.itemCount}`);
    console.log(`  looks like:      ${report.origin ?? 'unrecognised'}`);
    console.log(
      '\nThe Claude and ChatGPT parsers are not written yet, by design: guessing the\n' +
        'export shape produces a parser that silently mangles timestamps, which would\n' +
        'degrade every time-scoped query without any error. Share this file and the\n' +
        'parser gets written against it.\n',
    );
    return;
  }

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
