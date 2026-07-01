'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MailCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

type Mode = 'signin' | 'signup' | 'verify';
type AccountType = 'personal' | 'org';

function getInitialMode(): Mode {
  if (typeof window === 'undefined') return 'signin';
  return new URLSearchParams(window.location.search).get('mode') === 'signup' ? 'signup' : 'signin';
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(getInitialMode);
  const [accountType, setAccountType] = useState<AccountType>('personal');
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

    const next = new URLSearchParams(window.location.search).get('next');

    try {
      const supabase = createClient();

      if (mode === 'signup') {
        // An explicit `next` (e.g. from an invite link) always wins. Otherwise,
        // route org signups through onboarding to create a named workspace
        // *before* any authenticated page load can auto-provision a solo org.
        const postVerifyPath = next ?? (accountType === 'org' ? '/onboarding/create-org' : '/integrations');
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(postVerifyPath)}`,
          },
        });
        if (error) setError(extractMessage(error));
        else setMode('verify');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(extractMessage(error));
        } else if (next) {
          router.push(next);
          router.refresh();
        } else {
          // Check for a pending team invite before landing on /integrations —
          // solo signup still auto-creates silently, this only redirects
          // users who were explicitly invited to an existing org.
          try {
            const { data } = await api.get('/api/organizations/me');
            if (data.pendingInvite) {
              router.push(`/join?token=${data.pendingInvite.token}`);
              setLoading(false);
              return;
            }
          } catch {
            // never block login on this check
          }
          router.push('/integrations');
          router.refresh();
        }
      }
    } catch (err) {
      setError(extractMessage(err));
    }

    setLoading(false);
  }

  if (mode === 'verify') {
    return (
      <Card className="w-full max-w-sm">
        <CardContent className="pt-5 pb-6 text-center flex flex-col items-center">
          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <MailCheck className="size-5 text-primary" />
          </div>
          <p className="text-sm font-semibold text-foreground">Check your email</p>
          <p className="text-sm mt-1 text-muted-foreground">
            We sent a verification link to <strong className="text-foreground">{email}</strong>.
            <br />
            Click it to activate your account.
          </p>
          <Button
            variant="link"
            onClick={() => setMode('signin')}
            className="mt-6 h-auto p-0 text-xs text-muted-foreground"
          >
            Back to sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="pb-2">
        <span className="text-lg font-bold tracking-tight text-foreground">
          Graph
        </span>
        <p className="text-sm text-muted-foreground">
          AI-powered incident investigation
        </p>
      </CardHeader>

      <CardContent className="pb-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === 'signup' && (
            <div className="flex flex-col gap-1.5">
              <Label>Account type</Label>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  type="button"
                  variant={accountType === 'personal' ? 'default' : 'outline'}
                  onClick={() => setAccountType('personal')}
                  className="w-full"
                >
                  Just me
                </Button>
                <Button
                  type="button"
                  variant={accountType === 'org' ? 'default' : 'outline'}
                  onClick={() => setAccountType('org')}
                  className="w-full"
                >
                  My team
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {accountType === 'org'
                  ? "You'll create a named workspace and can invite teammates next."
                  : 'A personal workspace just for you — you can invite teammates later.'}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{String(error)}</p> : null}

          <Button type="submit" disabled={loading} className="w-full">
            {loading
              ? (mode === 'signup' ? 'Creating account…' : 'Signing in…')
              : (mode === 'signup' ? 'Create account' : 'Sign in')}
          </Button>
        </form>

        <p className="text-xs text-center mt-6 text-muted-foreground">
          {mode === 'signin' ? (
            <>
              No account?{' '}
              <button
                onClick={() => { setMode('signup'); setError(''); }}
                className="font-medium text-foreground hover:underline"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                onClick={() => { setMode('signin'); setError(''); }}
                className="font-medium text-foreground hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
