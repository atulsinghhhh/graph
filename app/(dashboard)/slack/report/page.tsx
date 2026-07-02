'use client';

import ToolReportPage, { IssueGroup, type ScanIssue } from '@/components/reports/ToolReportPage';

function byType(issues: ScanIssue[], types: string[]): ScanIssue[] {
  return issues.filter(i => types.includes(i.type));
}

export default function SlackReportPage() {
  return (
    <ToolReportPage
      tool="slack"
      title="Slack Report"
      scheduleMinutes={15}
      renderSections={(report, issues, reload) => {
        const alertMessages: number = report?.raw_stats?.alertMessages ?? 0;
        const decisions: number = report?.raw_stats?.decisions ?? 0;

        return (
          <div className="flex flex-col gap-6">
            <IssueGroup
              title="Active incident channels"
              issues={byType(issues, ['unresolved_incident_channel'])}
              onChanged={reload}
              emptyText="No active incident channels older than an hour."
            />
            <IssueGroup
              title="Slow incident response"
              issues={byType(issues, ['slow_incident_response'])}
              onChanged={reload}
              emptyText="No response-time SLA breaches."
            />
            <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-6">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Bot alerts seen</p>
                <p className="text-lg font-medium text-foreground">{alertMessages}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Decisions logged</p>
                <p className="text-lg font-medium text-foreground">{decisions}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Decisions are queryable from /chat — ask things like "why did we switch from Redis to Memcached?"
              </p>
            </div>
          </div>
        );
      }}
    />
  );
}
