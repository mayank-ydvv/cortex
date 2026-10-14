import { getSql } from '../db/client';

/**
 * Resolve which account a CLI command acts on.
 *
 * The CLIs have no session, so the account must be stated explicitly: either
 * `--as you@example.com` or CORTEX_USER in the environment. Defaulting to "the
 * only user" would quietly do the wrong thing the moment a second account
 * exists, and these commands write data.
 *
 * This runs on the owner connection, which bypasses RLS by design -- it is an
 * operator tool. Everything user-facing goes through asUser instead.
 */
export async function resolveUserId(emailArg?: string): Promise<string> {
  const email = (emailArg ?? process.env.CORTEX_USER ?? '').trim().toLowerCase();

  if (!email) {
    const [count] = await getSql()<{ n: string }[]>`SELECT count(*)::text AS n FROM auth.users`;
    throw new Error(
      'No account specified. Pass --as you@example.com, or set CORTEX_USER.\n' +
        `  (${count?.n ?? '0'} account(s) exist; sign up at /login if you have none.)`,
    );
  }

  const [row] = await getSql()<{ id: string }[]>`
    SELECT id::text FROM auth.users WHERE lower(email) = ${email} LIMIT 1
  `;
  if (!row) throw new Error(`No account with email ${email}. Sign up at /login first.`);
  return row.id;
}
