import { answerQuestion } from './src/answer/index';
import { closeDb } from './src/db/client';
async function main() {
  for (const q of process.argv.slice(2)) {
    console.log('\n' + '═'.repeat(68));
    console.log('Q:', q);
    console.log('═'.repeat(68));
    const t0 = Date.now();
    const r = await answerQuestion(q);
    console.log(r.answer ?? `[no answer] ${r.unavailable?.message}\n   ${r.unavailable?.hint ?? ''}`);
    console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s · ${r.sources.length} sources)`);
    r.sources.slice(0, 3).forEach((s, i) =>
      console.log(`  [${i + 1}] ${s.sourceTitle ?? 'untitled'} — ${s.occurredAt.toISOString().slice(0, 10)}`));
  }
  await closeDb();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
