import axios, { AxiosInstance } from 'axios';
import { upsertNode, createRelationship, runQuery } from '../../graph/queries';
import { generateFixSuggestion } from '../../ai/fix-suggestion';
import { recordIssue, summarizeIssues, ScanIssue, ScanResult } from '../scan-types';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (attempts <= 1) throw err;
    await sleep(1500);
    return withRetry(fn, attempts - 1);
  }
}

function ddClient(apiKey: string, appKey: string, site: string): AxiosInstance {
  return axios.create({
    baseURL: `https://api.${site}`,
    timeout: 15_000,
    headers: { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey },
  });
}

// ── D1 — Monitor health ──────────────────────────────────────────────────────────

function buildProlongedAlertFix(monitorName: string, durationMin: number): string | null {
  const name = monitorName.toLowerCase();
  if (name.includes('error_rate') || name.includes('error rate')) {
    return (
      `Error rate alert on '${monitorName}' for ${durationMin} minutes.\n` +
      `1. Check the service logs for the root error: kubectl logs -n {ns} deployment/{svc} --since=${durationMin}m | grep ERROR\n` +
      `2. Check recent deployments in the last 2 hours (check the incident graph)\n` +
      `3. If error rate > 10%: consider immediate rollback\n` +
      `4. Check if it's a specific endpoint: drill into Datadog APM traces\n` +
      `5. Check downstream services — is a dependency returning errors?`
    );
  }
  if (name.includes('latency') || name.includes('p99') || name.includes('response_time')) {
    return (
      `Latency alert on '${monitorName}' for ${durationMin} minutes.\n` +
      `1. Check database query times in Datadog APM → Databases\n` +
      `2. Check if a slow query or N+1 query was recently deployed\n` +
      `3. Review CPU and memory usage — is the service under-resourced?\n` +
      `4. Check if traffic has spiked unexpectedly (check the traffic monitor)\n` +
      `5. Enable auto-scaling if not already active`
    );
  }
  if (name.includes('memory') || name.includes('cpu')) {
    return (
      `Resource alert on '${monitorName}' for ${durationMin} minutes.\n` +
      `1. Check which process is consuming the resource: kubectl top pods -n {namespace}\n` +
      `2. Check for memory leaks: has memory grown steadily over time?\n` +
      `3. If CPU: check for infinite loops or expensive operations in recent PRs\n` +
      `4. Short term: restart the service pod to relieve pressure\n` +
      `5. Long term: increase resource limits or optimize the code`
    );
  }
  if (name.includes('disk') || name.includes('storage')) {
    return (
      `Disk alert on '${monitorName}' for ${durationMin} minutes.\n` +
      `1. Find what is consuming disk space: du -sh /* | sort -rh | head -10\n` +
      `2. Common causes: log files not rotating, build artifacts not cleaned\n` +
      `3. Clear old logs: find /var/log -name '*.log' -mtime +7 -delete\n` +
      `4. If database: check for unbounded table growth or missing cleanup jobs\n` +
      `5. Increase disk size or add log rotation policy`
    );
  }
  return null;
}

