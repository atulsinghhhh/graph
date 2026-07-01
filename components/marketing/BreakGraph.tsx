'use client';

import { useEffect, useRef, useState } from 'react';

export type GraphState = 'healthy' | 'broken' | 'resolved';

export interface BreakGraphNode {
  id: string;
  label: string;
  sub: string;
  x: number;
  y: number;
}

export interface BreakGraphEdge {
  from: string;
  to: string;
}

const CANVAS_HEIGHT = 390;

const DEMO_NODES: BreakGraphNode[] = [
  { id: 'eng', label: 'Engineer', sub: 'Alice Chen', x: 0.5, y: 0.08 },
  { id: 'pr', label: 'Pull request', sub: 'PR #421', x: 0.5, y: 0.28 },
  { id: 'deploy', label: 'Deployment', sub: 'v1.4.2 · prod', x: 0.5, y: 0.49 },
  { id: 'service', label: 'Service', sub: 'checkout', x: 0.5, y: 0.69 },
  { id: 'alert', label: 'Alert', sub: 'error rate >5%', x: 0.27, y: 0.9 },
  { id: 'incident', label: 'Incident', sub: 'INC-891', x: 0.73, y: 0.9 },
];

const DEMO_EDGES: BreakGraphEdge[] = [
  { from: 'eng', to: 'pr' },
  { from: 'pr', to: 'deploy' },
  { from: 'deploy', to: 'service' },
  { from: 'service', to: 'alert' },
  { from: 'service', to: 'incident' },
];

const DEMO_CASCADE_IDS = ['deploy', 'service', 'alert', 'incident'];

const HEALTHY_TEXT = 'Graph is healthy. No incidents detected. Click below to simulate a production incident.';
const BREAK_TEXT =
  'Break detected at PR #421 (Alice Chen, merged 22:58). Deployment v1.4.2 shipped bad code at 23:14. checkout-service error rate hit 5.3% at 23:17. Alert fired. INC-891 opened automatically.';
const RESOLVE_TEXT =
  'Rollback PR #430 deployed at 01:22 by Bob Kim. All nodes healthy. Incident INC-891 closed. Duration: 2h 5min.';

const BREAK_PILLS = [
  { text: 'Break: PR #421 by Alice', type: 'red' as const },
  { text: 'Cascade: v1.4.2 deploy', type: 'amber' as const },
  { text: 'Cascade: checkout-service', type: 'amber' as const },
  { text: 'Cascade: INC-891', type: 'amber' as const },
];

const RESOLVE_PILLS = [
  { text: 'Fixed: PR #430 by Bob', type: 'green' as const },
  { text: 'checkout-service healthy', type: 'green' as const },
  { text: 'INC-891 closed', type: 'green' as const },
];

const SHAKE_DURATION_MS = 450;
const TYPE_DELAY_MS = 18;

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

interface Theme {
  primary: string;
  foreground: string;
  mutedForeground: string;
  muted: string;
  destructive: string;
  warning: string;
  success: string;
}

