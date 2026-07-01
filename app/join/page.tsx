'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import api from '@/lib/api';

type Status = 'checking' | 'signed-out' | 'accepting' | 'accepted' | 'error';

export default function JoinPage() {
  const [status, setStatus] = useState<Status>('checking');
  const [orgName, setOrgName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    setToken(t);

    if (!t) {
      setStatus('error');
      setErrorMessage('This invite link is missing a token.');
      return;
    }

    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setStatus('signed-out');
        return;
      }

      setStatus('accepting');
      try {
        const { data } = await api.post('/api/organizations/invite/accept', { token: t });
        setOrgName(data.orgName ?? null);
        setStatus('accepted');
      } catch (err: any) {
        setStatus('error');
        setErrorMessage(err?.response?.data?.message ?? 'This invite could not be accepted.');
      }
    })();
  }, []);

  return (
    <div
      className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm text-center"
      style={{ color: '#111827' }}
    >
      {status === 'checking' || status === 'accepting' ? (
        <p className="text-sm" style={{ color: '#6b7280' }}>Loading…</p>
      ) : null}

      {status === 'signed-out' && token ? (
        <>
          <p className="text-sm font-semibold" style={{ color: '#111827' }}>You've been invited</p>
          <p className="text-sm mt-1" style={{ color: '#6b7280' }}>
            Sign in with your work email to accept this invite.
          </p>
          <Link
            href={`/login?next=${encodeURIComponent(`/join?token=${token}`)}`}
            className="inline-block mt-6 rounded-lg px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: '#111827', color: '#ffffff' }}
          >
            Sign in to accept
          </Link>
        </>
      ) : null}

      {status === 'accepted' ? (
        <>
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 text-xl">✓</div>
          <p className="text-sm font-semibold" style={{ color: '#111827' }}>
            You've joined {orgName ?? 'the workspace'}!
          </p>
          <Link
            href="/integrations"
            className="inline-block mt-6 rounded-lg px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: '#111827', color: '#ffffff' }}
          >
            Open workspace
          </Link>
        </>
      ) : null}

      {status === 'error' ? (
        <>
          <p className="text-sm font-semibold" style={{ color: '#dc2626' }}>Invite error</p>
          <p className="text-sm mt-1" style={{ color: '#6b7280' }}>{errorMessage}</p>
          <Link href="/login" className="mt-6 inline-block text-xs hover:underline" style={{ color: '#6b7280' }}>
            Back to sign in
          </Link>
        </>
      ) : null}
    </div>
  );
}
