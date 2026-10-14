import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Everything that needs an account. The landing page and auth pages do not. */
const PROTECTED = ['/ask', '/browse', '/status'];

/**
 * Refresh the session and gate the app routes.
 *
 * Two jobs. Supabase access tokens are short-lived, so the middleware refreshes
 * them on every request and writes the rotated cookies back; without that a
 * session silently expires mid-use. Second, it redirects signed-out visitors
 * away from the app before any page renders, so protection does not depend on
 * each page remembering to check.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // getUser, not getSession: this verifies the token rather than trusting the
  // cookie, and it is also what triggers the refresh.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const needsAuth = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));

  if (needsAuth && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Come back here after signing in.
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  if (path === '/login' && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/ask';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image files.
    '/((?!_next/static|_next/image|favicon.ico|scenes/|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico)$).*)',
  ],
};