async function scanMonitorHealth(dd: AxiosInstance, orgId: string, appUrl: string): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];
  let monitors: any[] = [];
  try {
    const { data } = await withRetry(() => dd.get('/api/v1/monitor', { params: { page: 0, page_size: 100 } }));
    monitors = data;
  } catch (err: any) {
    console.warn(`[DatadogDeepScan] monitor fetch failed: ${err.message}`);
    return issues;
  }

  for (const monitor of monitors) {
    if (!monitor.overall_state_modified) continue;
    const durationMin = Math.round((Date.now() - new Date(monitor.overall_state_modified).getTime()) / 60_000);

    if (monitor.overall_state === 'Alert' && durationMin > 30) {
      const hardcodedFix = buildProlongedAlertFix(monitor.name, durationMin);
      issues.push(await recordIssue({
        id: `datadog:issue:prolonged:${monitor.id}`,
        orgId,
        source: 'datadog',
        type: 'prolonged_alert',
        severity: 'critical',
        title: `Monitor alert for ${durationMin} min: ${monitor.name}`,
        description: `Monitor '${monitor.name}' has been in Alert state for ${durationMin} minutes.`,
        url: `${appUrl}/monitors/${monitor.id}`,
        fixSuggestion: hardcodedFix ?? await generateFixSuggestion({
          source: 'datadog', type: 'prolonged_alert', title: monitor.name,
          description: `Monitor '${monitor.name}' has been alerting for ${durationMin} minutes.`, severity: 'critical',
        }),
      }));
    } else if (monitor.overall_state === 'No Data' && durationMin > 60) {
      issues.push(await recordIssue({
        id: `datadog:issue:nodata:${monitor.id}`,
        orgId,
        source: 'datadog',
        type: 'no_data',
        severity: 'high',
        title: `No data received: ${monitor.name} (${durationMin} min)`,
        description: `Monitor '${monitor.name}' has received no data for ${durationMin} minutes.`,
        url: `${appUrl}/monitors/${monitor.id}`,
        fixSuggestion:
          `Monitor '${monitor.name}' has received no data for ${durationMin} minutes.\n` +
          `1. Check if the service sending metrics is running: kubectl get pods -n {namespace} or check AWS ECS console\n` +
          `2. Check Datadog Agent status on the host: datadog-agent status\n` +
          `3. Verify the metric name hasn't changed due to a recent deployment\n` +
          `4. Check API key is valid: datadog-agent check\n` +
          `5. Look for recent deployments that may have broken metric reporting`,
      }));
    }
  }

  return issues;
}

// ── D2 — Anomaly detection ───────────────────────────────────────────────────────

async function scanAnomalies(dd: AxiosInstance, orgId: string, appUrl: string): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];
  const start = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
  const end = Math.floor(Date.now() / 1000);

  let events: any[] = [];
  try {
    const { data } = await withRetry(() => dd.get('/api/v1/events', { params: { start, end, priority: 'all' } }));
    events = data.events ?? [];
  } catch (err: any) {
    console.warn(`[DatadogDeepScan] events fetch failed: ${err.message}`);
    return issues;
  }

  const errorEvents = events.filter(e => e.alert_type === 'error');
  const bySource = new Map<string, any[]>();
  for (const e of errorEvents) {
    const source = e.source ?? e.host ?? 'unknown';
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source)!.push(e);
  }

  for (const [source, group] of bySource) {
    if (group.length < 3) continue;
    issues.push(await recordIssue({
      id: `datadog:issue:spike:${source}`,
      orgId,
      source: 'datadog',
      type: 'error_spike',
      severity: 'high',
      title: `Error spike: ${group.length} errors from ${source} in 1 hour`,
      description: `${source} generated ${group.length} error events in the last hour.`,
      url: `${appUrl}/event/stream?tags=source:${source}`,
      fixSuggestion:
        `${source} generated ${group.length} errors in the last hour.\n` +
        `1. View the full error log in Datadog Events: site/event/stream?tags=source:${source}\n` +
        `2. Check if this started after a specific deployment (correlation window: deployment ±30 minutes before first error)\n` +
        `3. If a known error pattern: check existing runbooks\n` +
        `4. Silence the monitor temporarily while investigating to prevent alert fatigue, but set a reminder to unsilence in 2 hours\n` +
        `5. Open a Jira incident ticket if not already created`,
    }));
  }

  return issues;
}

// ── D3 — Deployment tracking and correlation ────────────────────────────────────

