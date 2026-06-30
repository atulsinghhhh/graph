'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import MatrixGraph from '@/components/graph/MatrixGraph';

const LEGEND = [
  { label: 'Deployment',  color: '#3b82f6' },
  { label: 'PullRequest', color: '#06b6d4' },
  { label: 'Engineer',    color: '#22c55e' },
  { label: 'Service',     color: '#f97316' },
  { label: 'Incident',    color: '#ef4444' },
  { label: 'Bug',         color: '#f59e0b' },
  { label: 'Alert',       color: '#a855f7' },
];

export default function GraphPage() {
  const [data, setData]   = useState<{ nodes: any[]; links: any[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/graph')
      .then(r => setData(r.data))
      .catch((err: any) =>
        setError(err.response?.data?.error ?? err.message ?? 'Failed to load graph')
      );
  }, []);

  const hasBreakdown = (data?.nodes ?? []).some(
    n => n.type === 'Incident' && n.status !== 'resolved'
  );

  return (
    <div className="flex h-full flex-col bg-[#080d1a]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#1e2d42] bg-[#0d1425] shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-slate-100">Incident Graph</h1>
          {hasBreakdown && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-950 text-red-400 border border-red-900 animate-pulse">
              ⚡ BREAKDOWN
            </span>
          )}
          {data && !hasBreakdown && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-950 text-green-400 border border-green-900">
              ✓ All resolved
            </span>
          )}
          {data && (
            <span className="text-[10px] text-slate-600">
              {data.nodes.length} nodes · {data.links.length} edges
            </span>
          )}
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-3">
          {LEGEND.map(({ label, color }) => (
            <span key={label} className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {error && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-red-400 bg-red-950 border border-red-900 rounded-lg px-4 py-3">
              {error}
            </p>
          </div>
        )}
        {!error && !data && (
          <div className="flex h-full items-center justify-center text-slate-600 text-sm">
            Loading graph…
          </div>
        )}
        {!error && data && (
          <MatrixGraph nodes={data.nodes} links={data.links} />
        )}
      </div>
    </div>
  );
}
