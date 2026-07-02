'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MailCheck, User, Users, Share2, Sparkles, ShieldCheck, ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Mode = 'signin' | 'signup' | 'verify';
type AccountType = 'personal' | 'org';

function getInitialMode(): Mode {
  if (typeof window === 'undefined') return 'signin';
  return new URLSearchParams(window.location.search).get('mode') === 'signup' ? 'signup' : 'signin';
}

const FEATURES = [
  { icon: Share2, title: 'One live graph', desc: 'Deployments, PRs, incidents, and alerts connected across every tool.' },
  { icon: Sparkles, title: 'Ask in plain English', desc: '“Why did checkout fail yesterday?” — answered with real, cited data.' },
  { icon: ShieldCheck, title: 'Catch risk early', desc: 'Secret leaks, SLA breaches, and risky PRs surfaced before they page you.' },
];

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

  return (
    <div className="flex min-h-screen">
      {/* ── Brand panel (left, desktop only) ── */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden border-r border-border bg-card px-12 py-14 lg:flex">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: 'radial-gradient(circle at 30% 0%, rgba(99,102,241,0.18), transparent 55%)' }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        <div className="relative z-10 flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Share2 className="size-4" />
          </div>
          <span className="text-base font-bold tracking-tight text-foreground">Graph</span>
        </div>

        <div className="relative z-10 max-w-md">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Stop digging through five tools when production breaks.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            AI-powered incident investigation over a live graph of your engineering data.
          </p>

          <ul className="mt-10 flex flex-col gap-6">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex gap-3.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
                  <Icon className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-muted-foreground">
          Deployment → Pull Request → Engineer → Service → Incident
        </p>
      </aside>

      {/* ── Form panel (right) ── */}
      <main className="flex w-full flex-col items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          {mode === 'verify' ? (
            <div className="flex flex-col items-center text-center">
              <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-primary/10">
                <MailCheck className="size-6 text-primary" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Check your email</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                We sent a verification link to <strong className="text-foreground">{email}</strong>.
                Click it to activate your account.
              </p>
              <Button
                variant="ghost"
                onClick={() => setMode('signin')}
                className="mt-6 text-muted-foreground"
              >
                <ArrowLeft className="size-4" />
                Back to sign in
              </Button>
            </div>
          ) : (
            <>
              {/* Mobile logo (brand panel is hidden on small screens) */}
              <div className="mb-8 flex items-center gap-2 lg:hidden">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Share2 className="size-4" />
                </div>
                <span className="text-base font-bold tracking-tight text-foreground">Graph</span>
              </div>

              <div className="mb-8">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  {mode === 'signup' ? 'Create your account' : 'Welcome back'}
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {mode === 'signup'
                    ? 'Start investigating incidents in minutes.'
                    : 'Sign in to your workspace to continue.'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                {mode === 'signup' && (
                  <div className="flex flex-col gap-1.5">
                    <Label>Account type</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { key: 'personal', icon: User, label: 'Just me', hint: 'Personal workspace' },
                        { key: 'org', icon: Users, label: 'My team', hint: 'Shared workspace' },
                      ] as const).map(({ key, icon: Icon, label, hint }) => {
                        const active = accountType === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setAccountType(key)}
                            className={cn(
                              'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors',
                              active
                                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                : 'border-border hover:border-muted-foreground/40 hover:bg-accent/40'
                            )}
                          >
                            <Icon className={cn('size-4', active ? 'text-primary' : 'text-muted-foreground')} />
                            <span className="text-sm font-medium text-foreground">{label}</span>
                            <span className="text-xs text-muted-foreground">{hint}</span>
                          </button>
                        );
                      })}
                    </div>
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
                    autoComplete="email"
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
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  />
                </div>

                {error ? <p className="text-sm text-destructive">{String(error)}</p> : null}

                <Button type="submit" disabled={loading} className="w-full" size="lg">
                  {loading
                    ? (mode === 'signup' ? 'Creating account…' : 'Signing in…')
                    : (mode === 'signup' ? 'Create account' : 'Sign in')}
                </Button>
              </form>

              <p className="mt-8 text-center text-sm text-muted-foreground">
                {mode === 'signin' ? (
                  <>
                    Don&apos;t have an account?{' '}
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
            </>
          )}
        </div>
      </main>
    </div>
  );
}
