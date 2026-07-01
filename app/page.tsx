import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Network,
  Clock,
  Users,
  TrendingDown,
  Plug,
  MessageSquare,
  GitPullRequest,
  UsersRound,
  History,
  RefreshCw,
  Building2,
  Laptop,
  GitBranch,
  Kanban,
  Activity,
  MessageCircle,
  BellRing,
  GitCommit,
  Workflow,
  CircleDot,
  XIcon,
  Mail,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import Navbar from '@/components/marketing/Navbar';
import DemoChat from '@/components/marketing/DemoChat';
import BreakGraph from '@/components/marketing/BreakGraph';
import PricingSection from '@/components/marketing/PricingSection';

const PROBLEM_CARDS = [
  {
    icon: Clock,
    accent: 'text-warning',
    title: '3+ hours per incident',
    body: 'Engineers search Slack, GitHub, Jira, and Datadog manually. By the time you find the cause, customers have already churned.',
  },
  {
    icon: Users,
    accent: 'text-destructive',
    title: 'Wrong person gets paged',
    body: 'Nobody knows who actually owns a service. The on-call engineer wastes 30 minutes just finding out who to wake up.',
  },
  {
    icon: TrendingDown,
    accent: 'text-warning',
    title: 'Revenue impact is invisible',
    body: "You know something is broken but not which customers or how much ARR is at risk while you're still investigating.",
  },
];

const STEPS = [
  {
    icon: Plug,
    accent: 'text-primary',
    title: 'Connect your tools',
    body: 'Link GitHub, Jira, and Datadog with OAuth in one click. No code, no configuration.',
  },
  {
    icon: Network,
    accent: 'text-primary',
    title: 'Graph builds automatically',
    body: 'We index your deployments, PRs, engineers, incidents, and alerts — and connect them into a relationship graph.',
  },
  {
    icon: MessageSquare,
    accent: 'text-primary',
    title: 'Ask anything',
    body: 'Type a plain-English question. Get an answer with sources traced back to the exact deployment, PR, and engineer.',
  },
];

const FEATURES = [
  {
    icon: GitPullRequest,
    title: 'Root cause in seconds',
    body: 'The AI traces every incident back to the exact PR, commit, and engineer — automatically.',
  },
  {
    icon: UsersRound,
    title: 'Know who owns what',
    body: "Ownership is inferred from commit history. No spreadsheets, no guessing, no 'who's on call?'",
  },
  {
    icon: History,
    title: 'Full incident timeline',
    body: 'See deployment → PR → alert → incident → fix in a single visual timeline with real source links.',
  },
  {
    icon: RefreshCw,
    title: 'Always up to date',
    body: 'Graph resyncs every 15 minutes. Ask about something that happened an hour ago and get a real answer.',
  },
  {
    icon: Building2,
    title: 'Built for teams',
    body: 'Invite your whole engineering team. Every developer queries the same graph, shared across the org.',
  },
  {
    icon: Laptop,
    title: 'Works solo too',
    body: 'Single developer? Connect your personal GitHub and Jira. Get the same AI-powered investigation, just for you.',
  },
];

const INTEGRATIONS = [
  { icon: GitBranch, name: 'GitHub' },
  { icon: Kanban, name: 'Jira' },
  { icon: Activity, name: 'Datadog' },
  { icon: MessageCircle, name: 'Slack' },
  { icon: BellRing, name: 'PagerDuty' },
  { icon: CircleDot, name: 'Linear' },
];

const TESTIMONIALS = [
  {
    quote: 'We used to spend 3 hours on every incident post-mortem. Now the AI gives us the full picture before we even open Slack.',
    name: 'Sarah K.',
    role: 'VP Engineering, Series B SaaS',
  },
  {
    quote: 'The "who owns this service" question used to cause arguments. Now we just ask the graph.',
    name: 'Marcus T.',
    role: 'Staff Engineer',
  },
  {
    quote: 'First time I saw it trace a production bug back to a PR from two days ago in 8 seconds, I knew we had to have it.',
    name: 'Priya M.',
    role: 'CTO, 40-person startup',
  },
];