async function scanDeploymentCorrelation(dd: AxiosInstance, orgId: string): Promise<number> {
  const start = Math.floor((Date.now() - 2 * 60 * 60 * 1000) / 1000);
  const end = Math.floor(Date.now() / 1000);

  let events: any[] = [];
  try {
    const { data } = await withRetry(() => dd.get('/api/v1/events', { params: { start, end, tags: 'deployment' } }));
    events = data.events ?? [];
  } catch (err: any) {
    console.warn(`[DatadogDeepScan] deployment events fetch failed: ${err.message}`);
    return 0;
  }

  let correlated = 0;
  for (const event of events) {
    const service = event.tags?.find((t: string) => t.startsWith('service:'))?.split(':')[1] ?? 'unknown';
    const deployId = `datadog:deploy:${event.id}`;
    const deployedAt = new Date(event.date_happened * 1000).toISOString();

    await upsertNode('Deployment', deployId, orgId, {
      datadogEventId: String(event.id),
      service,
      version: event.text?.slice(0, 100) ?? null,
      deployedAt,
      deployedBy: event.host ?? null,
      source: 'datadog',
    });

    // Correlate against alerts that fired within 30 minutes after this deployment.
    const windowEnd = new Date(new Date(deployedAt).getTime() + 30 * 60_000).toISOString();
    const records = await runQuery<{ id: string; firedAt: string }>(
      `MATCH (a:Alert { orgId: $orgId })
       WHERE a.firedAt >= $deployedAt AND a.firedAt <= $windowEnd
       RETURN a.id AS id, a.firedAt AS firedAt`,
      { orgId, deployedAt, windowEnd }
    );

    for (const alert of records) {
      const gapMinutes = (new Date(alert.firedAt).getTime() - new Date(deployedAt).getTime()) / 60_000;
      const confidence = Math.max(0, 1 - gapMinutes / 30);
      await createRelationship('Deployment', deployId, 'Alert', alert.id, 'TRIGGERED_BY_DEPLOY', orgId, { confidence });
      correlated++;
    }
  }

  return correlated;
}

// ── D4 — SLO health ──────────────────────────────────────────────────────────────

async function scanSloHealth(dd: AxiosInstance, orgId: string, appUrl: string): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];
  let slos: any[] = [];
  try {
    const { data } = await withRetry(() => dd.get('/api/v1/slo'));
    slos = data.data ?? [];
  } catch (err: any) {
    console.warn(`[DatadogDeepScan] SLO fetch failed: ${err.message}`);
    return issues;
  }

  for (const slo of slos) {
    await sleep(100);
    let current: number | null = null;
    try {
      const from = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
      const to = Math.floor(Date.now() / 1000);
      const { data } = await withRetry(() => dd.get(`/api/v1/slo/${slo.id}/history`, { params: { from_ts: from, to_ts: to } }));
      current = data.data?.overall?.sli_value ?? null;
    } catch (err: any) {
      console.warn(`[DatadogDeepScan] SLO history fetch failed for ${slo.id}: ${err.message}`);
    }
    if (current === null) continue;

    const target = slo.thresholds?.[0]?.target ?? 99;
    const errorBudgetRemaining = Math.max(0, 100 - ((100 - current) / (100 - target)) * 100);

    await upsertNode('SLO', `datadog:slo:${slo.id}`, orgId, {
      name: slo.name,
      target,
      current,
      errorBudgetRemaining,
      type: slo.type ?? 'metric',
    });

    if (errorBudgetRemaining < 20) {
      const burnRate = (100 - current) || 0.01;
      const estimatedDays = Math.max(1, Math.round(errorBudgetRemaining / (burnRate / 30)));
      issues.push(await recordIssue({
        id: `datadog:issue:slo:${slo.id}`,
        orgId,
        source: 'datadog',
        type: 'slo_at_risk',
        severity: 'high',
        title: `SLO at risk: ${slo.name} — ${Math.round(errorBudgetRemaining)}% error budget left`,
        description: `SLO '${slo.name}' has ${Math.round(errorBudgetRemaining)}% error budget remaining for the period.`,
        url: `${appUrl}/slo/${slo.id}`,
        fixSuggestion:
          `SLO '${slo.name}' has only ${Math.round(errorBudgetRemaining)}% error budget remaining for the period. ` +
          `At current error rate, SLO will be breached in approximately ${estimatedDays} days.\n` +
          `1. Freeze non-critical deployments to this service\n` +
          `2. Prioritize reliability work over new features\n` +
          `3. Review and fix the top 3 contributors to errors this month\n` +
          `4. Consider temporarily relaxing SLO if it was too aggressive\n` +
          `5. Alert stakeholders that the service is in a reliability deficit`,
      }));
    }
  }

  return issues;
}

