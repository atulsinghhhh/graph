'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

export type BreakPoint = 'pr' | 'deployment' | 'service' | null;

interface Engineer { id: string; name?: string; githubLogin?: string; avatarUrl?: string }
interface PullRequestT { id: string; githubId?: string; title?: string; url?: string; branch?: string; mergedAt?: string }
interface DeploymentT { id: string; version?: string; environment?: string; deployedAt?: string; status?: string; confidence?: number | null }
interface ServiceT { id: string; name?: string }
interface AlertT { id: string; metric?: string; message?: string; firedAt?: string; status?: string }
interface IncidentT { id: string; title: string; severity?: string; status?: string; startedAt: string; resolvedAt?: string; source?: string }
interface BugT { id: string; jiraId?: string; title?: string; priority?: string; url?: string }

export interface IncidentGraphContext {
  incident: IncidentT;
  deployments: DeploymentT[];
  pullRequests: PullRequestT[];
  engineers: Engineer[];
  services: ServiceT[];
  alerts: AlertT[];
  bugs: BugT[];
  fix: { fixDeployment: DeploymentT; fixPullRequest: PullRequestT | null } | null;
}

interface Props {
  incident: IncidentGraphContext;
  breakPoint: BreakPoint;
  cascadeNodes: string[];
}

type NodeState = 'healthy' | 'break' | 'cascade' | 'resolved';

interface ChainNode {
  kind: string;
  title: string;
  subtitle?: string;
  timestamp?: string;
  url?: string;
  state: NodeState;
  raw: Record<string, unknown>;
}

type Row =
  | { type: 'single'; node: ChainNode }
  | { type: 'pair'; left: ChainNode; right: ChainNode };

const NODE_W = 160;
const NODE_H = 52;
const GAP = 60;
const STEP = NODE_H + GAP;
const PAIR_GAP = 20;
const TOP_MARGIN = 26;
const BOTTOM_MARGIN = 20;
const SVG_W = 480;

const STATE_STYLE: Record<NodeState, { fill: string; stroke: string; strokeWidth: number; dashed?: boolean }> = {
  healthy:  { fill: '#F1EFE8', stroke: '#5F5E5A', strokeWidth: 1 },
  break:    { fill: '#FCEBEB', stroke: '#A32D2D', strokeWidth: 2 },
  cascade:  { fill: '#FAEEDA', stroke: '#854F0B', strokeWidth: 1, dashed: true },
  resolved: { fill: '#EAF3DE', stroke: '#3B6D11', strokeWidth: 1 },
};

const STATE_LABEL: Record<NodeState, string> = {
  healthy: 'Healthy',
  break: 'Break point',
  cascade: 'Cascade',
  resolved: 'Resolved',
};

const STATE_BADGE_CLASS: Record<NodeState, string> = {
  healthy: 'border-transparent bg-success/15 text-success',
  break: 'border-transparent bg-destructive/15 text-destructive',
  cascade: 'border-transparent bg-warning/15 text-warning',
  resolved: 'border-transparent bg-success/15 text-success',
};

