import type { Metadata } from 'next';
import { NavLink } from './_components/nav-link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Memory Engine',
  description: 'Personal memory search over AI chat history and notes.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="shell topbar-inner">
            <span className="brand">
              <span className="brand-dot" aria-hidden />
              memory-engine
            </span>
            <nav className="nav" aria-label="Main">
              <NavLink href="/">search</NavLink>
              <NavLink href="/browse">browse</NavLink>
              <NavLink href="/status">status</NavLink>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