// ── D5 — Unmonitored service detection ──────────────────────────────────────────

async function scanUnmonitoredServices(orgId: string, monitorNames: string[], appUrl: string): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];
  const services = await runQuery<{ id: string; name: string }>(
    `MATCH (s:Service { orgId: $orgId }) RETURN s.id AS id, s.name AS name`,
    { orgId }
  );

  const lowerMonitorNames = monitorNames.map(n => n.toLowerCase());

  for (const service of services) {
    const covered = lowerMonitorNames.some(n => n.includes(service.name.toLowerCase()));
    if (covered) continue;

    issues.push(await recordIssue({
      id: `datadog:issue:unmonitored:${service.id}`,
      orgId,
      source: 'datadog',
      type: 'unmonitored_service',
      severity: 'medium',
      title: `Service '${service.name}' has no Datadog monitors`,
      description: `No Datadog monitor name references '${service.name}'.`,
      url: `${appUrl}/monitors/manage`,
      fixSuggestion:
        `Service '${service.name}' is not monitored in Datadog. Minimum monitors to create:\n` +
        `1. Error rate: sum:trace.${service.name}.errors{service:${service.name}}.as_rate()\n` +
        `2. Latency p99: p99:trace.${service.name}.duration{service:${service.name}}\n` +
        `3. Throughput: sum:trace.${service.name}.hits{service:${service.name}}.as_rate()\n` +
        `4. Create all three via Datadog → Monitors → New Monitor → APM\n` +
        `5. Set alert thresholds based on historical baselines`,
    }));
  }

  return issues;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────────

export async function runDatadogDeepScan(
  orgId: string,
  apiKey: string,
  appKey: string,
  site: string
): Promise<ScanResult> {
  const dd = ddClient(apiKey, appKey, site);
  const appUrl = `https://app.${site}`;

  let monitorNames: string[] = [];
  try {
    const { data } = await withRetry(() => dd.get('/api/v1/monitor', { params: { page: 0, page_size: 100 } }));
    monitorNames = (data as any[]).map(m => m.name);
  } catch {
    // handled again inside scanMonitorHealth; unmonitored-service scan just sees an empty list
  }

  const [monitorIssues, anomalyIssues, correlatedCount, sloIssues, unmonitoredIssues] = await Promise.all([
    scanMonitorHealth(dd, orgId, appUrl).catch(err => { console.warn('[DatadogDeepScan] monitor scan failed:', err.message); return []; }),
    scanAnomalies(dd, orgId, appUrl).catch(err => { console.warn('[DatadogDeepScan] anomaly scan failed:', err.message); return []; }),
    scanDeploymentCorrelation(dd, orgId).catch(err => { console.warn('[DatadogDeepScan] correlation scan failed:', err.message); return 0; }),
    scanSloHealth(dd, orgId, appUrl).catch(err => { console.warn('[DatadogDeepScan] SLO scan failed:', err.message); return []; }),
    scanUnmonitoredServices(orgId, monitorNames, appUrl).catch(err => { console.warn('[DatadogDeepScan] unmonitored scan failed:', err.message); return []; }),
  ]);

  const allIssues = [...monitorIssues, ...anomalyIssues, ...sloIssues, ...unmonitoredIssues];

  return summarizeIssues(allIssues, monitorNames.length, { monitors: monitorNames.length, deploymentsCorrelated: correlatedCount });
}
