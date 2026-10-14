'use client';

import { useActionState, useState } from 'react';
import { signIn, signUp, type AuthState } from './actions';
import { AlertIcon } from '../_components/icons';

const EMPTY: AuthState = { error: null, notice: null };

export function AuthForm({ next }: { next: string }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const action = mode === 'in' ? signIn : signUp;
  const [state, formAction, pending] = useActionState(action, EMPTY);

  return (
    <form action={formAction} className="auth-form">
      <input type="hidden" name="next" value={next} />

      <label className="auth-field">
        <span>email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          disabled={pending}
          placeholder="you@example.com"
        />
      </label>

      <label className="auth-field">
        <span>password</span>
        <input
          type="password"
          name="password"
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'up' ? 8 : undefined}
          disabled={pending}
          placeholder={mode === 'up' ? 'at least 8 characters' : ''}
        />
      </label>

      {state.error && (
        <div className="notice notice-danger">
          <span className="notice-icon"><AlertIcon /></span>
          <div className="notice-body"><p>{state.error}</p></div>
        </div>
      )}
      {state.notice && (
        <div className="notice notice-warn">
          <span className="notice-icon"><AlertIcon /></span>
          <div className="notice-body"><p>{state.notice}</p></div>
        </div>
      )}

      <button className="pill auth-submit" type="submit" disabled={pending}>
        {pending ? 'one moment…' : mode === 'in' ? 'sign in' : 'create account'}
      </button>

      <button
        type="button"
        className="auth-switch"
        onClick={() => setMode((m) => (m === 'in' ? 'up' : 'in'))}
        disabled={pending}
      >
        {mode === 'in' ? 'No account yet? Create one' : 'Already have one? Sign in'}
      </button>
    </form>
  );
}
