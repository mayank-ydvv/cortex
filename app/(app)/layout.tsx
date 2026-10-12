import Link from 'next/link';
import { BrandMark } from '../_components/art';
import { NavLink } from '../_components/nav-link';

/** Chrome for the working app. The landing has its own, deliberately minimal. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
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
        </div>
      </header>
      <main className="shell app-main">{children}</main>
    </>
  );
}
