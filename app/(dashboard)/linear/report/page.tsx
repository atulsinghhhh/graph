'use client';

import ToolReportPage, { IssueGroup, type ScanIssue } from '@/components/reports/ToolReportPage';

interface CycleSummary {
  cycleId: string;
  name: string | null;
  completionRate: number;
  daysRemaining: number | null;
  issueCount: number;
  completedIssueCount: number;
}

function byType(issues: ScanIssue[], types: string[]): ScanIssue[] {
  return issues.filter(i => types.includes(i.type));
}

export default function LinearReportPage() {
  return (
    <ToolReportPage
      tool="linear"
      title="Linear Report"
      scheduleMinutes={60}
      renderSections={(report, issues, reload) => {
        const cycles: CycleSummary[] = report?.raw_stats?.cycles ?? [];

        return (
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Active cycle progress ({cycles.length})
              </p>
              {cycles.length > 0 ? (
                <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-4">
                  {cycles.map(c => (
                    <div key={c.cycleId}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-foreground">{c.name ?? c.cycleId}</span>
                        <span className="text-muted-foreground">
                          {c.completionRate}% · {c.completedIssueCount}/{c.issueCount} issues
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${c.completionRate < 50 ? 'bg-destructive' : c.completionRate < 80 ? 'bg-warning' : 'bg-success'}`}
                          style={{ width: `${c.completionRate}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No active cycles found.</p>
              )}
            </div>

            <IssueGroup title="Blocked issues" issues={byType(issues, ['blocked_issue'])} onChanged={reload} emptyText="No blocked issues." />
            <IssueGroup title="Overdue issues" issues={byType(issues, ['overdue_issue'])} onChanged={reload} emptyText="No overdue issues." />
            <IssueGroup title="Missing estimates" issues={byType(issues, ['missing_estimates'])} onChanged={reload} emptyText="Estimates look complete." />
          </div>
        );
      }}
    />
  );
}
