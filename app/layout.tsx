import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cortex — you already said it',
  description: 'A notebook that remembers your conversations, so you do not have to.',
};

/** Root holds only the document. Chrome belongs to each route group. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
