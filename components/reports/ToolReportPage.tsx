'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, FileText } from 'lucide-react';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface ScanIssue {
  id: string;
  source: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  fixSuggestion: string;
  detectedAt: string;
  status: 'open' | 'acknowledged' | 'resolved';
  url: string;
}

export interface ToolScanReport {
  id: string;
  tool: string;
  scanned_at: string;
  items_scanned: number;
  issues_found: ScanIssue[];
  critical_count: number;
  high_count: number;
  summary_text: string | null;
  raw_stats: Record<string, any>;
}

export function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

function minutesUntilNextScan(scannedAt: string, intervalMinutes: number): number {
  const next = new Date(scannedAt).getTime() + intervalMinutes * 60_000;
  return Math.max(0, Math.round((next - Date.now()) / 60_000));
}

export function IssueRow({ issue, onChanged }: { issue: ScanIssue; onChanged: () => void }) {
  const [open, setOpen] = useState(false);

  async function acknowledge() {
    await api.post(`/api/reports/issue/${issue.id}/acknowledge`, {});
    onChanged();
  }
  async function resolve() {
    await api.post(`/api/reports/issue/${issue.id}/resolve`);
    onChanged();
  }

  return (
    <div className="border-b border-border last:border-b-0 py-3">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="text-sm text-foreground truncate">{issue.title}</p>
          <p className="text-xs text-muted-foreground">{timeAgo(issue.detectedAt)} · {issue.status}</p>
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
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2 leading-relaxed whitespace-pre-line">
            {issue.fixSuggestion}
          </p>
          {issue.status === 'open' && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={acknowledge}>Acknowledge</Button>
              <Button size="sm" variant="outline" onClick={resolve}>Mark as resolved</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function IssueGroup({ title, issues, onChanged, emptyText }: { title: string; issues: ScanIssue[]; onChanged: () => void; emptyText: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title} ({issues.length})</p>
      {issues.length > 0 ? (
        <div className="rounded-xl border border-border bg-card px-4">
          {issues.map(i => <IssueRow key={i.id} issue={i} onChanged={onChanged} />)}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}

interface ToolReportPageProps {
  tool: 'jira' | 'slack' | 'pagerduty' | 'linear' | 'datadog';
  title: string;
  scheduleMinutes: number;
  renderSections: (report: ToolScanReport | null, issues: ScanIssue[], reload: () => void) => ReactNode;
}

export default function ToolReportPage({ tool, title, scheduleMinutes, renderSections }: ToolReportPageProps) {
  const [report, setReport] = useState<ToolScanReport | null>(null);
  const [loaded, setLoaded] = useState(false);

  function load() {
    api.get(`/api/reports/${tool}`)
      .then(r => setReport(r.data))
      .catch(() => setReport(null))
      .finally(() => setLoaded(true));
  }

  useEffect(() => { load(); }, [tool]);

  const issues = report?.issues_found ?? [];
  const criticalIssues = issues.filter(i => i.severity === 'critical' && i.status === 'open');

  return (
    <div className="p-8 max-w-4xl flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground mb-1">{title}</h1>
        {report ? (
          <p className="text-sm text-muted-foreground">
            Last scanned: {timeAgo(report.scanned_at)} · Next scan: in {minutesUntilNextScan(report.scanned_at, scheduleMinutes)} minutes · {report.items_scanned} items scanned
          </p>
        ) : loaded ? (
          <p className="text-sm text-muted-foreground">No scan has run yet — the first scan will run automatically.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </div>

      {criticalIssues.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5">
          <p className="text-sm font-semibold text-destructive flex items-center gap-2 mb-3">
            <AlertTriangle className="size-4" />
            {criticalIssues.length} critical issue{criticalIssues.length === 1 ? '' : 's'} — immediate action required
          </p>
          <div className="flex flex-col gap-3">
            {criticalIssues.map(issue => (
              <div key={issue.id} className="rounded-lg border border-destructive/30 bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{issue.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{issue.description}</p>
                  </div>
                  <Badge variant="destructive" className="shrink-0">Critical</Badge>
                </div>
                <IssueRow issue={issue} onChanged={load} />
              </div>
            ))}
          </div>
        </div>
      )}

      {renderSections(report, issues, load)}

      {report?.summary_text && (
        <div className="rounded-xl border border-border bg-card p-5 max-w-2xl">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            <FileText className="size-3.5" />
            AI Summary
          </p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
            {report.summary_text}
          </p>
        </div>
      )}
    </div>
  );
}
