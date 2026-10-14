import type postgres from 'postgres';

/**
 * Either a pooled connection or a transaction.
 *
 * Search runs inside asUser's transaction so row level security applies, but
 * the same functions are useful against a plain connection in scripts.
 */
export type Sql = postgres.Sql | postgres.TransactionSql;
