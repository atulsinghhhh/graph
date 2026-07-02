'use client';

import ToolReportPage, { IssueGroup, type ScanIssue } from '@/components/reports/ToolReportPage';

function byType(issues: ScanIssue[], types: string[]): ScanIssue[] {
  return issues.filter(i => types.includes(i.type));
}

export default function DatadogReportPage() {
  return (
    <ToolReportPage
      tool="datadog"
      title="Datadog Report"
      scheduleMinutes={15}
      renderSections={(report, issues, reload) => {
        const monitors: number = report?.raw_stats?.monitors ?? 0;
        const deploymentsCorrelated: number = report?.raw_stats?.deploymentsCorrelated ?? 0;

        return (
          <div className="flex flex-col gap-6">
            <IssueGroup
              title="Active alerts"
              issues={byType(issues, ['prolonged_alert', 'no_data'])}
              onChanged={reload}
              emptyText="No prolonged alerts or data gaps."
            />
            <IssueGroup
              title="Error spikes (last 24h)"
              issues={byType(issues, ['error_spike'])}
              onChanged={reload}
              emptyText="No error spikes detected."
            />
            <IssueGroup
              title="SLOs at risk"
              issues={byType(issues, ['slo_at_risk'])}
              onChanged={reload}
              emptyText="All SLOs have healthy error budgets."
            />
            <IssueGroup
              title="Unmonitored services"
              issues={byType(issues, ['unmonitored_service'])}
              onChanged={reload}
              emptyText="Every service has monitor coverage."
            />
            <p className="text-xs text-muted-foreground">
              {monitors} monitors scanned · {deploymentsCorrelated} deployments correlated to alerts in this scan.
            </p>
          </div>
        );
      }}
    />
  );
}
