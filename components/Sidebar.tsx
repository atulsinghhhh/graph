'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Plug,
  Users,
  RefreshCw,
  Share2,
  Sparkles,
  AlertTriangle,
  GitBranch,
  LayoutGrid,
  Kanban,
  MessageCircle,
  BellRing,
  CircleDot,
  Activity,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type NavItem = { href: string; label: string; icon: LucideIcon };

// Top-level nav. Insights and Secrets live inside /github/report now (both are
// GitHub-only data), not as standalone items here.
const NAV: NavItem[] = [
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/reports', label: 'Reports', icon: LayoutGrid },
  { href: '/integrations/team', label: 'Team', icon: Users },
  { href: '/sync', label: 'Sync', icon: RefreshCw },
  { href: '/graph', label: 'Graph', icon: Share2 },
  { href: '/chat', label: 'AI Chat', icon: Sparkles },
  { href: '/incidents', label: 'Incidents', icon: AlertTriangle },
];

// Per-tool report pages — nested under "Reports", only shown when the viewer
// is somewhere in the reports section (on /reports itself or one of these).
const REPORT_LINKS: NavItem[] = [
  { href: '/github/report', label: 'GitHub', icon: GitBranch },
  { href: '/jira/report', label: 'Jira', icon: Kanban },
  { href: '/slack/report', label: 'Slack', icon: MessageCircle },
  { href: '/pagerduty/report', label: 'PagerDuty', icon: BellRing },
  { href: '/linear/report', label: 'Linear', icon: CircleDot },
  { href: '/datadog/report', label: 'Datadog', icon: Activity },
];

const REPORT_BADGE_CONFIG: Record<string, string[]> = {
  '/github/report': ['secret'],
  '/jira/report': ['sla_breach'],
  '/slack/report': ['unresolved_incident_channel'],
  '/pagerduty/report': ['unacknowledged_page'],
  '/linear/report': ['cycle_at_risk'],
  '/datadog/report': ['prolonged_alert', 'no_data'],
};

export default function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [openSecrets, setOpenSecrets] = useState(0);
  const [reportBadgeCounts, setReportBadgeCounts] = useState<Record<string, number>>({});
  const [showTeamLink, setShowTeamLink] = useState(false);

  // Poll open secret alert count every 60s — folded into the GitHub Report badge,
  // since Secrets lives inside /github/report now.
  useEffect(() => {
    function fetchCount() {
      api.get('/api/secrets')
        .then(r => {
          const n = (r.data as any[]).filter((row: any) => row.alert?.state === 'open').length;
          setOpenSecrets(n);
        })
        .catch(() => {});
    }
    fetchCount();
    const id = setInterval(fetchCount, 60_000);
    return () => clearInterval(id);
  }, []);

  // One fetch powers every report nav item's badge count
  useEffect(() => {
    function fetchCounts() {
      api.get('/api/reports/overview')
        .then(r => {
          const reports = r.data?.reports ?? {};
          const counts: Record<string, number> = {};
          for (const [href, types] of Object.entries(REPORT_BADGE_CONFIG)) {
            const tool = href.split('/')[1];
            const issues = reports[tool]?.issues_found ?? [];
            counts[href] = issues.filter((i: any) => types.includes(i.type)).length;
          }
          setReportBadgeCounts(counts);
        })
        .catch(() => {});
    }
    fetchCounts();
    const id = setInterval(fetchCounts, 60_000);
    return () => clearInterval(id);
  }, []);

  // Team is solo/org's one real distinction: hidden entirely until there's
  // actually a team (memberCount >= 2). Being 'owner' of a solo org shouldn't
  // surface it — every solo user is the owner of their own org.
  useEffect(() => {
    api.get('/api/organizations/me')
      .then(r => setShowTeamLink((r.data.memberCount ?? 1) >= 2))
      .catch(() => {});
  }, []);

  const nav = NAV.filter(item => item.href !== '/integrations/team' || showTeamLink);

  const isReportsSection = pathname === '/reports' || REPORT_LINKS.some(l => pathname.startsWith(l.href));
  const reportBadgeTotal = Object.values(reportBadgeCounts).reduce((a, b) => a + b, 0) + openSecrets;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  const initial = email ? email[0].toUpperCase() : '?';

  function NavRow({ href, label, icon: Icon, badgeCount, nested }: NavItem & { badgeCount?: number; nested?: boolean }) {
    const active = pathname === href || pathname.startsWith(href + '/');
    return (
      <Link
        href={href}
        className={cn(
          'relative flex items-center gap-2.5 py-2 rounded-md text-sm transition-colors',
          nested ? 'pl-9 pr-3' : 'px-3',
          active
            ? 'bg-accent text-foreground font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
        )}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-primary" />
        )}
        <Icon className={cn('shrink-0', nested ? 'size-3.5' : 'size-4')} strokeWidth={2} />
        <span className="flex-1">{label}</span>
        {!!badgeCount && (
          <Badge variant="destructive" className="h-5 min-w-5 justify-center px-1 rounded-full">
            {badgeCount}
          </Badge>
        )}
      </Link>
    );
  }

  return (
    <aside className="w-60 flex flex-col border-r border-border bg-card h-full shrink-0">
      <div className="px-5 py-5 border-b border-border">
        <p className="text-sm font-bold text-foreground tracking-tight">Graph</p>
        <p className="text-xs text-muted-foreground mt-0.5">AI Investigation</p>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        {nav.map(item => (
          <div key={item.href} className="flex flex-col gap-0.5">
            <NavRow
              {...item}
              badgeCount={item.href === '/reports' && !isReportsSection ? reportBadgeTotal : undefined}
            />
            {item.href === '/reports' && isReportsSection && (
              <div className="flex flex-col gap-0.5">
                {REPORT_LINKS.map(link => (
                  <NavRow
                    key={link.href}
                    {...link}
                    nested
                    badgeCount={
                      (reportBadgeCounts[link.href] ?? 0) +
                      (link.href === '/github/report' ? openSecrets : 0)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="px-3 py-3 border-t border-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent/60 transition-colors">
              <Avatar className="size-7">
                <AvatarFallback>{initial}</AvatarFallback>
              </Avatar>
              <span className="flex-1 text-xs text-muted-foreground truncate">{email}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem variant="destructive" onClick={signOut}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
