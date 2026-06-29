'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Mode = 'signin' | 'signup' | 'verify';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function extractMessage(err: unknown): string {
    if (!err) return '';
    if (typeof err === 'string') return err;
    if (typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string') {
      return (err as any).message;
    }
    return 'Something went wrong. Please try again.';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const supabase = createClient();

      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/integrations`,
          },
        });
        if (error) setError(extractMessage(error));
        else setMode('verify');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setError(extractMessage(error));
        else { router.push('/integrations'); router.refresh(); }
      }
    } catch (err) {
      setError(extractMessage(err));
    }

    setLoading(false);
  }

  if (mode === 'verify') {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm text-center" style={{ color: '#111827' }}>
        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 text-xl">✉</div>
        <p className="text-sm font-semibold" style={{ color: '#111827' }}>Check your email</p>
        <p className="text-sm mt-1" style={{ color: '#6b7280' }}>
          We sent a verification link to <strong style={{ color: '#111827' }}>{email}</strong>.<br />
          Click it to activate your account.
        </p>
        <button
          onClick={() => setMode('signin')}
          className="mt-6 text-xs hover:underline"
          style={{ color: '#6b7280' }}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div
      className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm"
      style={{ color: '#111827' }}
    >
      <div className="mb-8">
        <span className="text-lg font-bold tracking-tight" style={{ color: '#111827' }}>
          Incident Platform
        </span>
        <p className="text-sm mt-0.5" style={{ color: '#6b7280' }}>
          AI-powered incident investigation
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@company.com"
            style={{ color: '#111827', backgroundColor: '#ffffff' }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>
            Password
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            style={{ color: '#111827', backgroundColor: '#ffffff' }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
          />
        </div>

        {error ? (
          <p className="text-sm" style={{ color: '#dc2626' }}>{String(error)}</p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#111827', color: '#ffffff' }}
        >
          {loading
            ? (mode === 'signup' ? 'Creating account…' : 'Signing in…')
            : (mode === 'signup' ? 'Create account' : 'Sign in')}
        </button>
      </form>

      <p className="text-xs text-center mt-6" style={{ color: '#9ca3af' }}>
        {mode === 'signin' ? (
          <>No account?{' '}
            <button
              onClick={() => { setMode('signup'); setError(''); }}
              className="font-medium hover:underline"
              style={{ color: '#374151' }}
            >
              Sign up
            </button>
          </>
        ) : (
          <>Already have an account?{' '}
            <button
              onClick={() => { setMode('signin'); setError(''); }}
              className="font-medium hover:underline"
              style={{ color: '#374151' }}
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  );
}
