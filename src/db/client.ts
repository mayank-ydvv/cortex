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
import * as schema from './schema.js';

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
