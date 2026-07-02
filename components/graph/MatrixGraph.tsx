'use client';

import { useMemo, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface GNode {
  id: string; type: string; nodeId?: string; title?: string; name?: string;
  version?: string; metric?: string; jiraId?: string; status?: string;
  severity?: string; [key: string]: any;
}
interface GLink { source: string; target: string; type: string; confidence?: number; }
interface Props  { nodes: GNode[]; links: GLink[]; }

// ── Palette ───────────────────────────────────────────────────────────────────
// SecretAlert sits between Service and Incident — the "hidden threat" column.
// Columns after Alert cover the non-GitHub tools (Jira, Slack, PagerDuty,
// Linear, Datadog) so every connected tool's data is visible here, not just
// the original GitHub/Jira/Datadog core graph.
export const COL_ORDER = [
  'Deployment', 'PullRequest', 'Engineer', 'Service', 'SecretAlert', 'Incident', 'Bug', 'Alert',
  'WorkflowRun', 'SecurityIncident', 'Issue',
  'Message', 'IncidentChannel', 'Decision',
  'AlertMessage', 'OnCallSchedule',
  'SprintNode', 'Cycle', 'Project', 'SLO',
] as const;

export const COLOR: Record<string,string> = {
  Deployment:'#3b82f6', PullRequest:'#06b6d4',  Engineer:'#22c55e',
  Service:'#f97316',    SecretAlert:'#dc2626',   Incident:'#ef4444',
  Bug:'#f59e0b',        Alert:'#a855f7',
  WorkflowRun:'#0ea5e9', SecurityIncident:'#e11d48', Issue:'#facc15',
  Message:'#14b8a6', IncidentChannel:'#0d9488', Decision:'#84cc16',
  AlertMessage:'#f472b6', OnCallSchedule:'#fb923c',
  SprintNode:'#818cf8', Cycle:'#c084fc', Project:'#a78bfa', SLO:'#38bdf8',
};

const EDGE_COLOR: Record<string,string> = {
  TRIGGERED:'#ef4444',         FIRED:'#a855f7',           LINKED_TO:'#f59e0b',
  POSSIBLY_TRIGGERED:'#dc2626', HAS_SECRET_ALERT:'#dc2626', PUSHED_SECRET:'#b91c1c',
  INTRODUCED_SECRET:'#ef4444', OWNS:'#22c55e',             INCLUDES:'#3b82f6',
  AUTHORED_BY:'#06b6d4',       CHANGED:'#f97316',          ASSIGNED_TO:'#475569',
  HAS_ISSUE:'#facc15',         FOUND_IN:'#facc15',         CAUSED_BY:'#e11d48',
  MENTIONS:'#14b8a6',          SLACK_ALERT_FOR:'#0d9488',  MADE_BY:'#84cc16',
  ON_CALL_FOR:'#fb923c',       ESCALATED_TO:'#f472b6',     RESPONDED_BY:'#f472b6',
  IN_SPRINT:'#818cf8',         IN_CYCLE:'#c084fc',         IN_PROJECT:'#a78bfa',
  MEASURES:'#38bdf8',          BLOCKED_BY:'#e11d48',       FAILED_ON:'#0ea5e9',
};

// All edges that visually "break" during a security incident or outage
const BREAK_EDGES = new Set([
  'TRIGGERED','FIRED','LINKED_TO',
  'POSSIBLY_TRIGGERED','HAS_SECRET_ALERT','PUSHED_SECRET',
  'CAUSED_BY','BLOCKED_BY',
]);

// ── Layout constants ──────────────────────────────────────────────────────────
const SVG_W   = COL_ORDER.length * 130;
const COL_W   = SVG_W / COL_ORDER.length;
const PAD_TOP = 68;
const PAD_BOT = 48;
const R       = 26;   // node radius

// ── Helpers ───────────────────────────────────────────────────────────────────
function nodeLabel(n: GNode): string {
  const raw = String(n.title ?? n.name ?? n.version ?? n.metric ?? n.jiraId
    ?? n.nodeId?.split(':').pop() ?? n.type);
  return raw.length > 18 ? raw.slice(0,16)+'…' : raw;
}

function bezier(sx:number,sy:number,tx:number,ty:number) {
  const mx = (sx+tx)/2;
  return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MatrixGraph({ nodes, links }: Props) {
  const [selected, setSelected] = useState<GNode|null>(null);

  const hasBreakdown = nodes.some(n => n.type==='Incident' && n.status!=='resolved');
  const incIds = new Set(nodes.filter(n=>n.type==='Incident').map(n=>n.id));

  const byCol = useMemo(()=>{
    const m: Record<string,GNode[]> = {};
    for (const t of COL_ORDER) m[t]=[];
    for (const n of nodes) if (n.type in m) m[n.type].push(n);
    return m;
  },[nodes]);

  const maxPerCol = Math.max(1,...Object.values(byCol).map(a=>a.length));
  const svgH = Math.max(300, PAD_TOP + maxPerCol*110 + PAD_BOT);

  const pos = useMemo(()=>{
    const m: Record<string,{x:number,y:number}> = {};
    COL_ORDER.forEach((type,ci)=>{
      const arr = byCol[type];
      const colH = svgH - PAD_TOP - PAD_BOT;
      const spacing = colH / Math.max(arr.length,1);
      arr.forEach((node,ri)=>{
        m[node.id]={ x: ci*COL_W+COL_W/2, y: PAD_TOP+spacing*ri+spacing/2 };
      });
    });
    return m;
  },[byCol,svgH]);

  const isBroken = (l:GLink) =>
    hasBreakdown && BREAK_EDGES.has(l.type) && (incIds.has(l.source)||incIds.has(l.target));

  // Pre-gather node map for gradient colours
  const nodeById = useMemo(()=>{
    const m: Record<string,GNode> = {};
    for (const n of nodes) m[n.id]=n;
    return m;
  },[nodes]);

  return (
    <div className="relative w-full h-full flex overflow-hidden" style={{background:'#03070f'}}>
      <div className="flex-1 overflow-auto relative">
        <svg viewBox={`0 0 ${SVG_W} ${svgH}`} className="w-full" style={{minHeight:svgH,minWidth:640}}>

          {/* ════════════════ DEFS ════════════════ */}
          <defs>
            {/* ── Background radial vignette ── */}
            <radialGradient id="bg-vignette" cx="50%" cy="50%" r="70%">
              <stop offset="0%" stopColor="#071022"/>
              <stop offset="100%" stopColor="#03070f"/>
            </radialGradient>

            {/* ── Dot grid pattern ── */}
            <pattern id="dot-grid" width="36" height="36" patternUnits="userSpaceOnUse">
              <circle cx="18" cy="18" r="0.7" fill="#0e1e30"/>
            </pattern>

            {/* ── Glow filter (used by nodes — inherits element colour) ── */}
            <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>

            {/* ── Strong glow for incident breakdown ── */}
            <filter id="glow-strong" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>

            {/* ── Electric distortion filter for breakdown edges ── */}
            <filter id="electric" x="-10%" y="-40%" width="120%" height="180%">
              <feTurbulence type="turbulence" baseFrequency="0.03 0.6"
                numOctaves="4" seed="1" result="noise">
                <animate attributeName="seed" values="1;3;7;2;9;4;6;5;8;1"
                  dur="0.35s" repeatCount="indefinite"/>
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" in2="noise"
                scale="9" xChannelSelector="R" yChannelSelector="G"/>
            </filter>

            {/* ── Per-type radial gradient fills ── */}
            {COL_ORDER.map(type=>{
              const c = COLOR[type];
              return (
                <radialGradient key={type} id={`nfill-${type}`} cx="38%" cy="32%" r="65%">
                  <stop offset="0%"   stopColor="#fff"   stopOpacity="0.18"/>
                  <stop offset="55%"  stopColor={c}      stopOpacity="0.45"/>
                  <stop offset="100%" stopColor={c}      stopOpacity="0.9"/>
                </radialGradient>
              );
            })}

            {/* ── Per-edge linear gradients ── */}
            {links.map((l,i)=>{
              const s=pos[l.source], t=pos[l.target];
              if(!s||!t) return null;
              const sc = COLOR[nodeById[l.source]?.type??'']??'#475569';
              const tc = COLOR[nodeById[l.target]?.type??'']??'#475569';
              return (
                <linearGradient key={i} id={`eg-${i}`}
                  gradientUnits="userSpaceOnUse"
                  x1={s.x} y1={s.y} x2={t.x} y2={t.y}>
                  <stop offset="0%"   stopColor={sc} stopOpacity="0.9"/>
                  <stop offset="100%" stopColor={tc} stopOpacity="0.9"/>
                </linearGradient>
              );
            })}

            {/* ── Path defs for animateMotion particles ── */}
            {links.map((l,i)=>{
              const s=pos[l.source], t=pos[l.target];
              if(!s||!t) return null;
              return <path key={i} id={`mp-${i}`} d={bezier(s.x,s.y,t.x,t.y)}/>;
            })}

            {/* ── CSS keyframes & classes ── */}
            <style>{`
              @keyframes spin-cw  { to { transform: rotate(360deg);  } }
              @keyframes spin-ccw { to { transform: rotate(-360deg); } }
              @keyframes pulse-expand {
                0%   { r:${R}px;      opacity:.7; }
                100% { r:${R+30}px;   opacity:0;  }
              }
              @keyframes dash-march {
                from { stroke-dashoffset: 18; }
                to   { stroke-dashoffset:  0; }
              }
              @keyframes fade-in {
                from { opacity:0; transform:scale(.4); }
                to   { opacity:1; transform:scale(1);  }
              }
              @keyframes bolt-flicker {
                0%,100%{ opacity:1;   }
                40%    { opacity:.25; }
                60%    { opacity:.9;  }
              }
              @keyframes edge-appear {
                from { opacity:0; }
                to   { opacity:1; }
              }
              @keyframes glow-pulse {
                0%,100%{ opacity:.35; }
                50%    { opacity:.65; }
              }
              @keyframes scan-line {
                from { transform: translateY(0); }
                to   { transform: translateY(${svgH}px); }
              }

              .ring-cw  { transform-box:fill-box; transform-origin:center;
                          animation: spin-cw  14s linear infinite; }
              .ring-ccw { transform-box:fill-box; transform-origin:center;
                          animation: spin-ccw  9s linear infinite; }
              .ring-fast{ transform-box:fill-box; transform-origin:center;
                          animation: spin-ccw  2s linear infinite; }
              .pulse-a  { animation: pulse-expand 2s ease-out infinite; }
              .pulse-b  { animation: pulse-expand 2s ease-out .67s infinite; }
              .pulse-c  { animation: pulse-expand 2s ease-out 1.33s infinite; }
              .dash-march{ stroke-dasharray:7 4;
                           animation: dash-march .45s linear infinite; }
              .node-in  { transform-box:fill-box; transform-origin:center;
                          animation: fade-in .5s ease-out both; }
              .edge-in  { animation: edge-appear .8s ease-out both; }
              .bolt-flicker { animation: bolt-flicker .55s ease-in-out infinite; }
              .glow-anim    { animation: glow-pulse 2.2s ease-in-out infinite; }
            `}</style>
          </defs>

          {/* ════════════════ BACKGROUND ════════════════ */}
          <rect width={SVG_W} height={svgH} fill="url(#bg-vignette)"/>
          <rect width={SVG_W} height={svgH} fill="url(#dot-grid)"/>

          {/* Moving scan-line (subtle) */}
          <rect x={0} y={0} width={SVG_W} height={2} fill="#ffffff" opacity={0.025}>
            <animateTransform attributeName="transform" type="translate"
              from={`0,-2`} to={`0,${svgH}`} dur="5s" repeatCount="indefinite"/>
          </rect>

          {/* ════════════════ COLUMN PANELS ════════════════ */}
          {COL_ORDER.map((type,ci)=>{
            const has = byCol[type].length>0;
            const c   = COLOR[type];
            return (
              <g key={type}>
                {/* Column card bg */}
                <rect x={ci*COL_W+6} y={PAD_TOP-22} width={COL_W-12}
                  height={svgH-PAD_TOP-PAD_BOT+44} rx={10}
                  fill={has ? `${c}07` : 'none'}
                  stroke={has ? `${c}22` : '#0e1e30'} strokeWidth={1}
                />
                {/* Coloured top bar */}
                {has && (
                  <rect x={ci*COL_W+6} y={PAD_TOP-22} width={COL_W-12} height={3}
                    rx={1.5} fill={c} opacity={0.6}/>
                )}
                {/* Column header */}
                <text x={ci*COL_W+COL_W/2} y={PAD_TOP-30}
                  textAnchor="middle" fontSize={9} fontWeight="800"
                  letterSpacing="2.5" fontFamily="monospace"
                  fill={has ? c : '#1a2a3f'} opacity={has?1:0.4}>
                  {type.toUpperCase()}
                </text>
              </g>
            );
          })}

          {/* ════════════════ EDGES ════════════════ */}
          {links.map((l,i)=>{
            const s=pos[l.source], t=pos[l.target];
            if(!s||!t) return null;
            const broken   = isBroken(l);
            const ec       = EDGE_COLOR[l.type]??'#475569';
            const path     = bezier(s.x,s.y,t.x,t.y);
            const mx=(s.x+t.x)/2, my=(s.y+t.y)/2;
            const delay    = `${(i*0.06).toFixed(2)}s`;

            return (
              <g key={i} className="edge-in" style={{animationDelay:delay}}>
                {/* Wide glow behind edge */}
                <path d={path} fill="none"
                  stroke={broken?ec:`url(#eg-${i})`}
                  strokeWidth={broken?14:8} opacity={broken?.15:.06}/>

                {/* Main edge — electric distortion when broken */}
                <path d={path} fill="none"
                  stroke={broken?ec:`url(#eg-${i})`}
                  strokeWidth={broken?2:1.5}
                  opacity={broken?1:.55}
                  className={broken?'dash-march':undefined}
                  filter={broken?'url(#electric)':undefined}/>

                {/* Second arc (ghost) for more electric feel */}
                {broken && (
                  <path d={path} fill="none" stroke="#fff"
                    strokeWidth={0.6} opacity={0.4}
                    className="dash-march"
                    filter="url(#electric)"
                    style={{animationDelay:'-0.22s'}}/>
                )}

                {/* Flowing particles */}
                {(broken ? [0,1,2] : [0,1]).map(pi=>(
                  <circle key={pi} r={broken?3.5:2}
                    fill={broken?ec:'#fff'} opacity={broken?.95:.6}>
                    <animateMotion
                      dur={broken?'1.1s':'3.2s'}
                      repeatCount="indefinite"
                      begin={`${-(pi/(broken?3:2))*(broken?1.1:3.2)}s`}
                      rotate="auto">
                      <mpath href={`#mp-${i}`}/>
                    </animateMotion>
                  </circle>
                ))}

                {/* Arrowhead */}
                <circle cx={t.x-(t.x>s.x?R:-R)} cy={t.y} r={broken?4:2.5}
                  fill={broken?ec:`url(#eg-${i})`} opacity={broken?1:.7}/>

                {/* Breakdown bolt at midpoint */}
                {broken && (
                  <g className="bolt-flicker">
                    <circle cx={mx} cy={my} r={10} fill={ec} opacity={0.15}/>
                    <polygon
                      points={`${mx+3},${my-9} ${mx-2},${my-1} ${mx+3},${my-1} ${mx-3},${my+9} ${mx+2},${my+1} ${mx-3},${my+1}`}
                      fill={ec} filter="url(#glow)"/>
                    <polygon
                      points={`${mx+3},${my-9} ${mx-2},${my-1} ${mx+3},${my-1} ${mx-3},${my+9} ${mx+2},${my+1} ${mx-3},${my+1}`}
                      fill="#fff" opacity={0.6}/>
                  </g>
                )}

                {/* Edge label */}
                <text x={mx} y={my-(broken?16:12)} textAnchor="middle"
                  fontSize={7.5} fontFamily="monospace" letterSpacing="0.6"
                  fill={broken?ec:'#1e3a5a'}
                  fontWeight={broken?'800':'400'}>
                  {l.type}
                </text>
              </g>
            );
          })}

          {/* ════════════════ NODES ════════════════ */}
          {nodes.map((node,ni)=>{
            const p   = pos[node.id];
            if(!p) return null;
            const c      = COLOR[node.type]??'#475569';
            const isInc  = node.type==='Incident';
            const isOpen = isInc && node.status!=='resolved';
            const isSel  = selected?.id===node.id;
            const lbl    = nodeLabel(node);
            const colIdx = COL_ORDER.indexOf(node.type as any);
            const delay  = `${(colIdx*0.12+ni*0.05).toFixed(2)}s`;

            return (
              <g key={node.id} onClick={()=>setSelected(isSel?null:node)}
                className="node-in cursor-pointer"
                style={{animationDelay:delay}}>

                {/* ── Pulse rings for open incident ── */}
                {isOpen && (<>
                  <circle cx={p.x} cy={p.y} r={R} fill="none"
                    stroke="#ef4444" strokeWidth={2} className="pulse-a"/>
                  <circle cx={p.x} cy={p.y} r={R} fill="none"
                    stroke="#ef4444" strokeWidth={1.5} className="pulse-b"/>
                  <circle cx={p.x} cy={p.y} r={R} fill="none"
                    stroke="#ef4444" strokeWidth={1} className="pulse-c"/>
                </>)}

                {/* ── Ambient glow disk ── */}
                <circle cx={p.x} cy={p.y} r={R+10}
                  fill={c} opacity={isOpen?.3:.1}
                  filter="url(#glow)" className="glow-anim"/>

                {/* ── Outer decorative spinning ring ── */}
                <circle cx={p.x} cy={p.y} r={R+5} fill="none"
                  stroke={c} strokeWidth={1}
                  strokeDasharray={`${(R+5)*0.55} ${(R+5)*0.22}`}
                  opacity={0.5}
                  className={isOpen?'ring-fast':'ring-cw'}/>

                {/* ── Inner counter-spin ring ── */}
                <circle cx={p.x} cy={p.y} r={R+2} fill="none"
                  stroke={c} strokeWidth={0.7}
                  strokeDasharray={`${(R+2)*0.3} ${(R+2)*0.6}`}
                  opacity={0.3}
                  className="ring-ccw"/>

                {/* ── Selection halo ── */}
                {isSel && (
                  <circle cx={p.x} cy={p.y} r={R+8}
                    fill="none" stroke="#fff" strokeWidth={1}
                    strokeDasharray="4 3" opacity={0.55}
                    className="ring-cw"/>
                )}

                {/* ── Main node body ── */}
                <circle cx={p.x} cy={p.y} r={R}
                  fill={`url(#nfill-${node.type})`}
                  stroke={c} strokeWidth={isOpen?2.5:1.8}
                  filter={isOpen?'url(#glow-strong)':isSel?'url(#glow)':undefined}/>

                {/* ── Glass highlight ── */}
                <ellipse cx={p.x-R*.22} cy={p.y-R*.28}
                  rx={R*.48} ry={R*.28} fill="#fff" opacity={0.1}/>

                {/* ── Icon: flicker bolt for open incident, letter otherwise ── */}
                {isOpen ? (
                  <g className="bolt-flicker" filter="url(#glow-strong)">
                    <polygon
                      points={`${p.x+4},${p.y-12} ${p.x-2.5},${p.y-1} ${p.x+4},${p.y-1} ${p.x-4},${p.y+12} ${p.x+2.5},${p.y+1} ${p.x-4},${p.y+1}`}
                      fill="#fff"/>
                  </g>
                ) : (
                  <text x={p.x} y={p.y+5} textAnchor="middle"
                    fontSize={15} fontWeight="800" fontFamily="monospace"
                    fill={c} opacity={0.95} filter="url(#glow)">
                    {node.type[0]}
                  </text>
                )}

                {/* ── Label below node ── */}
                <text x={p.x} y={p.y+R+17} textAnchor="middle"
                  fontSize={9.5} fontFamily="monospace"
                  fill={isOpen?'#ef4444':'#3d5a78'}
                  fontWeight={isOpen?'700':'400'}>
                  {lbl}
                </text>

                {/* ── Severity tag for incidents ── */}
                {isInc && node.severity && (
                  <text x={p.x} y={p.y-R-8} textAnchor="middle"
                    fontSize={7.5} fontWeight="900" fontFamily="monospace"
                    letterSpacing="1.5"
                    fill={isOpen?'#ef4444':'#22c55e'}>
                    {node.severity.toUpperCase().slice(0,5)}
                  </text>
                )}
              </g>
            );
          })}

          {/* ════════════════ BREAKDOWN BANNER ════════════════ */}
          {hasBreakdown && (
            <g>
              <rect x={8} y={svgH-PAD_BOT+2} width={280} height={24} rx={5}
                fill="#1a0404" stroke="#ef444455" strokeWidth={1} opacity={0.95}/>
              <text x={16} y={svgH-PAD_BOT+18} fontFamily="monospace"
                fontSize={9.5} fill="#ef4444" fontWeight="800" letterSpacing="0.5">
                ⚡ BREAKDOWN — cascading failure active
              </text>
              <text x={SVG_W-10} y={svgH-PAD_BOT+18} fontFamily="monospace"
                fontSize={8} fill="#3d5a78" textAnchor="end">
                click any node for details
              </text>
            </g>
          )}

        </svg>
      </div>

      {/* ════════════════ DETAIL PANEL ════════════════ */}
      {selected && (
        <aside className="w-64 shrink-0 flex flex-col overflow-y-auto"
          style={{background:'#06101e', borderLeft:'1px solid #0e1e30'}}>
          <div className="flex items-center justify-between px-4 py-3"
            style={{borderBottom:'1px solid #0e1e30'}}>
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full text-white"
              style={{background: COLOR[selected.type]??'#475569'}}>
              {selected.type}
            </span>
            <button onClick={()=>setSelected(null)}
              className="text-slate-600 hover:text-white text-xl leading-none transition-colors">
              ×
            </button>
          </div>
          <div className="px-4 py-3 space-y-3 text-xs font-mono">
            {Object.entries(selected)
              .filter(([k])=>!['id','orgId','syncedAt'].includes(k))
              .map(([k,v])=> v!=null && (
                <div key={k}>
                  <p className="text-[9px] font-bold uppercase tracking-widest mb-0.5"
                    style={{color: COLOR[selected.type]??'#475569', opacity:0.7}}>
                    {k}
                  </p>
                  <p className="text-slate-400 break-words leading-relaxed">
                    {typeof v==='string' && v.startsWith('http')
                      ? <a href={v} target="_blank" rel="noreferrer"
                          className="text-blue-400 hover:underline">{v}</a>
                      : String(v)}
                  </p>
                </div>
              ))}
          </div>
        </aside>
      )}
    </div>
  );
}
