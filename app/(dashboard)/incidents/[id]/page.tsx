'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Timeline from '@/components/incidents/Timeline';
import api from '@/lib/api';

interface IncidentCtx {
  incident: {
    id: string;
    title: string;
    severity: string;
    status: string;
    startedAt: string;
    resolvedAt?: string;
    source?: string;
  };
  deployments: Array<{
    id: string; version?: string; environment?: string;
    deployedAt?: string; status?: string; confidence?: number;
  }>;
  pullRequests: Array<{
    id: string; githubId?: string; title?: string;
    url?: string; branch?: string; mergedAt?: string;
  }>;
  engineers: Array<{ id: string; name?: string; githubLogin?: string; avatarUrl?: string }>;
  bugs: Array<{ id: string; jiraId?: string; title?: string; priority?: string; url?: string }>;
  alerts: Array<{ id: string; metric?: string; message?: string; firedAt?: string; status?: string }>;
  services: Array<{ id: string; name?: string }>;
}

interface TimelineEvent {
  type: 'Deployment' | 'PullRequest' | 'Alert' | 'Incident' | 'Bug';
  label: string;
  timestamp: string;
  url?: string;
  confidence?: number;
}

function buildTimeline(ctx: IncidentCtx): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  const inc = ctx.incident;
  if (inc?.startedAt) {
    events.push({ type: 'Incident', label: inc.title, timestamp: inc.startedAt });
  }

  for (const d of ctx.deployments) {
    if (d.deployedAt) events.push({
      type: 'Deployment',
      label: `${d.version ?? 'Deployment'} (${d.environment ?? 'unknown'})`,
      timestamp: d.deployedAt,
      confidence: d.confidence,
    });
  }

  for (const pr of ctx.pullRequests) {
    if (pr.mergedAt) events.push({
      type: 'PullRequest',
      label: pr.title ?? `PR #${pr.githubId}`,
      timestamp: pr.mergedAt,
      url: pr.url,
    });
  }

  for (const a of ctx.alerts) {
    if (a.firedAt) events.push({
      type: 'Alert',
      label: a.metric ?? a.message ?? 'Alert',
      timestamp: a.firedAt,
    });
  }

  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
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

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ctx, setCtx] = useState<IncidentCtx | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<IncidentCtx>(`/api/incidents/${encodeURIComponent(id)}`)
      .then(r => setCtx(r.data))
      .catch((e: any) => {
        if (e.response?.status === 404) setError('Incident not found.');
        else setError(e.response?.data?.error ?? e.message ?? 'Failed to load incident');
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="p-8 max-w-2xl animate-pulse">
      <div className="h-6 bg-zinc-100 rounded w-2/3 mb-4" />
      <div className="h-4 bg-zinc-100 rounded w-1/4 mb-8" />
      <div className="h-48 bg-zinc-100 rounded-xl" />
    </div>
  );

  if (error) return (
    <div className="p-8 max-w-2xl">
      <Link href="/incidents" className="text-sm text-zinc-400 hover:text-zinc-600 mb-4 inline-block">← Incidents</Link>
      <div className="rounded-lg px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>
    </div>
  );

  if (!ctx) return null;

  const inc = ctx.incident;
  const events = buildTimeline(ctx);

  return (
    <div className="p-8 max-w-2xl">
      <Link href="/incidents" className="text-sm text-zinc-400 hover:text-zinc-600 mb-4 inline-block">← Incidents</Link>

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">{inc.title}</h1>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {inc.severity && (
            <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border capitalize ${SEVERITY_COLOR[inc.severity] ?? SEVERITY_COLOR.low}`}>
              {inc.severity}
            </span>
          )}
          {inc.status && (
            <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full capitalize ${STATUS_COLOR[inc.status] ?? STATUS_COLOR.open}`}>
              {inc.status}
            </span>
          )}
          {inc.startedAt && (
            <span className="text-xs text-zinc-400">Started {new Date(inc.startedAt).toLocaleString()}</span>
          )}
          {inc.source && (
            <span className="text-xs text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded">{inc.source}</span>
          )}
        </div>
      </div>

      {events.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-xl p-6 mb-5">
          <h2 className="text-sm font-semibold text-zinc-700 mb-5">Timeline</h2>
          <Timeline events={events} />
        </div>
      )}

      {ctx.engineers.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-xl p-5 mb-5">
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">Engineers involved</h2>
          <div className="flex flex-wrap gap-2">
            {ctx.engineers.map(e => (
              <span key={e.id} className="inline-flex items-center gap-1.5 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-3 py-1">
                {e.name ?? e.githubLogin ?? e.id}
              </span>
            ))}
          </div>
        </div>
      )}

      {ctx.bugs.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-xl p-5 mb-5">
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">Linked bugs</h2>
          <div className="flex flex-col gap-2">
            {ctx.bugs.map(b => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span className="text-zinc-700">{b.title ?? b.jiraId}</span>
                <div className="flex items-center gap-2">
                  {b.priority && (
                    <span className="text-xs text-zinc-400 capitalize">{b.priority}</span>
                  )}
                  {b.url && (
                    <a href={b.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
                      {b.jiraId}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {ctx.services.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">Affected services</h2>
          <div className="flex flex-wrap gap-2">
            {ctx.services.map(s => (
              <span key={s.id} className="text-xs bg-zinc-100 text-zinc-700 px-3 py-1 rounded-full">
                {s.name ?? s.id}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
