'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import BreakGraph, { type BreakGraphNode, type BreakGraphEdge, type GraphState } from '@/components/marketing/BreakGraph';

interface Issue {
  repo: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  fixSuggestion: string;
  nodeId: string;
  url?: string;
}

interface HourlyReport {
  id: string;
  scanned_at: string;
  repos_scanned: number;
  issues_found: Issue[];
  secrets_found: number;
  ci_failures: number;
  pr_issues: number;
  repo_health: number;
  summary_text: string | null;
}

interface SecretRow {
  incident: {
    id: string; repo: string; filePath: string; secretType: string;
    pushedBy: string | null; detectedAt: string; fixSuggestion: string; status: string;
  };
}

// ── Dev Insights tab (AI risk analysis of recently merged PRs) ────────────────
interface InsightIncident { title: string; severity: string }
interface InsightBug      { jiraId: string; title: string; priority: string }

interface Insight {
  prNumber: number;
  prTitle: string;
  prUrl?: string;
  engineer: string;
  mergedAt?: string;
  services: string[];
  linkedIncidents: InsightIncident[];
  linkedBugs: InsightBug[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  potentialIssues: string[];
  fixSuggestions: string[];
}

const RISK_BADGE_STYLE: Record<string, string> = {
  low: 'bg-success/10 text-success border-success/30',
  medium: 'bg-warning/10 text-warning border-warning/30',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  critical: 'bg-destructive/10 text-destructive border-destructive/30',
};

function timeAgoOrNow(iso?: string) {
  if (!iso) return '';
  return timeAgo(iso);
}

// ── Secrets tab (org-wide SecretAlert feed, not just the top banner above) ────
interface SecretAlertRow {
  alert: Record<string, any>;
  engineers: Record<string, any>[];
  services: Record<string, any>[];
  pullRequests: Record<string, any>[];
  incidents: (Record<string, any> & { confidence: number | null })[];
}

const PR_ISSUE_TYPES = ['failing_checks', 'merge_conflict', 'stale', 'large_pr', 'no_review'];
const REPO_SECURITY_TYPES = ['no_branch_protection', 'vulnerability', 'missing_gitignore'];

const PR_BADGE_STYLE: Record<string, string> = {
  failing_checks: 'bg-destructive/10 text-destructive border-destructive/30',
  merge_conflict: 'bg-warning/10 text-warning border-warning/30',
  stale: 'bg-muted text-muted-foreground border-border',
  large_pr: 'bg-primary/10 text-primary border-primary/30',
  no_review: 'bg-accent text-accent-foreground border-border',
};

const PR_BADGE_LABEL: Record<string, string> = {
  failing_checks: 'Failing checks',
  merge_conflict: 'Conflict',
  stale: 'Stale',
  large_pr: 'Large',
  no_review: 'Awaiting review',
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

function minutesUntilNextScan(scannedAt: string): number {
  const next = new Date(scannedAt).getTime() + 60 * 60 * 1000;
  return Math.max(0, Math.round((next - Date.now()) / 60_000));
}

function buildReportGraph(report: HourlyReport | null): {
  nodes: BreakGraphNode[]; edges: BreakGraphEdge[]; state: GraphState; breakNodeId: string | null; cascadeIds: string[]; statusLabel: string;
} {
  if (!report || report.issues_found.length === 0) {
    return {
      nodes: [{ id: 'repos', label: 'Repositories', sub: report ? `${report.repos_scanned} scanned` : 'no scan yet', x: 0.5, y: 0.5 }],
      edges: [],
      state: 'healthy',
      breakNodeId: null,
      cascadeIds: [],
      statusLabel: 'All repositories healthy',
    };
  }

  const secretIssue = report.issues_found.find(i => i.type === 'secret');
  if (secretIssue) {
    const sha = secretIssue.nodeId.split(':')[2]?.slice(0, 7) ?? 'unknown';
    return {
      nodes: [
        { id: 'repo', label: 'Repository', sub: secretIssue.repo, x: 0.5, y: 0.15 },
        { id: 'commit', label: 'Commit', sub: sha, x: 0.5, y: 0.5 },
        { id: 'incident', label: 'Security Incident', sub: 'critical', x: 0.5, y: 0.85 },
      ],
      edges: [{ from: 'repo', to: 'commit' }, { from: 'commit', to: 'incident' }],
      state: 'broken',
      breakNodeId: 'commit',
      cascadeIds: ['incident'],
      statusLabel: `${report.secrets_found} secret${report.secrets_found === 1 ? '' : 's'} exposed`,
    };
  }

  const ciIssue = report.issues_found.find(i => i.type === 'ci_failure');
  if (ciIssue) {
    return {
      nodes: [
        { id: 'repo', label: 'Repository', sub: ciIssue.repo, x: 0.5, y: 0.15 },
        { id: 'workflow', label: 'Workflow Run', sub: ciIssue.title.slice(0, 20), x: 0.5, y: 0.5 },
        { id: 'pr', label: 'Pull Request', sub: 'affected', x: 0.5, y: 0.85 },
      ],
      edges: [{ from: 'repo', to: 'workflow' }, { from: 'workflow', to: 'pr' }],
      state: 'broken',
      breakNodeId: 'workflow',
      cascadeIds: ['pr'],
      statusLabel: `${report.ci_failures} CI failure${report.ci_failures === 1 ? '' : 's'}`,
    };
  }

  const prIssue = report.issues_found.find(i => PR_ISSUE_TYPES.includes(i.type));
  if (prIssue) {
    return {
      nodes: [
        { id: 'repo', label: 'Repository', sub: prIssue.repo, x: 0.5, y: 0.3 },
        { id: 'pr', label: 'Pull Request', sub: PR_BADGE_LABEL[prIssue.type] ?? prIssue.type, x: 0.5, y: 0.7 },
      ],
      edges: [{ from: 'repo', to: 'pr' }],
      state: 'broken',
      breakNodeId: 'pr',
      cascadeIds: [],
      statusLabel: `${report.pr_issues} PR issue${report.pr_issues === 1 ? '' : 's'}`,
    };
  }

  return {
    nodes: [
      { id: 'repo', label: 'Repository', sub: report.issues_found[0]?.repo ?? '', x: 0.5, y: 0.3 },
      { id: 'health', label: 'Repo Health', sub: 'attention needed', x: 0.5, y: 0.7 },
    ],
    edges: [{ from: 'repo', to: 'health' }],
    state: 'broken',
    breakNodeId: 'health',
    cascadeIds: [],
    statusLabel: `${report.repo_health} repo health issue${report.repo_health === 1 ? '' : 's'}`,
  };
}

function IssueRow({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-b-0 py-3">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="text-sm text-foreground truncate">{issue.title}</p>
          <p className="text-xs text-muted-foreground">{issue.repo}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {issue.url && (
            <a href={issue.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline" onClick={e => e.stopPropagation()}>
              View
            </a>
          )}
          {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </div>
      </button>
      {open && (
        <p className="text-xs text-muted-foreground mt-2 bg-muted rounded-md px-3 py-2 leading-relaxed">
          {issue.fixSuggestion}
        </p>
      )}
    </div>
  );
}

export default function GithubReportPage() {
  const [report, setReport] = useState<HourlyReport | null>(null);
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<'ci' | 'pr' | 'security' | 'insights' | 'secrets' | 'repos'>('ci');
  const [repoHealth, setRepoHealth] = useState<any[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [secretAlerts, setSecretAlerts] = useState<SecretAlertRow[]>([]);

  function load() {
    Promise.all([
      api.get('/api/github/hourly-report').then(r => r.data).catch(() => null),
      api.get('/api/github/secrets').then(r => r.data).catch(() => []),
      api.get('/api/github/repo-health').then(r => r.data).catch(() => []),
      api.get('/api/insights').then(r => r.data).catch(() => []),
      api.get('/api/secrets').then(r => r.data).catch(() => []),
    ]).then(([reportData, secretsData, repoHealthData, insightsData, secretAlertsData]) => {
      setReport(reportData);
      setSecrets(secretsData ?? []);
      setRepoHealth(repoHealthData ?? []);
      setInsights(insightsData ?? []);
      setSecretAlerts(secretAlertsData ?? []);
      setLoaded(true);
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function markResolved(id: string) {
    await api.patch(`/api/github/secrets/${id}/resolve`);
    load();
  }

  const graph = useMemo(() => buildReportGraph(report), [report]);

  const ciIssues = report?.issues_found.filter(i => i.type === 'ci_failure') ?? [];
  const prIssues = report?.issues_found.filter(i => PR_ISSUE_TYPES.includes(i.type)) ?? [];
  const securityIssues = report?.issues_found.filter(i => REPO_SECURITY_TYPES.includes(i.type)) ?? [];

  const repoScores = useMemo(() => {
    return repoHealth.map((repo: any) => {
      const repoName = repo.name;
      const failingChecks = prIssues.filter(i => i.repo?.endsWith(repoName) && i.type === 'failing_checks').length;
      const secretCount = secrets.filter(s => s.incident.repo?.endsWith(repoName)).length;
      const staleCount = prIssues.filter(i => i.repo?.endsWith(repoName) && i.type === 'stale').length;
      const vulnCount = repo.vulnerabilityAlerts ?? 0;
      const score = Math.max(0, 100 - failingChecks * 10 - secretCount * 20 - staleCount * 5 - vulnCount * 15);
      return { ...repo, score };
    });
  }, [repoHealth, prIssues, secrets]);

  return (
    <div className="p-8 max-w-4xl flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground mb-1">GitHub Report</h1>
        {report ? (
          <p className="text-sm text-muted-foreground">
            Last scanned: {timeAgo(report.scanned_at)} · Next scan: in {minutesUntilNextScan(report.scanned_at)} minutes · {report.repos_scanned} repos scanned
          </p>
        ) : loaded ? (
          <p className="text-sm text-muted-foreground">No scan has run yet — the first hourly scan will run automatically.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </div>

      {secrets.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5">
          <p className="text-sm font-semibold text-destructive flex items-center gap-2 mb-3">
            <ShieldAlert className="size-4" />
            {secrets.length} secret{secrets.length === 1 ? '' : 's'} exposed in your repositories — immediate action required
          </p>
          <div className="flex flex-col gap-3">
            {secrets.map(s => (
              <SecretCard key={s.incident.id} row={s} onResolved={() => markResolved(s.incident.id)} />
            ))}
          </div>
        </div>
      )}

      <BreakGraph
        interactive={false}
        nodes={graph.nodes}
        edges={graph.edges}
        state={graph.state}
        breakNodeId={graph.breakNodeId}
        cascadeIds={graph.cascadeIds}
        statusLabel={graph.statusLabel}
      />

      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap gap-1 p-2 border-b border-border">
          {([
            ['ci', `CI/CD Health (${ciIssues.length})`],
            ['pr', `Pull Request Issues (${prIssues.length})`],
            ['security', `Repo Security (${securityIssues.length})`],
            ['insights', `Dev Insights (${insights.length})`],
            ['secrets', `Secrets (${secretAlerts.length})`],
            ['repos', `All Repos (${repoHealth.length})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm transition-colors',
                tab === key ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'ci' && (
            ciIssues.length > 0
              ? ciIssues.map(i => <IssueRow key={i.nodeId} issue={i} />)
              : <p className="text-sm text-muted-foreground">No CI/CD failures in the last scan.</p>
          )}

          {tab === 'pr' && (
            prIssues.length > 0 ? (
              <div className="flex flex-col gap-3">
                {prIssues.map(i => (
                  <div key={`${i.nodeId}-${i.type}`} className="border-b border-border last:border-b-0 pb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={cn('text-[11px]', PR_BADGE_STYLE[i.type])}>
                        {PR_BADGE_LABEL[i.type] ?? i.type}
                      </Badge>
                      <p className="text-sm text-foreground truncate">{i.title}</p>
                    </div>
                    <p className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2 mt-1">{i.fixSuggestion}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No open PR issues.</p>
          )}

          {tab === 'security' && (
            securityIssues.length > 0
              ? securityIssues.map(i => <IssueRow key={i.nodeId} issue={i} />)
              : <p className="text-sm text-muted-foreground">No repo security issues detected.</p>
          )}

          {tab === 'insights' && (
            insights.length > 0 ? (
              <div className="flex flex-col gap-4">
                {insights.map(ins => <InsightCard key={ins.prNumber} insight={ins} />)}
              </div>
            ) : <p className="text-sm text-muted-foreground">No merged pull requests found yet.</p>
          )}

          {tab === 'secrets' && (
            secretAlerts.length > 0 ? (
              <div className="flex flex-col gap-4">
                {secretAlerts.map((row, i) => <SecretAlertCard key={i} row={row} />)}
              </div>
            ) : <p className="text-sm text-muted-foreground">No secret scanning alerts found.</p>
          )}

          {tab === 'repos' && (
            repoScores.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {repoScores.map((repo: any) => (
                  <div key={repo.id ?? repo.name} className="rounded-lg border border-border p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{repo.name}</p>
                      <p className="text-xs text-muted-foreground">{repo.language ?? 'unknown'}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={cn(
                          'w-2.5 h-2.5 rounded-full',
                          repo.score >= 80 ? 'bg-success' : repo.score >= 50 ? 'bg-warning' : 'bg-destructive'
                        )}
                      />
                      <span className="text-sm text-muted-foreground">{repo.score}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No repos synced yet.</p>
          )}
        </div>
      </div>

      {report?.summary_text && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">AI Summary</p>
          <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap bg-card border border-border text-foreground rounded-bl-sm max-w-2xl">
            {report.summary_text}
          </div>
        </div>
      )}
    </div>
  );
}

function SecretCard({ row, onResolved }: { row: SecretRow; onResolved: () => void }) {
  const [open, setOpen] = useState(false);
  const { incident } = row;
  return (
    <div className="rounded-lg border border-destructive/30 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{incident.secretType} in {incident.repo}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {incident.filePath} · pushed by {incident.pushedBy ?? 'unknown'} · {timeAgo(incident.detectedAt)}
          </p>
        </div>
        <Badge variant="destructive" className="shrink-0">Critical</Badge>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <Button size="sm" variant="destructive" onClick={() => setOpen(v => !v)}>
          {open ? 'Hide fix' : 'Fix now'}
        </Button>
        <Button size="sm" variant="outline" onClick={onResolved}>
          Mark as resolved
        </Button>
      </div>
      {open && (
        <p className="text-xs text-foreground bg-muted rounded-md px-3 py-2 mt-3 leading-relaxed">
          {incident.fixSuggestion}
        </p>
      )}
    </div>
  );
}

function InsightCard({ insight: ins }: { insight: Insight }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-muted-foreground">#{ins.prNumber}</span>
            {ins.prUrl ? (
              <a href={ins.prUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-foreground hover:underline truncate">
                {ins.prTitle}
              </a>
            ) : (
              <span className="text-sm font-medium text-foreground truncate">{ins.prTitle}</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            by <span className="font-medium text-foreground">{ins.engineer}</span>
            {ins.mergedAt && <> · {timeAgoOrNow(ins.mergedAt)}</>}
            {ins.services.length > 0 && <> · {ins.services.join(', ')}</>}
          </p>
        </div>
        <Badge variant="outline" className={cn('shrink-0 uppercase text-[11px]', RISK_BADGE_STYLE[ins.riskLevel])}>
          {ins.riskLevel}
        </Badge>
      </div>

      <div className="px-4 py-3 flex flex-col gap-3">
        <p className="text-sm text-foreground">{ins.summary}</p>

        {(ins.linkedIncidents.length > 0 || ins.linkedBugs.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {ins.linkedIncidents.map((i, idx) => (
              <Badge key={idx} variant="destructive" className="text-[11px]">⚠ {i.title}</Badge>
            ))}
            {ins.linkedBugs.map((b, idx) => (
              <Badge key={idx} variant="outline" className="text-[11px] bg-warning/10 text-warning border-warning/30">
                {b.jiraId}: {b.title}
              </Badge>
            ))}
          </div>
        )}

        {ins.potentialIssues.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Potential Issues</p>
            <ul className="space-y-1">
              {ins.potentialIssues.map((issue, idx) => (
                <li key={idx} className="flex gap-2 text-sm text-muted-foreground">
                  <span className="text-warning mt-0.5 shrink-0">•</span>
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        )}

        {ins.fixSuggestions.length > 0 && (
          <div className="rounded-lg bg-muted px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">How to Fix for Future Pushes</p>
            <ol className="space-y-1.5 list-decimal list-inside">
              {ins.fixSuggestions.map((fix, idx) => (
                <li key={idx} className="text-sm text-foreground">{fix}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

function SecretAlertCard({ row }: { row: SecretAlertRow }) {
  const a = row.alert;
  if (!a) return null;
  const open = a.state === 'open';

  return (
    <div className={cn('rounded-xl border p-4', open ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-card')}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={open ? 'destructive' : 'success'} className="text-[10px] uppercase">
              {a.state}
            </Badge>
            {a.pushProtectionBypassed && open && (
              <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                Push protection bypassed
              </Badge>
            )}
            <span className="text-xs font-mono text-muted-foreground">#{a.alertNumber}</span>
          </div>
          <p className="font-semibold text-foreground text-sm">{a.secretType}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{a.repository}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">{a.createdAt ? timeAgo(a.createdAt) : ''}</p>
          {a.url && (
            <a href={a.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline mt-1 inline-block">
              View on GitHub →
            </a>
          )}
        </div>
      </div>

      {row.engineers.length > 0 && (
        <div className="rounded-lg bg-muted px-4 py-3 mb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Pushed by</p>
          <div className="flex flex-wrap gap-2">
            {row.engineers.map((e, ei) => (
              <Badge key={ei} variant="outline" className="text-xs">
                {e.name ?? e.githubLogin ?? 'Unknown'}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        {row.services.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Service</p>
            <p className="text-foreground font-medium">{row.services.map((s: any) => s.name).join(', ')}</p>
          </div>
        )}
        {a.resolution && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Resolution</p>
            <p className="text-foreground font-medium capitalize">{a.resolution}</p>
          </div>
        )}
        {a.commitSha && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Commit</p>
            <p className="text-foreground font-mono">{String(a.commitSha).slice(0, 8)}</p>
          </div>
        )}
        {a.updatedAt && (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Updated</p>
            <p className="text-foreground">{timeAgo(a.updatedAt)}</p>
          </div>
        )}
      </div>

      {row.incidents.length > 0 && (
        <div className="mt-3 rounded-lg bg-destructive/10 px-4 py-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-destructive mb-1.5">May have triggered</p>
          <div className="space-y-1">
            {row.incidents.map((inc: any, ii: number) => (
              <div key={ii} className="flex items-center justify-between text-xs">
                <span className="text-destructive font-medium">{inc.title ?? inc.id}</span>
                {inc.confidence != null && (
                  <span className="text-destructive font-mono">{Math.round(inc.confidence * 100)}% confidence</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
