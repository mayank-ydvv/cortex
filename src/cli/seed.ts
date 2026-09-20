/**
 * Dev fixtures.
 *
 * Seeds a small synthetic corpus built around the exact failure this system
 * exists to prevent: an auth decision from LAST WEEK and a different, conflicting
 * auth decision from MARCH. A naive vector search returns the March thread with
 * total confidence. Correct retrieval must not.
 *
 * This lets the core requirement be proven before any real export is imported.
 */
import { createHash } from 'node:crypto';
import { closeDb, getSql } from '../db/client.js';
import { getEmbeddingProvider } from '../ingest/embed.js';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Days before now. */
  daysAgo: number;
}

interface Fixture {
  externalId: string;
  origin: 'claude' | 'chatgpt' | 'manual';
  title: string;
  project: string;
  turns: Turn[];
}

const DAY = 24 * 60 * 60 * 1000;

const FIXTURES: Fixture[] = [
  {
    externalId: 'fx-auth-march',
    origin: 'claude',
    title: 'Auth architecture review',
    project: 'api',
    turns: [
      { role: 'user', daysAgo: 192, content: 'How should we handle authentication for the API?' },
      {
        role: 'assistant',
        daysAgo: 192,
        content:
          'We decided to use long-lived session cookies backed by a server-side session store in Redis. ' +
          'Sessions last 30 days and are revoked on logout. This keeps the client simple and lets us ' +
          'invalidate sessions centrally.',
      },
    ],
  },
  {
    externalId: 'fx-auth-lastweek',
    origin: 'claude',
    title: 'API redesign',
    project: 'api',
    turns: [
      { role: 'user', daysAgo: 3, content: 'Revisiting auth — the session store is becoming a bottleneck.' },
      {
        role: 'assistant',
        daysAgo: 3,
        content:
          'We decided to drop session cookies entirely and move to short-lived JWTs, fifteen minute expiry, ' +
          'with refresh tokens held server-side. This removes the Redis dependency from the hot path and ' +
          'supersedes the session-cookie approach agreed in March.',
      },
    ],
  },
  {
    externalId: 'fx-auth-thursday',
    origin: 'manual',
    title: 'auth notes',
    project: 'api',
    turns: [
      {
        role: 'user',
        daysAgo: 3,
        content:
          'Follow-up on the JWT decision: refresh token rotation is on, reuse detection revokes the family.',
      },
    ],
  },
  {
    externalId: 'fx-pgvector',
    origin: 'chatgpt',
    title: 'Vector index tuning',
    project: 'memory',
    turns: [
      { role: 'user', daysAgo: 20, content: 'Why is my filtered vector search returning too few rows?' },
      {
        role: 'assistant',
        daysAgo: 20,
        content:
          'Because HNSW post-filters. Set hnsw.iterative_scan to relaxed_order in pgvector 0.8.0 or later, ' +
          'and raise hnsw.ef_search. The pgvector extension defaults iterative_scan to off.',
      },
    ],
  },
  {
    externalId: 'fx-css',
    origin: 'claude',
    title: 'Pricing page layout',
    project: 'web',
    turns: [
      { role: 'user', daysAgo: 5, content: 'The pricing cards are misaligned on mobile.' },
      {
        role: 'assistant',
        daysAgo: 5,
        content: 'Switch the grid to auto-fit minmax and drop the fixed column widths below 640px.',
      },
    ],
  },
  {
    externalId: 'fx-deps',
    origin: 'claude',
    title: 'Dependency audit',
    project: 'api',
    turns: [
      {
        role: 'assistant',
        daysAgo: 40,
        content:
          'We talked broadly about reducing dependencies and avoiding packages that duplicate what the ' +
          'standard library already provides. Nothing was removed yet.',
      },
      {
        role: 'assistant',
        daysAgo: 39,
        content: 'Removed the date-fns-tz shim and pinned drizzle-orm to 0.45.2 to stop the lockfile churn.',
      },
    ],
  },
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function main() {
  const sql = getSql();
  const embedder = getEmbeddingProvider();
  const now = Date.now();

  console.log('Clearing existing fixtures...');
  await sql`DELETE FROM sources WHERE external_id LIKE 'fx-%'`;

  let chunkCount = 0;

  for (const fx of FIXTURES) {
    const startedAt = new Date(now - Math.max(...fx.turns.map((t) => t.daysAgo)) * DAY);
    const body = JSON.stringify(fx);

    const [source] = await sql<{ id: number }[]>`
      INSERT INTO sources (origin, external_id, title, project, started_at, raw_path, content_hash)
      VALUES (${fx.origin}, ${fx.externalId}, ${fx.title}, ${fx.project},
              ${startedAt}, ${'fixtures://' + fx.externalId}, ${sha(body)})
      RETURNING id
    `;

    const texts = fx.turns.map((t) => t.content);
    const vectors = await embedder.embedDocuments(texts);

    for (const [i, turn] of fx.turns.entries()) {
      const occurredAt = new Date(now - turn.daysAgo * DAY);
      await sql`
        INSERT INTO chunks (source_id, content, embedding, position, role, occurred_at, content_hash)
        VALUES (${source!.id}, ${turn.content}, ${`[${vectors[i]!.join(',')}]`}::vector,
                ${i}, ${turn.role}, ${occurredAt}, ${sha(turn.content)})
      `;
      chunkCount += 1;
    }

    const days = fx.turns.map((t) => t.daysAgo).join(', ');
    console.log(`  ${fx.externalId.padEnd(20)} ${fx.turns.length} chunks  (${days} days ago)`);
  }

  console.log(`\nSeeded ${FIXTURES.length} sources, ${chunkCount} chunks.`);
  console.log('\nTry:  pnpm search "what did we decide about auth last week?" --explain');
}

main()
  .catch((err) => {
    console.error('\nSeed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
