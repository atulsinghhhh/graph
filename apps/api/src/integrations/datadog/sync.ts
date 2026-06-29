import axios from 'axios';
import { upsertNode, runQuery } from '../../graph/queries';

// ── Mock data (only used when DATADOG_MOCK_MODE=true) ────────────────────────
const MOCK_MONITORS = [
  {
    id: 5001,
    name: 'Checkout Error Rate',
    message: 'Error rate above 5%',
    overall_state: 'Alert',
    overall_state_modified: '2026-06-29T10:15:00Z',
  },
];

async function runMockDatadogSync(orgId: string): Promise<number> {
  let itemsSynced = 0;
  for (const monitor of MOCK_MONITORS) {
    const firedAt = new Date(monitor.overall_state_modified).toISOString();
    const alertId = `datadog:monitor:${monitor.id}`;

    await upsertNode('Alert', alertId, orgId, {
      datadogId: String(monitor.id),
      metric: monitor.name,
      message: monitor.message,
      firedAt,
      status: monitor.overall_state,
      source: 'datadog',
    });
    itemsSynced++;

    const deployWindowStart = new Date(new Date(firedAt).getTime() - 60 * 60 * 1000).toISOString();
    await runQuery(
      `MATCH (d:Deployment { orgId: $orgId })
       MATCH (a:Alert { id: $alertId, orgId: $orgId })
       WHERE d.deployedAt <= $firedAt AND d.deployedAt >= $windowStart
       WITH d, a, duration.inSeconds(datetime(d.deployedAt), datetime($firedAt)).seconds AS gapSec
       WITH d, a, gapSec, 1.0 - (toFloat(gapSec) / 3600.0) AS confidence
       WHERE confidence > 0.1
       MERGE (d)-[r:TRIGGERED]->(a)
       SET r.confidence = confidence`,
      { orgId, alertId, firedAt, windowStart: deployWindowStart }
    );

    const incStart = new Date(new Date(firedAt).getTime() - 30 * 60 * 1000).toISOString();
    const incEnd   = new Date(new Date(firedAt).getTime() + 30 * 60 * 1000).toISOString();
    await runQuery(
      `MATCH (i:Incident { orgId: $orgId })
       MATCH (a:Alert { id: $alertId, orgId: $orgId })
       WHERE i.startedAt >= $incStart AND i.startedAt <= $incEnd
       MERGE (i)-[:HAS_ALERT]->(a)`,
      { orgId, alertId, incStart, incEnd }
    );
  }
  return itemsSynced;
}

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

function parseDatadogTs(ts: number | string | null | undefined): string | null {
  if (!ts) return null;
  if (typeof ts === 'number') return new Date(ts * 1000).toISOString();
  return new Date(ts).toISOString();
}

export async function syncDatadog(
  orgId: string,
  apiKey: string,
  appKey: string,
  site: string
): Promise<number> {
  if (process.env.DATADOG_MOCK_MODE === 'true') {
    console.log('[Datadog] Mock mode enabled — skipping real API calls');
    return runMockDatadogSync(orgId);
  }

  const base = `https://api.${site}`;
  const headers = { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey };
  let itemsSynced = 0;

  const { data: monitors } = await withRetry(() =>
    axios.get(`${base}/api/v1/monitor`, {
      headers,
      params: { page: 0, page_size: 100 },
    })
  );

  for (const monitor of monitors as any[]) {
    const firedAt = parseDatadogTs(monitor.overall_state_modified);
    if (!firedAt) continue;

    const alertId = `datadog:monitor:${monitor.id}`;

    await upsertNode('Alert', alertId, orgId, {
      datadogId: String(monitor.id),
      metric: monitor.name,
      message: (monitor.message ?? '').slice(0, 500),
      firedAt,
      status: monitor.overall_state ?? 'unknown',
      source: 'datadog',
    });
    itemsSynced++;

    // Link deployments fired within 60 min before this alert
    const deployWindowStart = new Date(new Date(firedAt).getTime() - 60 * 60 * 1000).toISOString();
    await runQuery(
      `MATCH (d:Deployment { orgId: $orgId })
       MATCH (a:Alert { id: $alertId, orgId: $orgId })
       WHERE d.deployedAt <= $firedAt AND d.deployedAt >= $windowStart
       WITH d, a,
         duration.inSeconds(datetime(d.deployedAt), datetime($firedAt)).seconds AS gapSec
       WITH d, a, gapSec, 1.0 - (toFloat(gapSec) / 3600.0) AS confidence
       WHERE confidence > 0.1
       MERGE (d)-[r:TRIGGERED]->(a)
       SET r.confidence = confidence`,
      { orgId, alertId, firedAt, windowStart: deployWindowStart }
    );

    // Link incidents within ±30 min of this alert
    const incStart = new Date(new Date(firedAt).getTime() - 30 * 60 * 1000).toISOString();
    const incEnd   = new Date(new Date(firedAt).getTime() + 30 * 60 * 1000).toISOString();
    await runQuery(
      `MATCH (i:Incident { orgId: $orgId })
       MATCH (a:Alert { id: $alertId, orgId: $orgId })
       WHERE i.startedAt >= $incStart AND i.startedAt <= $incEnd
       MERGE (i)-[:FIRED]->(a)`,
      { orgId, alertId, incStart, incEnd }
    );

    await sleep(100);
  }

  return itemsSynced;
}
