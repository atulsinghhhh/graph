'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { timeAgo } from '@/components/reports/ToolReportPage';
import BreakGraph, { type BreakGraphNode, type BreakGraphEdge, type GraphState } from '@/components/marketing/BreakGraph';

interface OverviewReport {
  tool: string;
  scanned_at: string;
  items_scanned: number;
  issues_found: any[];
  critical_count: number;
  high_count: number;
  summary_text: string | null;
  raw_stats: Record<string, any>;
}

interface Overview {
  reports: Record<string, OverviewReport>;
  criticalIssues: any[];
}

const TOOL_LINKS: Record<string, string> = {
  github: '/github/report',
  jira: '/jira/report',
  slack: '/slack/report',
  pagerduty: '/pagerduty/report',
  linear: '/linear/report',
  datadog: '/datadog/report',
};

function metricLine(tool: string, report: OverviewReport | undefined): string {
  if (!report) return 'Not connected or not scanned yet';
  const issues = report.issues_found ?? [];
  const count = (types: string[]) => issues.filter((i: any) => types.includes(i.type)).length;

  switch (tool) {
    case 'github':
      return `${report.items_scanned} repos · ${issues.length} issues · last scan ${timeAgo(report.scanned_at)}`;
    case 'jira':
      return `${count(['stale_incident', 'sla_breach'])} open incidents · ${count(['sla_breach'])} SLA breaches`;
    case 'slack':
      return `${count(['unresolved_incident_channel'])} active incident channels`;
    case 'pagerduty':
      return `${count(['unacknowledged_page'])} active pages`;
    case 'linear': {
      const cycle = report.raw_stats?.cycles?.[0];
      return `${count(['blocked_issue'])} blocked issues${cycle ? ` · cycle ${cycle.completionRate}% complete` : ''}`;
    }
    case 'datadog':
      return `${count(['prolonged_alert', 'no_data'])} active alerts · ${count(['slo_at_risk'])} SLOs at risk`;
    default:
      return '';
  }
}

function buildOverviewGraph(reports: Record<string, OverviewReport>): {
  nodes: BreakGraphNode[]; edges: BreakGraphEdge[]; state: GraphState; breakNodeId: string | null; cascadeIds: string[]; statusLabel: string;
} {
  const allIssues = Object.values(reports).flatMap(r => (r.issues_found ?? []).map((i: any) => ({ ...i, __tool: r.tool })));

  const priorityOrder = [
    { type: 'secret', label: 'a leaked secret' },
    { type: 'sla_breach', label: 'an SLA breach' },
    { type: 'unacknowledged_page', label: 'an unacknowledged page' },
    { type: 'prolonged_alert', label: 'an active alert' },
  ];

  for (const p of priorityOrder) {
    const found = allIssues.find(i => i.type === p.type);
    if (found) {
      return {
        nodes: [
          { id: 'source', label: found.__tool.charAt(0).toUpperCase() + found.__tool.slice(1), sub: found.title.slice(0, 24), x: 0.5, y: 0.2 },
          { id: 'break', label: 'Break point', sub: p.label, x: 0.5, y: 0.5 },
          { id: 'impact', label: 'Impact', sub: 'cascading', x: 0.5, y: 0.8 },
        ],
        edges: [{ from: 'source', to: 'break' }, { from: 'break', to: 'impact' }],
        state: 'broken',
        breakNodeId: 'break',
        cascadeIds: ['impact'],
        statusLabel: found.title,
      };
    }
  }

  return {
    nodes: [{ id: 'all', label: 'All tools', sub: 'healthy', x: 0.5, y: 0.5 }],
    edges: [],
    state: 'healthy',
    breakNodeId: null,
    cascadeIds: [],
    statusLabel: 'No critical issues across any connected tool',
  };
}

export default function ReportsOverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);

  function load() {
    api.get('/api/reports/overview').then(r => setOverview(r.data)).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  async function acknowledge(id: string) {
    await api.post(`/api/reports/issue/${id}/acknowledge`, {});
    load();
  }
  async function resolve(id: string) {
    await api.post(`/api/reports/issue/${id}/resolve`);
    load();
  }

  const graph = useMemo(() => buildOverviewGraph(overview?.reports ?? {}), [overview]);

  return (
    <div className="p-8 max-w-4xl flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground mb-1">Reports</h1>
        <p className="text-sm text-muted-foreground">A unified view of every connected tool's deep scans.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Object.keys(TOOL_LINKS).map(tool => (
          <Link
            key={tool}
            href={TOOL_LINKS[tool]}
            className="rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-colors"
          >
            <p className="text-sm font-medium text-foreground capitalize mb-1">{tool}</p>
            <p className="text-xs text-muted-foreground">{metricLine(tool, overview?.reports[tool])}</p>
          </Link>
        ))}
      </div>

      {overview && (
        <BreakGraph
          interactive={false}
          nodes={graph.nodes}
          edges={graph.edges}
          state={graph.state}
          breakNodeId={graph.breakNodeId}
          cascadeIds={graph.cascadeIds}
          statusLabel={graph.statusLabel}
        />
      )}

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          All critical issues ({overview?.criticalIssues.length ?? 0})
        </p>
        {overview && overview.criticalIssues.length > 0 ? (
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {overview.criticalIssues.map((issue: any) => (
              <div key={issue.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-3">
                  <Badge variant="outline" className="capitalize shrink-0">{issue.source}</Badge>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{issue.title}</p>
                    <p className="text-xs text-muted-foreground">{timeAgo(issue.detectedAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => acknowledge(issue.id)} className="text-xs text-muted-foreground hover:text-foreground">Acknowledge</button>
                  <button onClick={() => resolve(issue.id)} className="text-xs text-primary hover:underline">Resolve</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No critical issues across any connected tool.</p>
        )}
      </div>
    </div>
  );
}
