import { AxiosInstance } from 'axios';
import { pdClient } from './sync';
import { upsertNode, createRelationship, runQuery } from '../../graph/queries';
import { recordIssue, summarizeIssues, ScanIssue, ScanResult } from '../scan-types';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Matches the existing sync's id scheme (pagerduty:{id}, or an existing Incident by title)
// so deep-scan updates the same node instead of creating a duplicate.
async function resolveIncidentId(orgId: string, pdIncident: any): Promise<string> {
  const title: string = pdIncident.title ?? pdIncident.summary ?? 'PagerDuty incident';
  const existing = await runQuery<{ id: string }>(
    `MATCH (i:Incident { orgId: $orgId }) WHERE toLower(i.title) = toLower($title) RETURN i.id AS id LIMIT 1`,
    { orgId, title }
  );
  return existing[0]?.id ?? `pagerduty:${pdIncident.id}`;
}

// ── P1 — Active incidents ────────────────────────────────────────────────────────

async function scanActiveIncidents(pd: AxiosInstance, orgId: string): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];
  let incidents: any[] = [];
  try {
    const { data } = await pd.get('/incidents', {
      params: { 'statuses[]': ['triggered', 'acknowledged'], limit: 100 },
    });
    incidents = data.incidents ?? [];
  } catch (err: any) {
    console.warn(`[PagerDutyDeepScan] active incidents fetch failed: ${err.message}`);
    return issues;
  }

  for (const incident of incidents) {
    const incidentId = await resolveIncidentId(orgId, incident);
    const assignedTo = incident.assignments?.[0]?.assignee?.summary ?? null;

    await upsertNode('Incident', incidentId, orgId, {
      title: incident.title ?? incident.summary,
      severity: incident.urgency === 'high' ? 'critical' : 'high',
      status: incident.status,
      startedAt: incident.created_at,
      assignedTo,
      serviceId: incident.service?.id ?? null,
      serviceName: incident.service?.summary ?? null,
      escalationPolicy: incident.escalation_policy?.summary ?? null,
      url: incident.html_url,
      source: 'pagerduty',
    });

    const ageMin = Math.round((Date.now() - new Date(incident.created_at).getTime()) / 60_000);
    if (incident.status === 'triggered' && ageMin > 5) {
      issues.push(await recordIssue({
        id: `pagerduty:issue:unack:${incident.id}`,
        orgId,
        source: 'pagerduty',
        type: 'unacknowledged_page',
        severity: 'critical',
        title: `Unacknowledged page: ${incident.title ?? incident.summary} — ${ageMin} min`,
        description: `PagerDuty incident '${incident.title ?? incident.summary}' has not been acknowledged after ${ageMin} minutes.`,
        url: incident.html_url ?? '',
        fixSuggestion:
          `PagerDuty incident '${incident.title ?? incident.summary}' has not been acknowledged after ${ageMin} minutes.\n` +
          `1. Check if ${assignedTo ?? 'the assignee'} is reachable — try Slack, phone, backup contact\n` +
          `2. Escalate to next level in escalation policy: ${incident.escalation_policy?.summary ?? 'unknown'}\n` +
          `3. Manually acknowledge the incident in PagerDuty to stop escalation\n` +
          `4. If no one responds in 10 more minutes: escalate to manager\n` +
          `5. Check if on-call rotation is correctly configured`,
      }));
    }
  }

  return issues;
}

// ── P2 — On-call schedule health ─────────────────────────────────────────────────

