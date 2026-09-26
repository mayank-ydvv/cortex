'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Marks the active route so the current page is identifiable without colour alone. */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  );
}
