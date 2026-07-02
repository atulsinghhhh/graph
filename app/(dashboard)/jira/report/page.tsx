'use client';

import ToolReportPage, { IssueGroup, type ScanIssue } from '@/components/reports/ToolReportPage';

interface SprintSummary {
  sprintName: string;
  totalIssues: number;
  closedIssues: number;
  completionRate: number;
  daysRemaining: number | null;
  issuesAtRisk: number;
}

function byType(issues: ScanIssue[], types: string[]): ScanIssue[] {
  return issues.filter(i => types.includes(i.type));
}

export default function JiraReportPage() {
  return (
    <ToolReportPage
      tool="jira"
      title="Jira Report"
      scheduleMinutes={60}
      renderSections={(report, issues, reload) => {
        const sprints: SprintSummary[] = report?.raw_stats?.sprints ?? [];

        return (
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Sprint health ({sprints.length})
              </p>
              {sprints.length > 0 ? (
                <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-4">
                  {sprints.map(s => (
                    <div key={s.sprintName}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-foreground">{s.sprintName}</span>
                        <span className="text-muted-foreground">
                          {s.completionRate}% · {s.daysRemaining ?? '?'} days left
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${s.completionRate < 40 ? 'bg-destructive' : s.completionRate < 70 ? 'bg-warning' : 'bg-success'}`}
                          style={{ width: `${s.completionRate}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No active sprints found.</p>
              )}
            </div>

            <IssueGroup title="SLA breaches" issues={byType(issues, ['sla_breach'])} onChanged={reload} emptyText="No SLA breaches." />
            <IssueGroup title="Unassigned critical issues" issues={byType(issues, ['unassigned_critical'])} onChanged={reload} emptyText="No unassigned critical issues." />
            <IssueGroup title="Stale incidents & bugs" issues={byType(issues, ['stale_incident', 'stale_bug'])} onChanged={reload} emptyText="Nothing stale." />
            <IssueGroup title="Recurring bug patterns" issues={byType(issues, ['recurring_bug'])} onChanged={reload} emptyText="No recurring bug patterns detected." />
          </div>
        );
      }}
    />
  );
}