async function scanOnCallHealth(pd: AxiosInstance, orgId: string): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];

  let schedules: any[] = [];
  try {
    const { data } = await pd.get('/schedules', { params: { limit: 100 } });
    schedules = data.schedules ?? [];
  } catch (err: any) {
    console.warn(`[PagerDutyDeepScan] schedules fetch failed: ${err.message}`);
    return issues;
  }

  const windowStart = new Date();
  const windowEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  for (const schedule of schedules) {
    await sleep(100);

    await upsertNode('OnCallSchedule', `pagerduty:schedule:${schedule.id}`, orgId, {
      name: schedule.name,
      timeZone: schedule.time_zone ?? null,
    });

    let entries: any[] = [];
    try {
      const { data } = await pd.get('/oncalls', {
        params: { 'schedule_ids[]': [schedule.id], since: windowStart.toISOString(), until: windowEnd.toISOString() },
      });
      entries = data.oncalls ?? [];
    } catch (err: any) {
      console.warn(`[PagerDutyDeepScan] oncalls fetch failed for schedule ${schedule.id}: ${err.message}`);
      continue;
    }
    if (entries.length === 0) continue;

    // Coverage gap: sort entries and look for time ranges with no active on-call.
    const sorted = entries
      .filter(e => e.start && e.end)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    let cursor = windowStart.getTime();
    for (const entry of sorted) {
      const entryStart = new Date(entry.start).getTime();
      if (entryStart > cursor + 5 * 60_000) {
        // gap of more than 5 minutes
        const gapStart = new Date(cursor).toISOString();
        const gapEnd = entry.start;
        issues.push(await recordIssue({
          id: `pagerduty:issue:gap:${schedule.id}:${cursor}`,
          orgId,
          source: 'pagerduty',
          type: 'oncall_gap',
          severity: 'critical',
          title: `On-call gap: ${schedule.name} has no coverage from ${gapStart} to ${gapEnd}`,
          description: `Schedule '${schedule.name}' has a coverage gap between ${gapStart} and ${gapEnd}.`,
          url: schedule.html_url ?? '',
          fixSuggestion:
            `There is an on-call coverage gap for ${schedule.name}.\n` +
            `1. Immediately assign someone to cover ${gapStart} to ${gapEnd}\n` +
            `2. Go to PagerDuty → Schedules → ${schedule.name} → Add override\n` +
            `3. Long term: ensure at least 2 people in each on-call rotation\n` +
            `4. Set up escalation policies with automatic escalation after 5 minutes\n` +
            `5. Consider rotating on-call more frequently to reduce burnout`,
        }));
      }
      cursor = Math.max(cursor, new Date(entry.end).getTime());
    }

    // Fatigue: same user covering 5+ consecutive days across adjacent entries.
    const byUser = new Map<string, { name: string; totalMs: number }>();
    for (const entry of sorted) {
      const userId = entry.user?.id;
      if (!userId) continue;
      const durationMs = new Date(entry.end).getTime() - new Date(entry.start).getTime();
      const existing = byUser.get(userId) ?? { name: entry.user.summary, totalMs: 0 };
      existing.totalMs += durationMs;
      byUser.set(userId, existing);
    }
    for (const [, info] of byUser) {
      const days = Math.round(info.totalMs / 86_400_000);
      if (days >= 5) {
        issues.push(await recordIssue({
          id: `pagerduty:issue:fatigue:${schedule.id}:${info.name}`,
          orgId,
          source: 'pagerduty',
          type: 'oncall_fatigue',
          severity: 'medium',
          title: `On-call fatigue risk: ${info.name} on call for ${days} days`,
          description: `${info.name} is scheduled for ${days} consecutive days on ${schedule.name} in the next 14 days.`,
          url: schedule.html_url ?? '',
          fixSuggestion:
            `${info.name} has been on call for ${days} consecutive days.\n` +
            `1. Swap with another qualified team member immediately\n` +
            `2. Check the PagerDuty schedule for the next 2 weeks and balance\n` +
            `3. Ensure ${info.name} gets equal time off-call after extended shifts\n` +
            `4. Consider hiring if the team is too small to rotate fairly\n` +
            `5. Document a policy: max 5 consecutive days on call`,
        }));
      }
    }
  }

  return issues;
}

// ── P3 — Incident frequency analysis ────────────────────────────────────────────

async function scanIncidentFrequency(pd: AxiosInstance, orgId: string, incidents: any[]): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const byService = new Map<string, any[]>();
  for (const incident of incidents) {
    if (new Date(incident.created_at).getTime() < sevenDaysAgo) continue;
    const serviceName = incident.service?.summary ?? 'unknown service';
    if (!byService.has(serviceName)) byService.set(serviceName, []);
    byService.get(serviceName)!.push(incident);
  }

  for (const [serviceName, group] of byService) {
    if (group.length < 5) continue;

    const hourCounts = new Map<number, number>();
    const dayCounts = new Map<string, number>();
    for (const inc of group) {
      const d = new Date(inc.created_at);
      hourCounts.set(d.getUTCHours(), (hourCounts.get(d.getUTCHours()) ?? 0) + 1);
      const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
      dayCounts.set(dayName, (dayCounts.get(dayName) ?? 0) + 1);
    }
    const peakHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const peakDay = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    if (peakHour !== null) {
      await runQuery(
        `MATCH (s:Service { orgId: $orgId }) WHERE toLower(s.name) CONTAINS toLower($serviceName)
         SET s.peakIncidentHour = $peakHour, s.peakIncidentDay = $peakDay`,
        { orgId, serviceName, peakHour, peakDay }
      ).catch(() => {});
    }

    issues.push(await recordIssue({
      id: `pagerduty:issue:frequency:${serviceName}`,
      orgId,
      source: 'pagerduty',
      type: 'high_incident_rate',
      severity: 'high',
      title: `${serviceName} had ${group.length} incidents in 7 days`,
      description: `${serviceName} generated ${group.length} PagerDuty incidents in the last 7 days.`,
      url: '',
      fixSuggestion:
        `${serviceName} is generating too many incidents.\n` +
        `1. Pull all incidents for this service and find common patterns\n` +
        `2. Check if the alerting threshold is correctly calibrated (too sensitive = alert fatigue, too lax = missed outages)\n` +
        `3. Review recent deployments to ${serviceName} — is a new version flaky?\n` +
        `4. Add a dedicated 'reduce incidents' task to the next sprint\n` +
        `5. Consider a pre/post deployment smoke test to catch issues early`,
    }));
  }

  return issues;
}

