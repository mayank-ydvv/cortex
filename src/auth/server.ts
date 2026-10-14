import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase client for server components and server actions.
 *
 * Sessions live in cookies rather than localStorage so a server component can
 * read them before rendering; that is the whole reason for @supabase/ssr.
 */
export async function createClient() {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) store.set(name, value, options);
          } catch {
            // Server components cannot set cookies. The middleware refreshes
            // the session on every request, so this is safe to ignore here.
          }
        },
      },
    },
  );
}

/**
 * The signed-in user, or null.
 *
 * Always getUser(), never getSession(). getSession reads the cookie without
 * verifying it, so a forged cookie would be trusted; getUser revalidates the
 * token against Supabase. Every ownership decision in this app keys off the id
 * this returns, so it has to be the verified one.
 */
export async function getUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

/** For code paths that cannot proceed without an account. */
export async function requireUser() {
  const user = await getUser();
  if (!user) throw new Error('Not signed in.');
  return user;
}