function getTheme(): Theme {
  return {
    primary: cssVar('--primary', '#6366f1'),
    foreground: cssVar('--foreground', '#fafafa'),
    mutedForeground: cssVar('--muted-foreground', '#a1a1aa'),
    muted: cssVar('--muted', '#18181b'),
    destructive: cssVar('--destructive', '#ef4444'),
    warning: cssVar('--warning', '#f59e0b'),
    success: cssVar('--success', '#22c55e'),
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const int = parseInt(full, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getColor(id: string, state: GraphState, breakNodeId: string | null, cascadeIds: string[], theme: Theme) {
  if (state === 'resolved') {
    return { fill: hexToRgba(theme.success, 0.16), stroke: theme.success, title: theme.foreground, sub: theme.success };
  }
  if (id === breakNodeId) {
    return { fill: hexToRgba(theme.destructive, 0.18), stroke: theme.destructive, title: theme.foreground, sub: theme.destructive };
  }
  if (cascadeIds.includes(id)) {
    return { fill: hexToRgba(theme.warning, 0.18), stroke: theme.warning, title: theme.foreground, sub: theme.warning };
  }
  if (id === 'service') {
    return { fill: 'rgba(20, 184, 166, 0.16)', stroke: '#14b8a6', title: theme.foreground, sub: '#5eead4' };
  }
  if (id === 'alert' || id === 'incident') {
    return { fill: hexToRgba(theme.muted, 1), stroke: theme.mutedForeground, title: theme.foreground, sub: theme.mutedForeground };
  }
  return { fill: hexToRgba(theme.primary, 0.16), stroke: theme.primary, title: theme.foreground, sub: theme.mutedForeground };
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  nodes: BreakGraphNode[],
  edges: BreakGraphEdge[],
  state: GraphState,
  breakNodeId: string | null,
  cascadeIds: string[],
  shakeOffsetX: number,
  theme: Theme
) {
  ctx.clearRect(0, 0, W, H);

  function nx(n: BreakGraphNode) {
    return n.x * W + (n.id === breakNodeId ? shakeOffsetX : 0);
  }
  function ny(n: BreakGraphNode) {
    return n.y * H;
  }

  edges.forEach(e => {
    const fn = nodes.find(n => n.id === e.from);
    const tn = nodes.find(n => n.id === e.to);
    if (!fn || !tn) return;
    const fx = nx(fn), fy = ny(fn);
    const tx = nx(tn), ty = ny(tn);
    const dx = tx - fx, dy = ty - fy;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / d, uy = dy / d, pad = 27;
    const sx = fx + ux * pad, sy = fy + uy * pad;
    const ex = tx - ux * pad, ey = ty - uy * pad;

    const isBrokenEdge = e.from === breakNodeId;
    const isCascadeEdge = cascadeIds.includes(e.from) && cascadeIds.includes(e.to);
    const isResolvedEdge = state === 'resolved';

    const color = isResolvedEdge
      ? theme.success
      : isBrokenEdge
        ? theme.destructive
        : isCascadeEdge
          ? theme.warning
          : theme.mutedForeground;

    ctx.beginPath();
    ctx.setLineDash(isResolvedEdge ? [] : isBrokenEdge ? [6, 4] : isCascadeEdge ? [4, 3] : []);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);

    const angle = Math.atan2(ey - sy, ex - sx);
    const al = 8;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - al * Math.cos(angle - 0.4), ey - al * Math.sin(angle - 0.4));
    ctx.lineTo(ex - al * Math.cos(angle + 0.4), ey - al * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  });

  nodes.forEach(n => {
    const x = nx(n), y = ny(n);
    const nw = 148, nh = 48, rx = 8;
    const nx0 = x - nw / 2, ny0 = y - nh / 2;
    const col = getColor(n.id, state, breakNodeId, cascadeIds, theme);

    ctx.beginPath();
    ctx.roundRect(nx0, ny0, nw, nh, rx);
    ctx.fillStyle = col.fill;
    ctx.fill();
    ctx.strokeStyle = col.stroke;
    ctx.lineWidth = n.id === breakNodeId ? 2 : 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    if (n.id === breakNodeId) {
      ctx.font = '500 11px sans-serif';
      ctx.fillStyle = theme.destructive;
      ctx.fillText('⚠ break point', x, ny0 - 14);
    } else if (cascadeIds.includes(n.id) && state !== 'resolved') {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = theme.warning;
      ctx.fillText('↓ cascade', x, ny0 - 14);
    } else if (state === 'resolved') {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = theme.success;
      ctx.fillText('✓ resolved', x, ny0 - 14);
    }

    ctx.font = '500 13px sans-serif';
    ctx.fillStyle = col.title;
    ctx.fillText(n.label, x, y - 7);

    ctx.font = '11px sans-serif';
    ctx.fillStyle = col.sub;
    ctx.fillText(n.sub, x, y + 9);
  });
}

interface BreakGraphProps {
  /** Default true — renders the interactive marketing demo (Fire/Deploy/Reset + typing AI bubble). */
  interactive?: boolean;
  /** Static mode only: real nodes to draw (falls back to the demo shape if omitted). */
  nodes?: BreakGraphNode[];
  edges?: BreakGraphEdge[];
  /** Static mode only: the real current state to render, drawn once (no shake/typing). */
  state?: GraphState;
  breakNodeId?: string | null;
  cascadeIds?: string[];
  /** Static mode only: text shown next to the status dot. */
  statusLabel?: string;
}

export default function BreakGraph({
  interactive = true,
  nodes: staticNodes,
  edges: staticEdges,
  state: staticState = 'healthy',
  breakNodeId: staticBreakNodeId = null,
  cascadeIds: staticCascadeIds = [],
  statusLabel,
}: BreakGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ W: 0, H: CANVAS_HEIGHT });
  const themeRef = useRef<Theme>({
    primary: '#6366f1',
    foreground: '#fafafa',
    mutedForeground: '#a1a1aa',
    muted: '#18181b',
    destructive: '#ef4444',
    warning: '#f59e0b',
    success: '#22c55e',
  });
  const graphStateRef = useRef<GraphState>('healthy');
  const shakeStartRef = useRef<number | null>(null);
  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [demoState, setDemoState] = useState<GraphState>('healthy');
  const [aiText, setAiText] = useState(HEALTHY_TEXT);
  const [pills, setPills] = useState<Array<{ text: string; type: 'red' | 'amber' | 'green' }>>([]);

  const nodes = interactive ? DEMO_NODES : (staticNodes ?? DEMO_NODES);
  const edges = interactive ? DEMO_EDGES : (staticEdges ?? DEMO_EDGES);
  const graphState = interactive ? demoState : staticState;
  const breakNodeId = interactive ? (demoState === 'broken' ? 'pr' : null) : staticBreakNodeId;
  const cascadeIds = interactive ? (demoState === 'broken' ? DEMO_CASCADE_IDS : []) : staticCascadeIds;

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const breakNodeIdRef = useRef(breakNodeId);
  const cascadeIdsRef = useRef(cascadeIds);

  useEffect(() => {
    graphStateRef.current = graphState;
    nodesRef.current = nodes;
    edgesRef.current = edges;
    breakNodeIdRef.current = breakNodeId;
    cascadeIdsRef.current = cascadeIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphState, nodes, edges, breakNodeId, cascadeIds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    themeRef.current = getTheme();

    function resizeCanvas() {
      if (!canvas || !canvas.parentElement) return;
      const DPR = window.devicePixelRatio || 1;
      const W = canvas.parentElement.clientWidth;
      const H = CANVAS_HEIGHT;
      sizeRef.current = { W, H };
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.scale(DPR, DPR);
    }

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    if (!interactive) {
      // Static mode: draw once, redraw only on resize — no animation loop.
      const draw = () => {
        const { W, H } = sizeRef.current;
        drawGraph(ctx!, W, H, nodesRef.current, edgesRef.current, graphStateRef.current, breakNodeIdRef.current, cascadeIdsRef.current, 0, themeRef.current);
      };
      draw();
      const onResize = () => draw();
      window.addEventListener('resize', onResize);
      return () => {
        window.removeEventListener('resize', resizeCanvas);
        window.removeEventListener('resize', onResize);
      };
    }

    let raf: number;
    function loop(t: number) {
      const { W, H } = sizeRef.current;
      let shakeOffsetX = 0;
      if (shakeStartRef.current !== null) {
        const elapsed = t - shakeStartRef.current;
        if (elapsed < SHAKE_DURATION_MS) {
          const decay = 1 - elapsed / SHAKE_DURATION_MS;
          shakeOffsetX = Math.sin(elapsed / 16) * 6 * decay;
        } else {
          shakeStartRef.current = null;
        }
      }
      drawGraph(ctx!, W, H, nodesRef.current, edgesRef.current, graphStateRef.current, breakNodeIdRef.current, cascadeIdsRef.current, shakeOffsetX, themeRef.current);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resizeCanvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  // Static mode needs an immediate redraw whenever the real data changes (new report loaded).
  useEffect(() => {
    if (interactive) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { W, H } = sizeRef.current;
    drawGraph(ctx, W, H, nodes, edges, graphState, breakNodeId, cascadeIds, 0, themeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, graphState, breakNodeId, JSON.stringify(cascadeIds), JSON.stringify(nodes), JSON.stringify(edges)]);

  useEffect(() => {
    return () => {
      if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
    };
  }, []);

  function typeMessage(msg: string, onDone?: () => void) {
    if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
    setAiText('');
    let i = 0;
    typingIntervalRef.current = setInterval(() => {
      i++;
      setAiText(msg.slice(0, i));
      if (i >= msg.length) {
        if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
        typingIntervalRef.current = null;
        onDone?.();
      }
    }, TYPE_DELAY_MS);
  }

  function fireIncident() {
    setDemoState('broken');
    setPills([]);
    shakeStartRef.current = performance.now();
    typeMessage(BREAK_TEXT, () => setPills(BREAK_PILLS));
  }

  function resolveIncident() {
    setDemoState('resolved');
    setPills([]);
    typeMessage(RESOLVE_TEXT, () => setPills(RESOLVE_PILLS));
  }

  function reset() {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    shakeStartRef.current = null;
    setDemoState('healthy');
    setAiText(HEALTHY_TEXT);
    setPills([]);
  }

  const defaultStatusLabel =
    graphState === 'healthy' ? 'All systems healthy'
    : graphState === 'broken' ? 'Incident detected — graph broken'
    : 'Incident resolved';

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
          {interactive ? 'Live graph — production' : 'Current graph state'}
        </span>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`w-2 h-2 rounded-full ${
              graphState === 'healthy'
                ? 'bg-success'
                : graphState === 'broken'
                  ? 'bg-destructive animate-pulse'
                  : 'bg-success'
            }`}
          />
          <span className="text-muted-foreground">{statusLabel ?? defaultStatusLabel}</span>
        </div>
      </div>

      <canvas ref={canvasRef} className="w-full" />

      {interactive && (
        <>
          <div className="mt-3 bg-muted rounded-lg px-4 py-3 text-sm text-foreground leading-relaxed whitespace-pre-line">
            {aiText}
            {pills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {pills.map((p, i) => (
                  <span
                    key={i}
                    className={`text-xs px-2.5 py-0.5 rounded-full border ${
                      p.type === 'red'
                        ? 'bg-destructive/10 border-destructive/30 text-destructive'
                        : p.type === 'amber'
                          ? 'bg-warning/10 border-warning/30 text-warning'
                          : 'bg-success/10 border-success/30 text-success'
                    }`}
                  >
                    {p.text}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-3">
            {demoState === 'healthy' && (
              <button
                onClick={fireIncident}
                className="text-xs px-3 py-1.5 rounded-md bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20 transition-colors"
              >
                Fire production incident
              </button>
            )}
            {demoState === 'broken' && (
              <button
                onClick={resolveIncident}
                className="text-xs px-3 py-1.5 rounded-md bg-success/10 text-success border border-success/30 hover:bg-success/20 transition-colors"
              >
                Deploy fix
              </button>
            )}
            {demoState !== 'healthy' && (
              <button
                onClick={reset}
                className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors ml-auto"
              >
                Reset
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
