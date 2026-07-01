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
  Zap,
  ShieldAlert,
  GitBranch,
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

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/github/report', label: 'GitHub Report', icon: GitBranch },
  { href: '/integrations/team', label: 'Team', icon: Users },
  { href: '/sync', label: 'Sync', icon: RefreshCw },
  { href: '/graph', label: 'Graph', icon: Share2 },
  { href: '/chat', label: 'AI Chat', icon: Sparkles },
  { href: '/incidents', label: 'Incidents', icon: AlertTriangle },
  { href: '/insights', label: 'Dev Insights', icon: Zap },
  { href: '/secrets', label: 'Secrets', icon: ShieldAlert },
];

export default function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [openSecrets, setOpenSecrets] = useState(0);
  const [openGithubSecrets, setOpenGithubSecrets] = useState(0);
  const [showTeamLink, setShowTeamLink] = useState(false);

  // Poll open secret alert count every 60s
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

  // Poll open GitHub deep-scan security incidents every 60s
  useEffect(() => {
    function fetchCount() {
      api.get('/api/github/secrets')
        .then(r => setOpenGithubSecrets((r.data as any[]).length))
        .catch(() => {});
    }
    fetchCount();
    const id = setInterval(fetchCount, 60_000);
    return () => clearInterval(id);
  }, []);

  // Only show "Team" once there's a team, or you can manage one
  useEffect(() => {
    api.get('/api/organizations/me')
      .then(r => {
        const { role, memberCount } = r.data;
        setShowTeamLink(memberCount >= 2 || role === 'owner' || role === 'admin');
      })
      .catch(() => {});
  }, []);

  const nav = NAV.filter(item => item.href !== '/integrations/team' || showTeamLink);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  const initial = email ? email[0].toUpperCase() : '?';

  return (
    <aside className="w-60 flex flex-col border-r border-border bg-card h-full shrink-0">
      <div className="px-5 py-5 border-b border-border">
        <p className="text-sm font-bold text-foreground tracking-tight">Graph</p>
        <p className="text-xs text-muted-foreground mt-0.5">AI Investigation</p>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          const isSecrets = href === '/secrets';
          const isGithubReport = href === '/github/report';
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                active
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-primary" />
              )}
              <Icon className="size-4 shrink-0" strokeWidth={2} />
              <span className="flex-1">{label}</span>
              {isSecrets && openSecrets > 0 && (
                <Badge variant="destructive" className="h-5 min-w-5 justify-center px-1 rounded-full">
                  {openSecrets}
                </Badge>
              )}
              {isGithubReport && openGithubSecrets > 0 && (
                <Badge variant="destructive" className="h-5 min-w-5 justify-center px-1 rounded-full">
                  {openGithubSecrets}
                </Badge>
              )}
            </Link>
          );
        })}
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
