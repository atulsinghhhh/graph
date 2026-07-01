import axios, { AxiosInstance } from 'axios';
import { upsertNode, runQuery } from '../../graph/queries';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function pdClient(apiKey: string): AxiosInstance {
  return axios.create({
    baseURL: 'https://api.pagerduty.com',
    timeout: 15_000,
    headers: {
      Authorization: `Token token=${apiKey}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
    },
  });
}

function mapUrgencyToSeverity(urgency: string): string {
  return urgency === 'high' ? 'high' : 'medium';
}

export interface PagerDutySyncResult {
  itemsSynced: number;
  services: number;
  onCallSchedules: number;
}

export async function syncPagerDuty(orgId: string, apiKey: string): Promise<PagerDutySyncResult> {
  const pd = pdClient(apiKey);
  let itemsSynced = 0;

  // Services — counted for sync stats; not modeled as graph nodes to avoid
  // conflating PagerDuty's "service" concept with the GitHub-repo Service nodes.
  let serviceCount = 0;
  try {
    const { data } = await pd.get('/services', { params: { limit: 100 } });
    serviceCount = (data.services ?? []).length;
  } catch (err: any) {
    console.warn(`[PagerDuty] services fetch failed: ${err.message}`);
  }

  // Incidents from the last 30 days
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let incidents: any[] = [];
  try {
    const { data } = await pd.get('/incidents', { params: { since, limit: 100 } });
    incidents = data.incidents ?? [];
  } catch (err: any) {
    console.warn(`[PagerDuty] incidents fetch failed: ${err.message}`);
  }

  for (const incident of incidents) {
    await sleep(50);
    const title: string = incident.title ?? incident.summary ?? 'PagerDuty incident';
    const assignedTo = incident.assignments?.[0]?.assignee?.summary ?? null;

    // Link to an existing Incident with the same title if one exists (e.g. from Jira/GitHub sync)
    const existing = await runQuery<{ id: string }>(
      `MATCH (i:Incident { orgId: $orgId })
       WHERE toLower(i.title) = toLower($title)
       RETURN i.id AS id LIMIT 1`,
      { orgId, title }
    );

    const incidentId = existing[0]?.id ?? `pagerduty:${incident.id}`;

    const incidentProps: Record<string, unknown> = {
      title,
      severity: mapUrgencyToSeverity(incident.urgency),
      status: incident.status === 'resolved' ? 'resolved' : 'open',
      startedAt: incident.created_at,
      resolvedAt: incident.status === 'resolved' ? incident.last_status_change_at : null,
      pagerdutyId: incident.id,
      urgency: incident.urgency,
      assignedTo,
    };
    if (!existing[0]?.id) incidentProps.source = 'pagerduty';

    await upsertNode('Incident', incidentId, orgId, incidentProps);
    itemsSynced++;
  }

  // On-call schedules
  let oncalls: any[] = [];
  try {
    const { data } = await pd.get('/oncalls', { params: { limit: 100 } });
    oncalls = data.oncalls ?? [];
  } catch (err: any) {
    console.warn(`[PagerDuty] oncalls fetch failed: ${err.message}`);
  }

  for (const oncall of oncalls) {
    await sleep(50);
    const email: string | null = oncall.user?.email ?? null;
    if (!email) continue;

    const matches = await runQuery<{ id: string }>(
      `MATCH (e:Engineer { orgId: $orgId })
       WHERE toLower(e.email) = toLower($email)
       RETURN e.id AS id LIMIT 1`,
      { orgId, email }
    );
    const engineerId = matches[0]?.id;
    if (!engineerId) continue;

    await upsertNode('Engineer', engineerId, orgId, {
      onCallUntil: oncall.end ?? null,
      escalationPolicy: oncall.escalation_policy?.summary ?? null,
    });
    itemsSynced++;
  }

  return { itemsSynced, services: serviceCount, onCallSchedules: oncalls.length };
}
