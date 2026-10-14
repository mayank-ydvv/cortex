/**
 * Search CLI.
 *
 * The web UI is the primary surface, but this stays: it is how retrieval gets
 * verified without a UI in the way, and it is what the golden-set runner drives.
 */
import { Command } from 'commander';
import { closeDb } from '../db/client';
import { resolveUserId } from '../auth/cli-user';
import { search, type SearchExplain, type SearchHit } from '../search/index';

const program = new Command()
  .name('search')
  .argument('<query>', 'what to search for')
  .option('-n, --limit <n>', 'results to return', (v) => Number.parseInt(v, 10), 10)
  .option('-p, --project <name>', 'restrict to a project')
  .option('--from <iso>', 'override the parsed range start')
  .option('--to <iso>', 'override the parsed range end')
  .option('--now <iso>', 'treat this instant as now (for reproducing a past search)')
  .option('-x, --explain', 'show the date range, both ranked lists and the fusion')
  .option('--as <email>', 'account to search (or set CORTEX_USER)')
  .parse();

const opts = program.opts();
const query = program.args[0]!;

const date = (v: string | undefined) => (v ? new Date(v) : undefined);
const fmt = (d: Date) =>
  d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

function printExplain(e: SearchExplain) {
  console.log('\n── explain ──');
  console.log(`query:        ${e.query}`);
  console.log(`embedded:     ${e.cleanedText}${e.cleanedText !== e.query ? '   <- time phrase stripped' : ''}`);

  if (e.range) {
    const tag = e.rangeSource === 'override' ? 'override' : `parsed "${e.timeExpression}"`;
    console.log(`date filter:  ${fmt(e.range.from)}  ->  ${fmt(e.range.to)}   (${tag})`);
  } else {
    console.log('date filter:  none');
  }
  if (e.project) console.log(`project:      ${e.project}`);
  console.log(`depth:        ${e.candidateDepth} per leg, k=${e.k}`);

  const rows = Math.max(e.vector.length, e.keyword.length, Math.min(e.fused.length, 10));
  console.log('\n  #   vector leg         keyword leg        fused');
  console.log('  ──  ─────────────────  ─────────────────  ─────────────────');
  for (let i = 0; i < Math.min(rows, 10); i += 1) {
    const v = e.vector[i];
    const kw = e.keyword[i];
    const f = e.fused[i];
    const vs = v ? `c${v.chunkId} (d=${v.score.toFixed(3)})`.padEnd(17) : ''.padEnd(17);
    const ks = kw ? `c${kw.chunkId} (r=${kw.score.toFixed(3)})`.padEnd(17) : ''.padEnd(17);
    const fs = f ? `c${f.chunkId} (${f.score.toFixed(5)})` : '';
    console.log(`  ${String(i + 1).padStart(2)}  ${vs}  ${ks}  ${fs}`);
  }
}

function printHits(hits: SearchHit[]) {
  if (hits.length === 0) {
    console.log('\nNo results.');
    return;
  }
  console.log();
  hits.forEach((h, i) => {
    const ranks = [
      h.vectorRank !== null ? `vec#${h.vectorRank}` : 'vec—',
      h.keywordRank !== null ? `kw#${h.keywordRank}` : 'kw—',
    ].join('  ');

    console.log(
      `${String(i + 1).padStart(2)}. [${h.origin}] ${h.sourceTitle ?? '(untitled)'} — ${fmt(h.occurredAt)}`,
    );
    console.log(`    ${ranks}   rrf ${h.fusedScore.toFixed(5)}   ${h.role}   source #${h.sourceId}`);
    const text = h.content.length > 320 ? `${h.content.slice(0, 320)}…` : h.content;
    console.log(`    ${text.replace(/\n/g, '\n    ')}\n`);
  });
}

try {
  const userId = await resolveUserId(opts.as);
  const { hits, explain } = await search(query, {
    userId,
    limit: opts.limit,
    project: opts.project ?? null,
    from: date(opts.from),
    to: date(opts.to),
    now: date(opts.now),
  });

  if (opts.explain) printExplain(explain);
  printHits(hits);

  for (const w of explain.warnings) console.warn(`⚠  ${w}`);
} catch (err) {
  console.error('\nSearch failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
