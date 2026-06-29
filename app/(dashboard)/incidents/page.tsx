'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

interface Incident {
  id: string;
  title: string;
  severity: string;
  status: string;
  startedAt: string;
  resolvedAt?: string;
  source?: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-zinc-50 text-zinc-600 border-zinc-200',
};

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-red-50 text-red-700',
  investigating: 'bg-blue-50 text-blue-700',
  resolved: 'bg-green-50 text-green-700',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return 'just now';
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Incident[]>('/api/incidents')
      .then(r => setIncidents(r.data))
      .catch((err: any) => setError(err.response?.data?.error ?? err.message ?? 'Failed to load incidents'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-xl font-semibold text-zinc-900 mb-1">Incidents</h1>
      <p className="text-sm text-zinc-500 mb-6">All incidents synced from your connected tools.</p>

      {error && (
        <div className="mb-5 rounded-lg px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white border border-zinc-200 rounded-xl px-5 py-4 animate-pulse">
              <div className="h-4 bg-zinc-100 rounded w-2/3 mb-2" />
              <div className="h-3 bg-zinc-100 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : incidents.length === 0 && !error ? (
        <div className="text-center py-16 border border-dashed border-zinc-200 rounded-xl text-zinc-400 text-sm">
          <p className="mb-2">No incidents found.</p>
          <p>Run a sync from the <Link href="/sync" className="text-zinc-600 underline underline-offset-2">Sync page</Link> to pull incident data.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {incidents.map(inc => (
            <Link
              key={inc.id}
              href={`/incidents/${encodeURIComponent(inc.id)}`}
              className="bg-white border border-zinc-200 rounded-xl px-5 py-4 flex items-center justify-between hover:border-zinc-400 transition-colors group"
            >
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-sm font-medium text-zinc-900 group-hover:text-zinc-700 truncate">
                  {inc.title}
                </span>
                <span className="text-xs text-zinc-400">
                  Started {timeAgo(inc.startedAt)}
                  {inc.resolvedAt && ` · resolved ${timeAgo(inc.resolvedAt)}`}
                  {inc.source && ` · ${inc.source}`}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${SEVERITY_COLOR[inc.severity] ?? SEVERITY_COLOR.low}`}>
                  {inc.severity}
                </span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[inc.status] ?? STATUS_COLOR.open}`}>
                  {inc.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