// ── P4 — MTTA / MTTR tracking ────────────────────────────────────────────────────

async function scanMttaMttr(orgId: string, incidents: any[]): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];

  const byService = new Map<string, any[]>();
  for (const incident of incidents) {
    const serviceName = incident.service?.summary ?? 'unknown service';
    if (!byService.has(serviceName)) byService.set(serviceName, []);
    byService.get(serviceName)!.push(incident);
  }

  for (const [serviceName, group] of byService) {
    const acknowledgeTimes: number[] = [];
    const resolveTimes: number[] = [];

    for (const inc of group) {
      const createdAt = new Date(inc.created_at).getTime();
      const ackAt = inc.acknowledgements?.[0]?.at;
      if (ackAt) acknowledgeTimes.push((new Date(ackAt).getTime() - createdAt) / 60_000);
      if (inc.status === 'resolved' && inc.last_status_change_at) {
        resolveTimes.push((new Date(inc.last_status_change_at).getTime() - createdAt) / 60_000);
      }
    }

    if (acknowledgeTimes.length === 0 && resolveTimes.length === 0) continue;

    const mtta = acknowledgeTimes.length > 0 ? Math.round(acknowledgeTimes.reduce((a, b) => a + b, 0) / acknowledgeTimes.length) : null;
    const mttr = resolveTimes.length > 0 ? Math.round(resolveTimes.reduce((a, b) => a + b, 0) / resolveTimes.length) : null;

    await runQuery(
      `MATCH (s:Service { orgId: $orgId }) WHERE toLower(s.name) CONTAINS toLower($serviceName)
       SET s.mtta = $mtta, s.mttr = $mttr, s.mttaTarget = 5, s.mttrTarget = 60`,
      { orgId, serviceName, mtta, mttr }
    ).catch(() => {});

    if (mtta !== null && mtta > 15) {
      issues.push(await recordIssue({
        id: `pagerduty:issue:high-mtta:${serviceName}`,
        orgId,
        source: 'pagerduty',
        type: 'high_mtta',
        severity: 'high',
        title: `${serviceName} MTTA is ${mtta} min — target is 5 min`,
        description: `Mean time to acknowledge for ${serviceName} is ${mtta} minutes over the last 30 days.`,
        url: '',
        fixSuggestion:
          `Mean time to acknowledge for ${serviceName} is ${mtta} minutes.\n` +
          `1. Review on-call notification settings — are pages going to the right person?\n` +
          `2. Check if phone/SMS escalation is enabled (not just email)\n` +
          `3. Add a backup escalation after 5 minutes of no acknowledgment\n` +
          `4. Run a paging test drill with the current on-call engineer\n` +
          `5. Review if the service's escalation policy is correctly configured`,
      }));
    }
  }

  return issues;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────────

export async function runPagerDutyDeepScan(orgId: string, apiKey: string): Promise<ScanResult> {
  const pd = pdClient(apiKey);

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let last30DaysIncidents: any[] = [];
  try {
    const { data } = await pd.get('/incidents', { params: { since, limit: 100 } });
    last30DaysIncidents = data.incidents ?? [];
  } catch (err: any) {
    console.warn(`[PagerDutyDeepScan] 30-day incidents fetch failed: ${err.message}`);
  }

  const [activeIssues, onCallIssues, frequencyIssues, mttaIssues] = await Promise.all([
    scanActiveIncidents(pd, orgId).catch(err => { console.warn('[PagerDutyDeepScan] active scan failed:', err.message); return []; }),
    scanOnCallHealth(pd, orgId).catch(err => { console.warn('[PagerDutyDeepScan] on-call scan failed:', err.message); return []; }),
    scanIncidentFrequency(pd, orgId, last30DaysIncidents).catch(err => { console.warn('[PagerDutyDeepScan] frequency scan failed:', err.message); return []; }),
    scanMttaMttr(orgId, last30DaysIncidents).catch(err => { console.warn('[PagerDutyDeepScan] MTTA/MTTR scan failed:', err.message); return []; }),
  ]);

  const allIssues = [...activeIssues, ...onCallIssues, ...frequencyIssues, ...mttaIssues];

  return summarizeIssues(allIssues, last30DaysIncidents.length, { incidentsAnalyzed: last30DaysIncidents.length });
}
