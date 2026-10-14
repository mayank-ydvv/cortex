import Link from 'next/link';
import { BrandMark, Sticker } from '../_components/art';
import { AuthForm } from './auth-form';

export const metadata = { title: 'Cortex — sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="auth-page">
      <header className="land-head">
        <Link href="/" aria-label="Cortex, home" className="land-brand">
          <BrandMark />
        </Link>
      </header>

      <main className="auth-main">
        <div className="auth-art" aria-hidden>
          <Sticker kind="bolt" rotate={-12} />
          <Sticker kind="blob" rotate={9} />
          <Sticker kind="heart" rotate={-6} />
        </div>

        <p className="caption-hand">Welcome back,</p>
        <h1 className="display auth-title">your notebook</h1>
        <p className="lede auth-lede">
          Sign in to search what you&rsquo;ve already said.
        </p>

        <AuthForm next={next ?? '/ask'} />

        <p className="fineprint auth-note">
          Your conversations are yours alone. Every row is locked to your
          account by the database itself, not just by this app.
        </p>
      </main>
    </div>
  );
}
