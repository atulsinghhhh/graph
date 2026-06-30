'use client';

import { useEffect, useRef, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

// ── Colour palette per node type ─────────────────────────────────────────────
const NODE_COLOR: Record<string, string> = {
  Incident:    '#ef4444', // red
  Alert:       '#a855f7', // purple
  Bug:         '#f59e0b', // amber
  Deployment:  '#3b82f6', // blue
  PullRequest: '#06b6d4', // cyan
  Engineer:    '#22c55e', // green
  Service:     '#f97316', // orange
  SecretAlert: '#dc2626', // crimson
};

const LINK_COLOR: Record<string, string> = {
  TRIGGERED:          '#ef4444',
  FIRED:              '#a855f7',
  LINKED_TO:          '#f59e0b',
  INCLUDES:           '#3b82f6',
  AUTHORED_BY:        '#22c55e',
  CHANGED:            '#f97316',
  OWNS:               '#22c55e',
  DEPLOYED_TO:        '#64748b',
  ASSIGNED_TO:        '#94a3b8',
  HAS_SECRET_ALERT:   '#dc2626',
  PUSHED_SECRET:      '#b91c1c',
  INTRODUCED_SECRET:  '#ef4444',
  POSSIBLY_TRIGGERED: '#f87171',
};

function nodeLabel(node: any): string {
  return (
    node.title ??
    node.name ??
    node.version ??
    node.metric ??
    node.summary ??
    node.jiraId ??
    node.secretType ??
    (node.nodeId ? String(node.nodeId).split(':').pop() : '') ??
    node.type
  );
}

interface Props {
  nodes: any[];
  links: any[];
  onNodeClick: (node: any) => void;
}

export default function GraphCanvas({ nodes, links, onNodeClick }: Props) {
  const fgRef = useRef<any>(null);

  // Zoom to fit after graph stabilises
  useEffect(() => {
    const t = setTimeout(() => {
      fgRef.current?.zoomToFit(400, 60);
    }, 800);
    return () => clearTimeout(t);
  }, [nodes]);

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = nodeLabel(node);
    const fontSize = Math.max(10 / globalScale, 3);
    const r = 6;
    const color = NODE_COLOR[node.type] ?? '#94a3b8';

    // Circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / globalScale;
    ctx.stroke();

    // Label (only when zoomed in enough)
    if (globalScale >= 0.6) {
      ctx.font = `${fontSize}px Inter, sans-serif`;
      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(
        label.length > 20 ? label.slice(0, 18) + '…' : label,
        node.x,
        node.y + r + 2 / globalScale
      );
    }
  }, []);

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={{ nodes, links }}
      nodeId="id"
      linkSource="source"
      linkTarget="target"
      nodeCanvasObject={paintNode}
      nodeCanvasObjectMode={() => 'replace'}
      linkColor={(link: any) => LINK_COLOR[link.type] ?? '#cbd5e1'}
      linkWidth={1.5}
      linkDirectionalArrowLength={4}
      linkDirectionalArrowRelPos={1}
      linkCurvature={0.15}
      linkLabel={(link: any) => link.type}
      onNodeClick={onNodeClick}
      backgroundColor="#f8fafc"
      width={undefined}
      height={undefined}
      cooldownTicks={120}
      d3AlphaDecay={0.03}
      d3VelocityDecay={0.4}
    />
  );
}
