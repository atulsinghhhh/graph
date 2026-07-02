'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Incident {
  id: string;
  title: string;
  severity: string;
  status: string;
  startedAt: string;
  resolvedAt?: string;
  source?: string;
}

interface IncidentCtx {
  incident: Incident;
  deployments: Array<{ id: string; version?: string; environment?: string; deployedAt?: string; confidence?: number }>;
  pullRequests: Array<{ id: string; githubId?: string; title?: string; url?: string; mergedAt?: string }>;
  engineers: Array<{ id: string; name?: string; githubLogin?: string }>;
  bugs: Array<{ id: string; jiraId?: string; title?: string; priority?: string; url?: string }>;
  alerts: Array<{ id: string; metric?: string; firedAt?: string; status?: string }>;
  services: Array<{ id: string; name?: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return 'just now';
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

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ incidentId, onClose }: { incidentId: string; onClose: () => void }) {
  const [ctx, setCtx] = useState<IncidentCtx | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setCtx(null);
    setError('');
    setLoading(true);
    api.get<IncidentCtx>(`/api/incidents/${encodeURIComponent(incidentId)}`)
      .then(r => setCtx(r.data))
      .catch((e: any) => setError(e.response?.data?.error ?? e.message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, [incidentId]);

  return (
    <div className="flex flex-col h-full border-l border-border bg-card overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <span className="text-sm font-semibold text-foreground">Incident detail</span>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="px-5 py-5 flex flex-col gap-5 flex-1">
        {loading && (
          <div className="animate-pulse flex flex-col gap-3">
            <div className="h-5 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted rounded w-1/3" />
            <div className="h-24 bg-muted rounded-xl mt-2" />
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg px-4 py-3 text-sm bg-destructive/10 text-destructive border border-destructive/30">
            {error}
          </div>
        )}

        {ctx && !loading && (() => {
          const inc = ctx.incident;
          return (
            <>
              {/* Title + badges */}
              <div>
                <h2 className="text-base font-semibold text-foreground mb-2">{inc.title}</h2>
                <div className="flex flex-wrap gap-2">
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
                  {inc.source && (
                    <Badge variant="secondary" className="text-muted-foreground">{inc.source}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Started {new Date(inc.startedAt).toLocaleString()}
                  {inc.resolvedAt && ` · resolved ${new Date(inc.resolvedAt).toLocaleString()}`}
                </p>
              </div>

              {/* Engineers */}
              {ctx.engineers.length > 0 && (
                <Section title="Engineers involved">
                  <div className="flex flex-wrap gap-1.5">
                    {ctx.engineers.map(e => (
                      <Badge key={e.id} variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 rounded-full px-3 py-1">
                        {e.name ?? e.githubLogin ?? e.id}
                      </Badge>
                    ))}
                  </div>
                </Section>
              )}

              {/* Deployments */}
              {ctx.deployments.length > 0 && (
                <Section title="Linked deployments">
                  {ctx.deployments.map(d => (
                    <Row key={d.id} main={d.version ?? d.id} sub={d.environment ?? ''}>
                      {d.confidence != null && (
                        <span className="text-xs text-blue-400">{Math.round(d.confidence * 100)}% confidence</span>
                      )}
                    </Row>
                  ))}
                </Section>
              )}

              {/* Bugs */}
              {ctx.bugs.length > 0 && (
                <Section title="Linked bugs">
                  {ctx.bugs.map(b => (
                    <Row key={b.id}
                      main={b.title ?? b.jiraId ?? b.id}
                      sub={b.priority ? `Priority: ${b.priority}` : ''}>
                      {b.url && (
                        <a href={b.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                          {b.jiraId}
                        </a>
                      )}
                      {!b.url && b.jiraId && (
                        <span className="text-xs text-muted-foreground">{b.jiraId}</span>
                      )}
                    </Row>
                  ))}
                </Section>
              )}

              {/* Alerts */}
              {ctx.alerts.length > 0 && (
                <Section title="Alerts">
                  {ctx.alerts.map(a => (
                    <Row key={a.id}
                      main={a.metric ?? a.id}
                      sub={a.firedAt ? `Fired ${timeAgo(a.firedAt)}` : ''}>
                      <span className={cn('text-xs px-2 py-0.5 rounded-full', a.status === 'Alert' ? 'bg-pink-500/10 text-pink-400' : 'bg-muted text-muted-foreground')}>
                        {a.status}
                      </span>
                    </Row>
                  ))}
                </Section>
              )}

              {/* Services */}
              {ctx.services.length > 0 && (
                <Section title="Affected services">
                  <div className="flex flex-wrap gap-1.5">
                    {ctx.services.map(s => (
                      <Badge key={s.id} variant="outline" className="bg-teal-500/10 text-teal-400 border-teal-500/30 rounded-full px-3 py-1">
                        {s.name ?? s.id}
                      </Badge>
                    ))}
                  </div>
                </Section>
              )}

              {/* Pull requests */}
              {ctx.pullRequests.length > 0 && (
                <Section title="Pull requests">
                  {ctx.pullRequests.map(pr => (
                    <Row key={pr.id}
                      main={pr.title ?? `PR #${pr.githubId}`}
                      sub={pr.mergedAt ? `Merged ${timeAgo(pr.mergedAt)}` : ''}>
                      {pr.url && (
                        <a href={pr.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">View</a>
                      )}
                    </Row>
                  ))}
                </Section>
              )}

              {/* Empty state */}
              {ctx.engineers.length === 0 && ctx.deployments.length === 0 && ctx.bugs.length === 0 && (
                <p className="text-sm text-muted-foreground">No related data linked yet. Run a sync to enrich this incident.</p>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ── Small reusable layout components ─────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Row({ main, sub, children }: { main: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm bg-muted rounded-lg px-3 py-2">
      <div className="flex flex-col gap-0.5 min-w-0 mr-3">
        <span className="text-foreground font-medium truncate">{main}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    api.get<Incident[]>('/api/incidents')
      .then(r => setIncidents(r.data))
      .catch((err: any) => setError(err.response?.data?.error ?? err.message ?? 'Failed to load incidents'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-full">
      {/* ── Left: incident list ── */}
      <div className={cn('flex flex-col overflow-y-auto p-6 transition-all', selectedId ? 'w-80 shrink-0' : 'flex-1')}>
        <h1 className="text-xl font-semibold text-foreground mb-1">Incidents</h1>
        <p className="text-sm text-muted-foreground mb-5">All incidents synced from your connected tools.</p>

        {error && (
          <div className="mb-4 rounded-lg px-4 py-3 text-sm bg-destructive/10 text-destructive border border-destructive/30">{error}</div>
        )}

        {loading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-card border border-border rounded-xl px-5 py-4 animate-pulse">
                <div className="h-4 bg-muted rounded w-2/3 mb-2" />
                <div className="h-3 bg-muted rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : incidents.length === 0 && !error ? (
          <div className="text-center py-16 border border-dashed border-border rounded-xl text-muted-foreground text-sm">
            <p className="mb-1">No incidents found.</p>
            <p>Run a sync to pull incident data.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {incidents.map(inc => (
              <button
                key={inc.id}
                onClick={() => setSelectedId(inc.id === selectedId ? null : inc.id)}
                className={cn(
                  'text-left w-full bg-card border rounded-xl px-5 py-4 transition-colors',
                  selectedId === inc.id
                    ? 'border-primary ring-1 ring-primary'
                    : 'border-border hover:border-muted-foreground/50'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-sm font-medium text-foreground truncate">{inc.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(inc.startedAt)}
                      {inc.source && ` · ${inc.source}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className={cn('capitalize', SEVERITY_COLOR[inc.severity] ?? SEVERITY_COLOR.low)}>
                      {inc.severity}
                    </Badge>
                    <Badge variant="outline" className={cn('capitalize border-transparent', STATUS_COLOR[inc.status] ?? STATUS_COLOR.open)}>
                      {inc.status}
                    </Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Right: detail panel ── */}
      {selectedId && (
        <div className="flex-1 overflow-hidden">
          <DetailPanel incidentId={selectedId} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  );
}
