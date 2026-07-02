'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
    <Card className="w-full max-w-sm">
      <CardContent className="pt-6 pb-6 text-center flex flex-col items-center">
        {(status === 'checking' || status === 'accepting') && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {status === 'signed-out' && token && (
          <>
            <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-primary/10">
              <Mail className="size-5 text-primary" />
            </div>
            <p className="text-sm font-semibold text-foreground">You&apos;ve been invited</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in with your work email to accept this invite.
            </p>
            <Button asChild className="mt-6">
              <Link href={`/login?next=${encodeURIComponent(`/join?token=${token}`)}`}>
                Sign in to accept
              </Link>
            </Button>
          </>
        )}

        {status === 'accepted' && (
          <>
            <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-success/10">
              <Check className="size-5 text-success" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              You&apos;ve joined {orgName ?? 'the workspace'}!
            </p>
            <Button asChild className="mt-6">
              <Link href="/integrations">Open workspace</Link>
            </Button>
          </>
        )}

        {status === 'error' && (
          <>
            <p className="text-sm font-semibold text-destructive">Invite error</p>
            <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
            <Button variant="ghost" asChild className="mt-6 text-muted-foreground">
              <Link href="/login">Back to sign in</Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