const BREAK_EXPLANATION_CARDS = [
  {
    icon: BellRing,
    accent: 'text-destructive',
    title: 'Error fires',
    body: 'A Datadog alert fires. The graph detects the timestamp and immediately begins tracing which deployment preceded it.',
  },
  {
    icon: GitCommit,
    accent: 'text-destructive',
    title: 'Break point found',
    body: 'The graph walks backward: alert → service → deployment → PR → engineer. It scores each connection by time proximity and confidence. The node with the highest score becomes the break point.',
  },
  {
    icon: Workflow,
    accent: 'text-warning',
    title: 'Cascade shown',
    body: "Every node downstream of the break point turns amber. These are cascade nodes — they didn't cause the problem, they were caused by it. The AI explains each one.",
  },
];

async function checkOrgHasConnectedIntegrations(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string): Promise<boolean> {
  const { count } = await supabase
    .from('integrations')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'connected');
  return (count ?? 0) > 0;
}

export default async function LandingPage() {
  const supabase = await createClient();

  let userId: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }

  if (userId) {
    const { data: membership } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (!membership) {
      redirect('/integrations');
    }

    const hasIntegrations = await checkOrgHasConnectedIntegrations(supabase, membership.org_id);
    redirect(hasIntegrations ? '/chat' : '/integrations');
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-1">
        {/* Hero */}
        <section className="max-w-[680px] mx-auto px-6 pt-[120px] pb-16 text-center flex flex-col items-center">
          {/* <Badge variant="outline" className="mb-6 text-muted-foreground">
            <Sparkles className="size-3" />
            AI-powered incident investigation
          </Badge> */}

          <h1 className="text-[32px] md:text-[48px] font-medium leading-[1.15] tracking-tight text-foreground">
            Find the cause of every
            <br />
            production incident instantly
          </h1>

          <p className="mt-5 text-lg text-muted-foreground max-w-[520px] mx-auto">
            Connect GitHub, Jira, and Datadog. When something breaks, ask in plain English — get the
            deployment, the PR, the engineer, and the fix in seconds.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/login">Start free — no credit card</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#demo">Watch demo</a>
            </Button>
          </div>

          <p className="mt-6 text-[13px] text-muted-foreground/70">
            Used by 200+ engineering teams · Works with GitHub, Jira, Datadog
          </p>
        </section>

        {/* Live breaking graph */}
        <section className="py-20 px-6">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-10">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
                See it live
              </p>
              <h2 className="text-3xl font-medium text-foreground mb-3">
                The graph breaks exactly where the error started
              </h2>
              <p className="text-muted-foreground">
                Every deployment, pull request, engineer, and alert is a node. When something fails, the
                graph cracks at the fault point and shows you the full cascade in seconds.
              </p>
            </div>
            <BreakGraph />
            <p className="text-center text-xs text-muted-foreground mt-4">
              This is a live simulation. Your real graph uses actual data from GitHub, Jira, and Datadog.
            </p>
          </div>

          <div className="max-w-[1100px] mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6 mt-14">
            {BREAK_EXPLANATION_CARDS.map(card => (
              <div key={card.title} className="rounded-xl border border-border bg-card p-6">
                <card.icon className={`size-6 mb-4 ${card.accent}`} strokeWidth={1.75} />
                <h3 className="text-sm font-semibold text-foreground mb-1.5">{card.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Demo */}
        <section id="demo" className="max-w-[1100px] mx-auto px-6 pb-24">
          <DemoChat />
        </section>

        {/* Problem statement */}
        <section className="max-w-[1100px] mx-auto px-6 pb-24">
          <h2 className="text-2xl sm:text-3xl font-medium text-center text-foreground mb-10">
            Right now, incidents cost your team hours
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {PROBLEM_CARDS.map(card => (
              <div key={card.title} className="rounded-xl border border-border bg-card p-6">
                <card.icon className={`size-6 mb-4 ${card.accent}`} strokeWidth={1.75} />
                <h3 className="text-sm font-semibold text-foreground mb-1.5">{card.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="max-w-[1100px] mx-auto px-6 pb-24">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-medium text-foreground mb-2">How it works</h2>
            <p className="text-muted-foreground">From connection to answer in under 10 minutes</p>
          </div>

          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-6">
            <div
              className="hidden md:block absolute top-9 left-[16.5%] right-[16.5%] border-t border-dashed border-border"
              aria-hidden
            />
            {STEPS.map((step, i) => (
              <div key={step.title} className="relative flex flex-col items-center text-center">
                <span className="mb-3 inline-flex items-center justify-center size-6 rounded-full bg-foreground text-background text-xs font-semibold">
                  {i + 1}
                </span>
                <div className="relative z-10 flex items-center justify-center size-12 rounded-xl border border-border bg-card mb-4">
                  <step.icon className={`size-5 ${step.accent}`} strokeWidth={1.75} />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1.5">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-[260px]">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features grid */}
        <section id="features" className="max-w-[1100px] mx-auto px-6 pb-24">
          <h2 className="text-2xl sm:text-3xl font-medium text-center text-foreground mb-10">
            Everything your team needs during an incident
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(feature => (
              <div key={feature.title} className="rounded-xl border border-border bg-card p-6">
                <feature.icon className="size-6 mb-4 text-primary" strokeWidth={1.75} />
                <h3 className="text-sm font-semibold text-foreground mb-1.5">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Integrations */}
        <section className="max-w-[1100px] mx-auto px-6 pb-24">
          <h2 className="text-2xl sm:text-3xl font-medium text-center text-foreground mb-10">
            Works with your existing stack
          </h2>
          <div className="flex flex-wrap items-start justify-center divide-x divide-border">
            {INTEGRATIONS.map(item => (
              <div key={item.name} className="flex flex-col items-center gap-2 px-8 py-2">
                <item.icon className="size-8 text-muted-foreground" strokeWidth={1.5} />
                <span className="text-xs text-muted-foreground">{item.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Testimonials */}
        <section className="max-w-[1100px] mx-auto px-6 pb-24">
          <h2 className="text-2xl sm:text-3xl font-medium text-center text-foreground mb-10">
            Trusted by engineering teams
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {TESTIMONIALS.map(t => (
              <div key={t.name} className="rounded-xl border-l-2 border-l-primary border-y border-r border-border bg-card p-6">
                <p className="font-serif text-[15px] text-foreground leading-relaxed mb-4">&ldquo;{t.quote}&rdquo;</p>
                <p className="text-sm font-medium text-foreground">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.role}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="max-w-[1100px] mx-auto px-6 pb-24">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-medium text-foreground mb-2">Start free. Scale as you grow.</h2>
            <p className="text-muted-foreground">No credit card required for Free and trial plans.</p>
          </div>

          <PricingSection />
        </section>

        {/* Final CTA */}
        <section className="border-t border-border bg-card/50">
          <div className="max-w-[680px] mx-auto px-6 py-20 text-center">
            <h2 className="text-2xl sm:text-3xl font-medium text-foreground mb-3">
              Stop losing hours to incidents you could solve in seconds
            </h2>
            <p className="text-muted-foreground mb-8">
              Connect your first tool in 2 minutes. No credit card required.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button size="lg" asChild>
                <Link href="/login">Start free</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="mailto:hello@graph.dev">Talk to us</a>
              </Button>
            </div>
            <p className="mt-6 text-xs text-muted-foreground/70">
              SOC 2 in progress · No data stored beyond graph metadata · Cancel anytime
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-[1100px] mx-auto px-6 py-14 grid grid-cols-1 sm:grid-cols-3 gap-10">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Network className="size-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Graph</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              AI-powered incident investigation for engineering teams.
            </p>
            <div className="flex items-center gap-4">
              <a href="https://github.com" className="text-muted-foreground hover:text-foreground transition-colors" aria-label="GitHub">
                <GitBranch className="size-4" />
              </a>
              <a href="https://x.com" className="text-muted-foreground hover:text-foreground transition-colors" aria-label="X">
                <XIcon className="size-4" />
              </a>
              <a href="mailto:hello@graph.dev" className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Email">
                <Mail className="size-4" />
              </a>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-3">Product</p>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
              <li><a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a></li>
              <li><a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">Changelog</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">Docs</a></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide mb-3">Company</p>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              <li><a href="#" className="hover:text-foreground transition-colors">About</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">Blog</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">Privacy</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">Terms</a></li>
              <li><a href="mailto:hello@graph.dev" className="hover:text-foreground transition-colors">Contact</a></li>
            </ul>
          </div>
        </div>

        
      </footer>
    </div>
  );
}
