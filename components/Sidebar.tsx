'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import api from '@/lib/api';

const NAV = [
  { href: '/integrations', label: 'Integrations', icon: '⚙' },
  { href: '/sync',         label: 'Sync',          icon: '↻' },
  { href: '/graph',        label: 'Graph',          icon: '◈' },
  { href: '/chat',         label: 'AI Chat',        icon: '◎' },
  { href: '/incidents',    label: 'Incidents',      icon: '⚠' },
  { href: '/insights',     label: 'Dev Insights',   icon: '⚡' },
  { href: '/secrets',      label: 'Secrets',        icon: '⛨' },
];

export default function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [openSecrets, setOpenSecrets] = useState(0);

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

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <aside className="w-56 flex flex-col border-r border-zinc-200 bg-white h-full shrink-0">
      <div className="px-5 py-5 border-b border-zinc-100">
        <p className="text-sm font-bold text-zinc-900 tracking-tight">Incident Platform</p>
        <p className="text-xs text-zinc-400 mt-0.5">AI Investigation</p>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          const isSecrets = href === '/secrets';
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-zinc-100 text-zinc-900 font-medium'
                  : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50'
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              <span className="flex-1">{label}</span>
              {/* Red badge for open secret alerts */}
              {isSecrets && openSecrets > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full
                  bg-red-500 text-white text-[9px] font-bold leading-none animate-pulse">
                  {openSecrets}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-zinc-100">
        <p className="text-xs text-zinc-500 truncate mb-2">{email}</p>
        <button
          onClick={signOut}
          className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
