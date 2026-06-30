'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

interface Incident { title: string; severity: string }
interface Bug      { jiraId: string; title: string; priority: string }

interface Insight {
  prNumber: number;
  prTitle: string;
  prUrl?: string;
  engineer: string;
  mergedAt?: string;
  services: string[];
  linkedIncidents: Incident[];
  linkedBugs: Bug[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  potentialIssues: string[];
  fixSuggestions: string[];
}

const RISK_STYLE: Record<string, string> = {
  low:      'bg-green-50  text-green-700  border-green-200',
  medium:   'bg-yellow-50 text-yellow-700 border-yellow-200',
  high:     'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-red-50    text-red-700    border-red-200',
};

function timeAgo(iso?: string) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return 'just now';
}

export default function InsightsPage() {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    api.get('/api/insights')
      .then(r => setInsights(r.data))
      .catch(e => setError(e.response?.data?.error ?? e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-xl font-semibold text-zinc-900 mb-1">Developer Insights</h1>
      <p className="text-sm text-zinc-500 mb-6">
        AI analysis of recent code pushes — potential bugs, risks, and how to fix them.
      </p>

      {loading && (
        <div className="text-sm text-zinc-400 animate-pulse">Analysing recent pushes…</div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {insights && insights.length === 0 && (
        <div className="text-sm text-zinc-400">No merged pull requests found in the graph yet.</div>
      )}

      <div className="flex flex-col gap-5">
        {(insights ?? []).map(ins => (
          <div
            key={ins.prNumber}
            className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-zinc-100">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-zinc-400">#{ins.prNumber}</span>
                  {ins.prUrl ? (
                    <a
                      href={ins.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-zinc-900 hover:underline truncate"
                    >
                      {ins.prTitle}
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-zinc-900 truncate">{ins.prTitle}</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  by <span className="font-medium text-zinc-700">{ins.engineer}</span>
                  {ins.mergedAt && <> · {timeAgo(ins.mergedAt)}</>}
                  {ins.services.length > 0 && (
                    <> · <span className="text-zinc-400">{ins.services.join(', ')}</span></>
                  )}
                </p>
              </div>
              <span className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide border ${RISK_STYLE[ins.riskLevel]}`}>
                {ins.riskLevel}
              </span>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* AI summary */}
              <p className="text-sm text-zinc-700">{ins.summary}</p>

              {/* Linked incidents / bugs */}
              {(ins.linkedIncidents.length > 0 || ins.linkedBugs.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {ins.linkedIncidents.map((i, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                      ⚠ {i.title}
                    </span>
                  ))}
                  {ins.linkedBugs.map((b, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">
                      🐛 {b.jiraId}: {b.title}
                    </span>
                  ))}
                </div>
              )}

              {/* Potential issues */}
              {ins.potentialIssues.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                    Potential Issues
                  </p>
                  <ul className="space-y-1">
                    {ins.potentialIssues.map((issue, idx) => (
                      <li key={idx} className="flex gap-2 text-sm text-zinc-600">
                        <span className="text-orange-400 mt-0.5 shrink-0">•</span>
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Fix suggestions */}
              {ins.fixSuggestions.length > 0 && (
                <div className="rounded-lg bg-zinc-50 border border-zinc-100 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    How to Fix for Future Pushes
                  </p>
                  <ol className="space-y-1.5 list-decimal list-inside">
                    {ins.fixSuggestions.map((fix, idx) => (
                      <li key={idx} className="text-sm text-zinc-700">{fix}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
