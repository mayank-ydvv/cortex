/**
 * Migration runner.
 *
 * Applies drizzle/*.sql in filename order, once each, tracked in _migrations.
 * Deliberately minimal: the SQL is hand-authored because Drizzle Kit cannot emit
 * CREATE EXTENSION or a generated tsvector column cleanly, so there is nothing
 * for drizzle-kit to generate and no reason to run it.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeDb, getSql } from '../db/client';

const MIGRATIONS_DIR = new URL('../../drizzle/', import.meta.url).pathname;

async function main() {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM _migrations`).map((r) => r.name),
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file} (already applied)`);
      continue;
    }
    const ddl = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`  apply ${file} ... `);
    await sql.begin(async (tx) => {
      await tx.unsafe(ddl);
      await tx`INSERT INTO _migrations (name) VALUES (${file})`;
    });
    console.log('ok');
    ran += 1;
  }

  console.log(ran === 0 ? '\nNothing to apply; schema is current.' : `\nApplied ${ran} migration(s).`);

  const [ext] = await sql<{ extversion: string }[]>`
    SELECT extversion FROM pg_extension WHERE extname = 'vector'
  `;
  console.log(`pgvector: ${ext?.extversion ?? 'NOT INSTALLED'}`);

  const indexes = await sql<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename IN ('chunks', 'sources', 'memories')
    ORDER BY indexname
  `;
  console.log(`indexes:  ${indexes.map((i) => i.indexname).join(', ')}`);
}

main()
  .catch((err) => {
    console.error('\nMigration failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
