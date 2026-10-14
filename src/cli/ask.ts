/**
 * Ask from the terminal.
 *
 * The same grounded answering the chat page uses, without the browser. Useful
 * for checking an answer quickly, and for seeing the raw source list that the
 * UI keeps collapsed.
 */
import { Command } from 'commander';
import { answerQuestion } from '../answer/index';
import { closeDb } from '../db/client';

const program = new Command()
  .name('ask')
  .argument('<question...>', 'what to ask of your own history')
  .option('-s, --sources', 'list every source the answer was built from')
  .option('--now <iso>', 'treat this instant as now, for reproducing a past answer')
  .parse();

const opts = program.opts();
const question = program.args.join(' ');

const fmt = (d: Date) =>
  d.toLocaleDateString('en-GB', { dateStyle: 'medium' });

try {
  const t0 = Date.now();
  const r = await answerQuestion(question, {
    now: opts.now ? new Date(opts.now) : undefined,
  });

  console.log();
  if (r.answer) {
    console.log(r.answer);
  } else {
    console.log(`(no answer) ${r.unavailable?.message ?? ''}`);
    if (r.unavailable?.hint) console.log(`  ${r.unavailable.hint}`);
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const range = r.explain.range
    ? ` · ${fmt(r.explain.range.from)}–${fmt(r.explain.range.to)}`
    : '';
  console.log(`\n${secs}s · ${r.sources.length} sources${range}${r.model ? ` · ${r.model}` : ''}`);

  if (opts.sources) {
    console.log();
    r.sources.forEach((s, i) => {
      console.log(`[${i + 1}] ${s.sourceTitle ?? 'untitled'} — ${fmt(s.occurredAt)} (${s.origin})`);
      console.log(`    ${s.content.replace(/\s+/g, ' ').slice(0, 150)}…`);
    });
  }

  for (const w of r.explain.warnings) console.warn(`\n!  ${w}`);
} catch (err) {
  console.error('\nFailed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
