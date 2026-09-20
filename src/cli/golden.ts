/**
 * Golden set runner.
 *
 * Reports precision@5 and recall@5 overall AND split by category. The split is
 * the point: an aggregate score comfortably hides the case where every
 * time-scoped query has started failing while conceptual ones still pass.
 *
 * Each entry may pin its own `now`. Without that, a query saying "last week"
 * resolves to a different window on every run and the expected ids rot within
 * days -- the runner would then report regressions that are really just the
 * calendar moving.
 */
import { readFile } from 'node:fs/promises';
import { closeDb } from '../db/client.js';
import { search } from '../search/index.js';

interface GoldenEntry {
  id: string;
  query: string;
  category: string;
  now?: string;
  expected_source_ids: number[];
  notes?: string;
}

const AT = 5;

interface Scored {
  entry: GoldenEntry;
  precision: number;
  recall: number;
  returned: number[];
  skipped: boolean;
}

function scoreOne(expected: number[], returned: number[]): { precision: number; recall: number } {
  const top = returned.slice(0, AT);
  const expectedSet = new Set(expected);
  const hits = top.filter((id) => expectedSet.has(id)).length;
  return {
    precision: top.length === 0 ? 0 : hits / top.length,
    recall: expected.length === 0 ? 0 : hits / expected.length,
  };
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(4);

async function main() {
  const path = new URL('../../tests/golden.json', import.meta.url).pathname;
  const entries: GoldenEntry[] = JSON.parse(await readFile(path, 'utf8'));

  const results: Scored[] = [];

  for (const entry of entries) {
    // Results are chunks; scoring is per SOURCE, so map and dedupe first.
    const { hits } = await search(entry.query, {
      limit: AT,
      now: entry.now ? new Date(entry.now) : undefined,
    });
    const returned = [...new Set(hits.map((h) => h.sourceId))];

    // An entry with no expected ids yet is unscoreable, not a failure.
    const skipped = entry.expected_source_ids.length === 0;
    const { precision, recall } = skipped
      ? { precision: 0, recall: 0 }
      : scoreOne(entry.expected_source_ids, returned);

    results.push({ entry, precision, recall, returned, skipped });
  }

  console.log('\nGolden set\n');
  for (const r of results) {
    const status = r.skipped ? '  --  (no expected ids yet)' : `  P@5 ${pct(r.precision)}   R@5 ${pct(r.recall)}`;
    console.log(`  ${r.entry.id.padEnd(4)} ${r.entry.category.padEnd(13)} ${status}`);
    console.log(`       "${r.entry.query}"`);
    console.log(`       returned sources: [${r.returned.join(', ') || 'none'}]`);
    if (r.entry.notes) console.log(`       ${r.entry.notes}`);
    console.log();
  }

  const scored = results.filter((r) => !r.skipped);
  if (scored.length === 0) {
    console.log('Nothing scored yet. Fill in expected_source_ids in tests/golden.json.\n');
    console.log('Tip: run a query, note the source ids you know are correct, and paste them in.');
    return;
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  console.log('By category');
  const categories = [...new Set(scored.map((r) => r.entry.category))].sort();
  for (const c of categories) {
    const inC = scored.filter((r) => r.entry.category === c);
    console.log(
      `  ${c.padEnd(13)} P@5 ${pct(mean(inC.map((r) => r.precision)))}   ` +
        `R@5 ${pct(mean(inC.map((r) => r.recall)))}   (${inC.length} queries)`,
    );
  }

  console.log('\nOverall');
  console.log(
    `  ${'all'.padEnd(13)} P@5 ${pct(mean(scored.map((r) => r.precision)))}   ` +
      `R@5 ${pct(mean(scored.map((r) => r.recall)))}   (${scored.length} queries)`,
  );

  // Fail the run if any category is entirely broken, which the mean alone hides.
  const broken = categories.filter(
    (c) => mean(scored.filter((r) => r.entry.category === c).map((r) => r.recall)) === 0,
  );
  if (broken.length > 0) {
    console.log(`\nFAIL: zero recall in category: ${broken.join(', ')}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('\nGolden run failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
