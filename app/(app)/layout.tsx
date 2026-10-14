import Link from 'next/link';
import { BrandMark } from '../_components/art';
import { NavLink } from '../_components/nav-link';
import { getUser } from '../../src/auth/server';
import { signOut } from '../login/actions';

/** Chrome for the working app. The landing has its own, deliberately minimal. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The middleware already redirects signed-out visitors; this is only to show
  // who is signed in.
  const user = await getUser();

  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <Link href="/" className="brand" aria-label="Cortex, home">
            <BrandMark />
            <span className="brand-word">cortex</span>
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink href="/ask">ask</NavLink>
            <NavLink href="/browse">browse</NavLink>
            <NavLink href="/status">status</NavLink>
          </nav>
          {user && (
            <form action={signOut} className="signout-form">
              <span className="signed-as" title={user.email ?? ''}>{user.email}</span>
              <button type="submit" className="tag">sign out</button>
            </form>
          )}
        </div>
      </header>
      <main className="shell app-main">{children}</main>
    </>
  );
}
