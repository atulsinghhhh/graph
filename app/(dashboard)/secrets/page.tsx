'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

interface SecretRow {
  alert: Record<string, any>;
  engineers: Record<string, any>[];
  services: Record<string, any>[];
  pullRequests: Record<string, any>[];
  incidents: (Record<string, any> & { confidence: number | null })[];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor(diff / 3600000);
  const mins  = Math.floor(diff / 60000);
  if (days  > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return `${mins}m ago`;
}

function StateBadge({ state, bypassed }: { state: string; bypassed?: boolean }) {
  const open = state === 'open';
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
      open
        ? 'bg-red-950 text-red-400 border-red-900'
        : 'bg-green-950 text-green-400 border-green-900'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${open ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`}/>
      {state.toUpperCase()}
      {bypassed && open && (
        <span className="ml-1 text-orange-400 font-black">⚠ BYPASSED</span>
      )}
    </span>
  );
}

export default function SecretsPage() {
  const [rows, setRows]   = useState<SecretRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/secrets')
      .then(r => setRows(r.data))
      .catch((e: any) => setError(e.response?.data?.error ?? e.message ?? 'Failed to load'));
  }, []);

  const openCount = rows?.filter(r => r.alert?.state === 'open').length ?? 0;

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Secret Scanning Alerts</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Secrets detected in your repositories via GitHub Advanced Security.
            Every team member and the organisation can see this.
          </p>
        </div>
        {openCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5
            rounded-full bg-red-50 text-red-700 border border-red-200">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/>
            {openCount} open {openCount === 1 ? 'alert' : 'alerts'}
          </span>
        )}
      </div>

      {/* How visibility works */}
      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
        <p className="text-xs font-semibold text-amber-800 mb-2">How the organisation is notified</p>
        <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
          <li>GitHub emails the repository admin and security managers immediately on detection</li>
          <li>The engineer who pushed the secret sees a block if push protection was enabled</li>
          <li>This platform syncs every alert into the graph — visible to all team members here</li>
          <li>The AI chat answers "did anyone push a secret?" or "who leaked an AWS key?"</li>
          <li>Open alerts linked to incidents appear as <strong>red breakdown cascades</strong> on the Graph page</li>
        </ul>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {!rows && !error && (
        <div className="text-sm text-zinc-400 animate-pulse">Loading alerts…</div>
      )}

      {rows && rows.length === 0 && (
        <div className="text-sm text-zinc-400">No secret scanning alerts found. Run a GitHub sync to fetch them.</div>
      )}

      <div className="space-y-4">
        {rows?.map((row, i) => {
          const a = row.alert;
          if (!a) return null;
          const open = a.state === 'open';

          return (
            <div key={i} className={`rounded-xl border p-5 ${
              open
                ? 'border-red-200 bg-red-50/40'
                : 'border-zinc-200 bg-white'
            }`}>
              {/* Top row */}
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <StateBadge state={a.state} bypassed={a.pushProtectionBypassed}/>
                    <span className="text-xs font-mono text-zinc-500">#{a.alertNumber}</span>
                  </div>
                  <p className="font-semibold text-zinc-900 text-sm">{a.secretType}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{a.repository}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-zinc-400">{a.createdAt ? timeAgo(a.createdAt) : ''}</p>
                  {a.url && (
                    <a href={a.url} target="_blank" rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline mt-1 inline-block">
                      View on GitHub →
                    </a>
                  )}
                </div>
              </div>

              {/* Who pushed it */}
              {row.engineers.length > 0 && (
                <div className={`rounded-lg px-4 py-3 mb-3 ${
                  open ? 'bg-red-100 border border-red-200' : 'bg-zinc-50 border border-zinc-200'
                }`}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
                    Pushed by
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {row.engineers.map((e, ei) => (
                      <span key={ei} className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                        open
                          ? 'bg-red-200 text-red-800'
                          : 'bg-zinc-200 text-zinc-700'
                      }`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60"/>
                        {e.name ?? e.githubLogin ?? 'Unknown'}
                      </span>
                    ))}
                  </div>
                  {a.pushProtectionBypassed && open && (
                    <p className="text-[10px] text-orange-700 font-semibold mt-2">
                      ⚠ Push protection was bypassed — the secret was committed despite GitHub's block
                    </p>
                  )}
                </div>
              )}

              {/* Metadata grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {row.services.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-0.5">Service</p>
                    <p className="text-zinc-700 font-medium">{row.services.map(s=>s.name).join(', ')}</p>
                  </div>
                )}
                {a.resolution && (
                  <div>
                    <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-0.5">Resolution</p>
                    <p className="text-zinc-700 font-medium capitalize">{a.resolution}</p>
                  </div>
                )}
                {a.commitSha && (
                  <div>
                    <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-0.5">Commit</p>
                    <p className="text-zinc-700 font-mono">{String(a.commitSha).slice(0,8)}</p>
                  </div>
                )}
                {a.updatedAt && (
                  <div>
                    <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-0.5">Updated</p>
                    <p className="text-zinc-700">{timeAgo(a.updatedAt)}</p>
                  </div>
                )}
              </div>

              {/* Possibly triggered incidents */}
              {row.incidents.length > 0 && (
                <div className="mt-3 rounded-lg bg-red-100 border border-red-200 px-4 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-red-600 mb-1.5">
                    May have triggered
                  </p>
                  <div className="space-y-1">
                    {row.incidents.map((inc, ii) => (
                      <div key={ii} className="flex items-center justify-between text-xs">
                        <span className="text-red-800 font-medium">{inc.title ?? inc.id}</span>
                        {inc.confidence != null && (
                          <span className="text-red-600 font-mono">
                            {Math.round((inc.confidence as number) * 100)}% confidence
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
