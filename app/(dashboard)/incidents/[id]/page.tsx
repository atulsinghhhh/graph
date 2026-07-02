'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import Timeline from '@/components/incidents/Timeline';
import IncidentGraph, { BreakPoint } from '@/components/incidents/IncidentGraph';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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
  breakPoint: BreakPoint;
  breakNodeId: string | null;
  cascadeNodes: string[];
  fix: {
    fixDeployment: { id: string; version?: string; environment?: string; deployedAt?: string };
    fixPullRequest: { id: string; githubId?: string; title?: string; url?: string; mergedAt?: string } | null;
  } | null;
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
  critical: 'bg-destructive/10 text-destructive border-destructive/30',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  medium: 'bg-warning/10 text-warning border-warning/30',
  low: 'bg-muted text-muted-foreground border-border',
};

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-destructive/10 text-destructive',
  investigating: 'bg-blue-500/10 text-blue-400',
  resolved: 'bg-success/10 text-success',
};

export default function IncidentDetailPage() {
  const { id: rawId } = useParams<{ id: string }>();
  // useParams may return the segment already encoded (jira%3AINC-100).
  // Decode first so we always have the canonical ID, then re-encode for the API URL.
  const id = decodeURIComponent(rawId ?? '');
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
      <div className="h-6 bg-muted rounded w-2/3 mb-4" />
      <div className="h-4 bg-muted rounded w-1/4 mb-8" />
      <div className="h-48 bg-muted rounded-xl" />
    </div>
  );

  if (error) return (
    <div className="p-8 max-w-2xl">
      <Link href="/incidents" className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5">
        <ArrowLeft className="size-3.5" /> Incidents
      </Link>
      <div className="rounded-lg px-4 py-3 text-sm bg-destructive/10 text-destructive border border-destructive/30">{error}</div>
    </div>
  );

  if (!ctx) return null;

  const inc = ctx.incident;
  const events = buildTimeline(ctx);

  return (
    <div className="p-8 max-w-2xl">
      <Link href="/incidents" className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5">
        <ArrowLeft className="size-3.5" /> Incidents
      </Link>

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">{inc.title}</h1>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {inc.severity && (
            <Badge variant="outline" className={cn('capitalize', SEVERITY_COLOR[inc.severity] ?? SEVERITY_COLOR.low)}>
              {inc.severity}
            </Badge>
          )}
          {inc.status && (
            <Badge variant="outline" className={cn('capitalize border-transparent', STATUS_COLOR[inc.status] ?? STATUS_COLOR.open)}>
              {inc.status}
            </Badge>
          )}
          {inc.startedAt && (
            <span className="text-xs text-muted-foreground">Started {new Date(inc.startedAt).toLocaleString()}</span>
          )}
          {inc.source && (
            <Badge variant="secondary" className="text-muted-foreground">{inc.source}</Badge>
          )}
        </div>
      </div>

      <div className="mb-5">
        <IncidentGraph incident={ctx} breakPoint={ctx.breakPoint} cascadeNodes={ctx.cascadeNodes} />
      </div>

      {events.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6 mb-5">
          <h2 className="text-sm font-semibold text-foreground mb-5">Timeline</h2>
          <Timeline events={events} />
        </div>
      )}

      {ctx.engineers.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 mb-5">
          <h2 className="text-sm font-semibold text-foreground mb-3">Engineers involved</h2>
          <div className="flex flex-wrap gap-2">
            {ctx.engineers.map(e => (
              <Badge key={e.id} variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 rounded-full px-3 py-1">
                {e.name ?? e.githubLogin ?? e.id}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {ctx.bugs.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 mb-5">
          <h2 className="text-sm font-semibold text-foreground mb-3">Linked bugs</h2>
          <div className="flex flex-col gap-2">
            {ctx.bugs.map(b => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{b.title ?? b.jiraId}</span>
                <div className="flex items-center gap-2">
                  {b.priority && (
                    <span className="text-xs text-muted-foreground capitalize">{b.priority}</span>
                  )}
                  {b.url && (
                    <a href={b.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
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
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-3">Affected services</h2>
          <div className="flex flex-wrap gap-2">
            {ctx.services.map(s => (
              <Badge key={s.id} variant="secondary" className="rounded-full px-3 py-1">
                {s.name ?? s.id}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
