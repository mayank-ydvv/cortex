'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../src/auth/server';

export interface AuthState {
  error: string | null;
  notice: string | null;
}

/** Shared shape so the form can report either outcome in one place. */
const fail = (error: string): AuthState => ({ error, notice: null });

function readForm(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/ask');
  // Only same-origin paths; an attacker-supplied absolute URL here would turn
  // the login form into an open redirect.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/ask';
  return { email, password, next: safeNext };
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password, next } = readForm(formData);
  if (!email || !password) return fail('Enter your email and password.');

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // Deliberately does not distinguish "no such account" from "wrong password",
  // which would let anyone test whether an email is registered here.
  if (error) return fail('That email and password do not match an account.');

  redirect(next);
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password, next } = readForm(formData);
  if (!email || !password) return fail('Enter an email and password.');
  if (password.length < 8) return fail('Use at least 8 characters.');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) return fail(error.message);

  // With email confirmation on, there is no session yet and the account is
  // unusable until the link is clicked. Saying so beats a silent no-op.
  if (!data.session) {
    return { error: null, notice: `Check ${email} for a confirmation link, then sign in.` };
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