function truncate(s: string | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatTime(ts?: string): string | undefined {
  if (!ts) return undefined;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function stateFor(kind: string, breakPoint: BreakPoint, cascadeNodes: string[]): NodeState {
  if (breakPoint && kind === breakPoint) return 'break';
  if (cascadeNodes.includes(kind)) return 'cascade';
  if (kind === 'fix') return 'resolved';
  return 'healthy';
}

function askAiQuestion(node: ChainNode, incidentTitle: string): string {
  switch (node.kind) {
    case 'engineer': return `What has ${node.title} worked on related to the "${incidentTitle}" incident?`;
    case 'pr': return `What did ${node.title} change and how did it cause the "${incidentTitle}" incident?`;
    case 'deployment': return `What happened during ${node.title} that caused the "${incidentTitle}" incident?`;
    case 'service': return `Why did ${node.title} fail during the "${incidentTitle}" incident?`;
    case 'alert': return `What triggered the alert "${node.subtitle ?? node.title}" during the "${incidentTitle}" incident?`;
    case 'incident': return `Give me a full summary of the "${incidentTitle}" incident.`;
    case 'bug': return `What is the status of ${node.title} linked to the "${incidentTitle}" incident?`;
    case 'fix': return `How did ${node.title} resolve the "${incidentTitle}" incident?`;
    default: return `Tell me more about the "${incidentTitle}" incident.`;
  }
}

function buildRows(ctx: IncidentGraphContext, breakPoint: BreakPoint, cascadeNodes: string[]): Row[] {
  const state = (kind: string) => stateFor(kind, breakPoint, cascadeNodes);
  const rows: Row[] = [];

  const engineer = ctx.engineers[0];
  if (engineer) {
    rows.push({
      type: 'single',
      node: {
        kind: 'engineer',
        title: truncate(engineer.name ?? engineer.githubLogin ?? 'Engineer', 22),
        subtitle: engineer.githubLogin ? `@${engineer.githubLogin}` : 'Author',
        state: state('engineer'),
        raw: engineer as unknown as Record<string, unknown>,
      },
    });
  }

  const pr = ctx.pullRequests[0];
  if (pr || breakPoint === 'pr') {
    rows.push({
      type: 'single',
      node: {
        kind: 'pr',
        title: pr ? `PR #${pr.githubId ?? pr.id}` : 'Pull Request',
        subtitle: truncate(pr?.title, 26),
        timestamp: pr?.mergedAt,
        url: pr?.url,
        state: state('pr'),
        raw: (pr ?? {}) as unknown as Record<string, unknown>,
      },
    });
  }

  const deployment = ctx.deployments[0];
  if (deployment || breakPoint === 'deployment') {
    rows.push({
      type: 'single',
      node: {
        kind: 'deployment',
        title: deployment?.version ? `Deploy ${deployment.version}` : 'Deployment',
        subtitle: deployment?.environment,
        timestamp: deployment?.deployedAt,
        state: state('deployment'),
        raw: (deployment ?? {}) as unknown as Record<string, unknown>,
      },
    });
  }

  const service = ctx.services[0];
  const showService = !!service || breakPoint === 'service' || cascadeNodes.includes('service');
  if (showService) {
    rows.push({
      type: 'single',
      node: {
        kind: 'service',
        title: truncate(service?.name ?? 'Affected service', 22),
        subtitle: service ? 'Service' : 'Not traced in graph',
        state: state('service'),
        raw: (service ?? {}) as unknown as Record<string, unknown>,
      },
    });
  }

  const alert = ctx.alerts[0];
  const incident = ctx.incident;
  const showAlert = !!alert || cascadeNodes.includes('alert');
  const alertNode: ChainNode = {
    kind: 'alert',
    title: 'Alert',
    subtitle: truncate(alert?.metric ?? alert?.message, 24),
    timestamp: alert?.firedAt,
    state: state('alert'),
    raw: (alert ?? {}) as unknown as Record<string, unknown>,
  };
  const incidentNode: ChainNode = {
    kind: 'incident',
    title: truncate(incident.title, 22),
    subtitle: incident.severity,
    timestamp: incident.startedAt,
    state: state('incident'),
    raw: incident as unknown as Record<string, unknown>,
  };
  if (showAlert) {
    rows.push({ type: 'pair', left: alertNode, right: incidentNode });
  } else {
    rows.push({ type: 'single', node: incidentNode });
  }

  const bug = ctx.bugs[0];
  if (bug || cascadeNodes.includes('bug')) {
    rows.push({
      type: 'single',
      node: {
        kind: 'bug',
        title: bug?.jiraId ?? 'Bug',
        subtitle: truncate(bug?.title, 26),
        url: bug?.url,
        state: state('bug'),
        raw: (bug ?? {}) as unknown as Record<string, unknown>,
      },
    });
  }

  if (ctx.fix && incident.status === 'resolved') {
    const { fixDeployment, fixPullRequest } = ctx.fix;
    rows.push({
      type: 'single',
      node: {
        kind: 'fix',
        title: fixPullRequest
          ? `Rollback PR #${fixPullRequest.githubId ?? fixPullRequest.id}`
          : `Fix deploy ${fixDeployment.version ?? ''}`,
        subtitle: fixPullRequest ? truncate(fixPullRequest.title, 26) : fixDeployment.environment,
        timestamp: fixDeployment.deployedAt,
        url: fixPullRequest?.url,
        state: 'resolved',
        raw: (fixPullRequest ?? fixDeployment) as unknown as Record<string, unknown>,
      },
    });
  }

  return rows;
}

function edgeStyle(from: NodeState, to: NodeState): { stroke: string; dash?: string; marker: string } {
  if (from === 'break') return { stroke: '#A32D2D', dash: '6 4', marker: 'red' };
  if (from === 'cascade' && to === 'cascade') return { stroke: '#854F0B', dash: '4 3', marker: 'amber' };
  if (to === 'resolved') return { stroke: '#3B6D11', marker: 'green' };
  return { stroke: '#A8A59C', marker: 'gray' };
}

function NodeBox({
  node, x, y, selected, onClick,
}: {
  node: ChainNode; x: number; y: number; selected: boolean; onClick: () => void;
}) {
  const style = STATE_STYLE[node.state];
  const cx = x + NODE_W / 2;
  return (
    <g
      onClick={onClick}
      className="cursor-pointer"
      role="button"
      aria-label={`${node.title} — ${STATE_LABEL[node.state]}`}
    >
      {node.state === 'break' && (
        <text x={cx} y={y - 10} textAnchor="middle" fontSize={12} fill="#A32D2D" fontWeight={600}>
          ⚠ break point
        </text>
      )}
      {node.state === 'cascade' && (
        <text x={cx} y={y - 10} textAnchor="middle" fontSize={12} fill="#633806">
          ↓ cascade
        </text>
      )}
      <rect
        x={x} y={y} width={NODE_W} height={NODE_H} rx={8}
        fill={style.fill}
        stroke={style.stroke}
        strokeWidth={selected ? style.strokeWidth + 1.5 : style.strokeWidth}
        strokeDasharray={style.dashed ? '4 3' : undefined}
      />
      <text x={cx} y={y + 21} textAnchor="middle" fontSize={11} fontWeight={600} fill="#26251F">
        {node.title || '—'}
      </text>
      {node.subtitle && (
        <text x={cx} y={y + 35} textAnchor="middle" fontSize={9.5} fill="#5F5E5A">
          {node.subtitle}
        </text>
      )}
      {node.state === 'break' && node.timestamp && formatTime(node.timestamp) && (
        <text x={cx} y={y + NODE_H + 13} textAnchor="middle" fontSize={10} fill="#A32D2D">
          Broke at {formatTime(node.timestamp)}
        </text>
      )}
    </g>
  );
}

export default function IncidentGraph({ incident, breakPoint, cascadeNodes }: Props) {
  const [selected, setSelected] = useState<ChainNode | null>(null);
  const rows = buildRows(incident, breakPoint, cascadeNodes);

  const centerX = SVG_W / 2;
  const singleX = centerX - NODE_W / 2;
  const leftX = centerX - PAIR_GAP / 2 - NODE_W;
  const rightX = centerX + PAIR_GAP / 2;

  const rowY = rows.map((_, i) => TOP_MARGIN + i * STEP);
  const svgHeight = rows.length > 0
    ? rowY[rows.length - 1] + NODE_H + BOTTOM_MARGIN + 16
    : TOP_MARGIN + BOTTOM_MARGIN;

  function nodeCenterX(row: Row, side?: 'left' | 'right'): number {
    if (row.type === 'single') return centerX;
    return side === 'left' ? leftX + NODE_W / 2 : rightX + NODE_W / 2;
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h2 className="text-sm font-semibold text-foreground mb-4">Incident graph</h2>
      <svg viewBox={`0 0 ${SVG_W} ${svgHeight}`} width="100%" height={svgHeight} role="img" aria-label="Incident break and cascade graph">
        <defs>
          {(['gray', 'red', 'amber', 'green'] as const).map(c => (
            <marker
              key={c}
              id={`arrow-${c}`}
              viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill={{ gray: '#A8A59C', red: '#A32D2D', amber: '#854F0B', green: '#3B6D11' }[c]} />
            </marker>
          ))}
        </defs>

        {/* Edges */}
        {rows.slice(1).map((row, i) => {
          const prevRow = rows[i];
          const yFrom = rowY[i] + NODE_H;
          const yTo = rowY[i + 1];
          const edges: React.ReactNode[] = [];

          const prevNodes = prevRow.type === 'single'
            ? [{ node: prevRow.node, x: nodeCenterX(prevRow) }]
            : [{ node: prevRow.left, x: nodeCenterX(prevRow, 'left') }, { node: prevRow.right, x: nodeCenterX(prevRow, 'right') }];
          const curNodes = row.type === 'single'
            ? [{ node: row.node, x: nodeCenterX(row) }]
            : [{ node: row.left, x: nodeCenterX(row, 'left') }, { node: row.right, x: nodeCenterX(row, 'right') }];

          // Converging pair -> single (e.g. Alert/Incident -> Bug): curved paths
          if (prevNodes.length === 2 && curNodes.length === 1) {
            for (const p of prevNodes) {
              const es = edgeStyle(p.node.state, curNodes[0].node.state);
              const midY = (yFrom + yTo) / 2;
              edges.push(
                <path
                  key={`${p.node.kind}-${curNodes[0].node.kind}`}
                  d={`M ${p.x} ${yFrom} C ${p.x} ${midY}, ${curNodes[0].x} ${midY}, ${curNodes[0].x} ${yTo}`}
                  fill="none" stroke={es.stroke} strokeWidth={1.5}
                  strokeDasharray={es.dash}
                  markerEnd={`url(#arrow-${es.marker})`}
                />
              );
            }
            return <g key={i}>{edges}</g>;
          }

          // Diverging single -> pair (e.g. Service -> Alert/Incident): straight branches
          if (prevNodes.length === 1 && curNodes.length === 2) {
            for (const c of curNodes) {
              const es = edgeStyle(prevNodes[0].node.state, c.node.state);
              edges.push(
                <line
                  key={`${prevNodes[0].node.kind}-${c.node.kind}`}
                  x1={prevNodes[0].x} y1={yFrom} x2={c.x} y2={yTo}
                  stroke={es.stroke} strokeWidth={1.5} strokeDasharray={es.dash}
                  markerEnd={`url(#arrow-${es.marker})`}
                />
              );
            }
            return <g key={i}>{edges}</g>;
          }

          // Single -> single
          const es = edgeStyle(prevNodes[0].node.state, curNodes[0].node.state);
          return (
            <line
              key={i}
              x1={prevNodes[0].x} y1={yFrom} x2={curNodes[0].x} y2={yTo}
              stroke={es.stroke} strokeWidth={1.5} strokeDasharray={es.dash}
              markerEnd={`url(#arrow-${es.marker})`}
            />
          );
        })}

        {/* Nodes */}
        {rows.map((row, i) => {
          if (row.type === 'single') {
            return (
              <NodeBox
                key={row.node.kind}
                node={row.node}
                x={singleX}
                y={rowY[i]}
                selected={selected?.kind === row.node.kind}
                onClick={() => setSelected(row.node)}
              />
            );
          }
          return (
            <g key={`${row.left.kind}-${row.right.kind}`}>
              <NodeBox
                node={row.left}
                x={leftX}
                y={rowY[i]}
                selected={selected?.kind === row.left.kind}
                onClick={() => setSelected(row.left)}
              />
              <NodeBox
                node={row.right}
                x={rightX}
                y={rowY[i]}
                selected={selected?.kind === row.right.kind}
                onClick={() => setSelected(row.right)}
              />
            </g>
          );
        })}
      </svg>

      {selected && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex items-center gap-2 mb-2">
            <Badge className={STATE_BADGE_CLASS[selected.state]}>{STATE_LABEL[selected.state]}</Badge>
            <span className="text-xs text-muted-foreground uppercase tracking-wide">{selected.kind}</span>
          </div>
          <h3 className="text-sm font-semibold text-foreground">{selected.title}</h3>
          {selected.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{selected.subtitle}</p>}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3">
            {Object.entries(selected.raw)
              .filter(([k, v]) => v != null && v !== '' && !['orgId', 'syncedAt'].includes(k))
              .slice(0, 8)
              .map(([k, v]) => (
                <div key={k} className="text-xs">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-foreground truncate">{String(v)}</dd>
                </div>
              ))}
          </dl>

          <div className="mt-3 flex items-center gap-3">
            {selected.url && (
              <a href={selected.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                Open source →
              </a>
            )}
            <Link
              href={`/chat?q=${encodeURIComponent(askAiQuestion(selected, incident.incident.title))}`}
              className="text-xs text-primary hover:underline"
            >
              Ask AI about this →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
