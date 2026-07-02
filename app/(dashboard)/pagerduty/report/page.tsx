'use client';

import ToolReportPage, { IssueGroup, type ScanIssue } from '@/components/reports/ToolReportPage';

function byType(issues: ScanIssue[], types: string[]): ScanIssue[] {
  return issues.filter(i => types.includes(i.type));
}

export default function PagerDutyReportPage() {
  return (
    <ToolReportPage
      tool="pagerduty"
      title="PagerDuty Report"
      scheduleMinutes={15}
      renderSections={(report, issues, reload) => {
        const incidentsAnalyzed: number = report?.raw_stats?.incidentsAnalyzed ?? 0;

        return (
          <div className="flex flex-col gap-6">
            <IssueGroup
              title="Unacknowledged pages"
              issues={byType(issues, ['unacknowledged_page'])}
              onChanged={reload}
              emptyText="No unacknowledged pages."
            />
            <IssueGroup
              title="High MTTA services"
              issues={byType(issues, ['high_mtta'])}
              onChanged={reload}
              emptyText="All services are within MTTA target."
            />
            <IssueGroup
              title="Incident frequency"
              issues={byType(issues, ['high_incident_rate'])}
              onChanged={reload}
              emptyText="No services with elevated incident rates."
            />
            <IssueGroup
              title="On-call schedule gaps"
              issues={byType(issues, ['oncall_gap'])}
              onChanged={reload}
              emptyText="No coverage gaps in the next 14 days."
            />
            <IssueGroup
              title="On-call fatigue"
              issues={byType(issues, ['oncall_fatigue'])}
              onChanged={reload}
              emptyText="No fatigue risks detected."
            />
            <p className="text-xs text-muted-foreground">
              {incidentsAnalyzed} incidents analyzed over the last 30 days.
            </p>
          </div>
        );
      }}
    />
  );
}
