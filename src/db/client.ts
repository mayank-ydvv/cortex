/**
 * Postgres connection.
 *
 * Supabase note: DATABASE_URL must point at the session pooler (port 5432) or
 * the direct connection. The transaction pooler on 6543 does not support
 * prepared statements, which breaks both migrations and Drizzle's query
 * builder. `prepare: false` keeps things working if one is used anyway.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

let sqlClient: postgres.Sql | null = null;

export function getSql(): postgres.Sql {
  if (!sqlClient) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        'DATABASE_URL is not set. Copy .env.example to .env and add your Supabase ' +
          'session-pooler connection string (port 5432, not 6543).',
      );
    }
    sqlClient = postgres(url, { prepare: false, max: 4 });
  }
  return sqlClient;
}

export function getDb() {
  return drizzle(getSql(), { schema });
}

export async function closeDb(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end();
    sqlClient = null;
  }
}

/**
 * Run work as a specific signed-in user, with RLS enforced.
 *
 * This is the single most important function for multi-user safety, and the
 * reason is subtle: the app connects as `postgres`, which OWNS these tables and
 * therefore BYPASSES row level security entirely. Policies alone protect
 * nothing while that is true — they only stop the public PostgREST API.
 *
 * Inside this transaction the connection drops to the `authenticated` role and
 * publishes the user's id as the JWT subject, which is what `auth.uid()` reads.
 * From that point Postgres itself refuses to return another account's rows, so
 * a query that forgets its `WHERE user_id = …` returns nothing rather than
 * someone else's conversations. Application-level filtering is still applied on
 * top; this is the backstop for when that is wrong.
 *
 * Both settings are LOCAL, so they end with the transaction and can never leak
 * onto the next borrower of a pooled connection.
 */
export async function asUser<T>(
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  if (!userId) throw new Error('asUser called without a user id');

  // postgres-js unwraps arrays returned from begin(), which loses the caller's
  // type. Boxing the result keeps the generic honest.
  const boxed = await getSql().begin(async (tx) => {
    // auth.uid() reads request.jwt.claims ->> 'sub'.
    await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({
      sub: userId,
      role: 'authenticated',
    })}, true)`;
    await tx`SET LOCAL ROLE authenticated`;
    return [await fn(tx)] as [T];
  });
  return (boxed as unknown as [T])[0];
}
