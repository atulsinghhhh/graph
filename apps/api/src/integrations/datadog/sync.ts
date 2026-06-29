import axios from 'axios';
import { upsertNode } from '../../graph/queries';

// ── Mock data (only used when DATADOG_MOCK_MODE=true) ────────────────────────

const MOCK_MONITORS = [
  {
    id: 5001,
    name: 'checkout.error_rate',
    message: 'Checkout error rate > 5% for 5 minutes. Investigate payment-service and checkout-api.',
    overall_state: 'Alert',
    overall_state_modified: '2026-05-15T12:35:00Z',
    priority: 1,
  },
  {
    id: 5002,
    name: 'payment.p99_latency',
    message: 'Payment service p99 latency > 3000ms for 10 minutes.',
    overall_state: 'Alert',
    overall_state_modified: '2026-05-15T12:45:00Z',
    priority: 2,
  },
  {
    id: 5003,
    name: 'api.5xx_rate',
    message: 'API gateway 5xx rate > 1% — resolved after rollback.',
    overall_state: 'OK',
    overall_state_modified: '2026-05-14T22:45:00Z',
    priority: 2,
  },
];

async function runMockDatadogSync(orgId: string): Promise<number> {
  let itemsSynced = 0;
  for (const monitor of MOCK_MONITORS) {
    await upsertNode('Alert', `datadog:monitor:${monitor.id}`, orgId, {
      datadogId: String(monitor.id),
      metric: monitor.name,
      message: monitor.message,
      firedAt: new Date(monitor.overall_state_modified).toISOString(),
      status: monitor.overall_state,
      severity: mapDdPriority(monitor.priority),
      source: 'datadog',
    });
    itemsSynced++;
  }
  return itemsSynced;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function mapDdPriority(p: number | null | undefined): 'critical' | 'high' | 'medium' | 'low' {
  switch (p) {
    case 1: return 'critical';
    case 2: return 'high';
    case 3: return 'medium';
    default: return 'low';
  }
}

// ── Real sync ─────────────────────────────────────────────────────────────────

export async function syncDatadog(
  orgId: string,
  apiKey: string,
  appKey: string,
  site: string
): Promise<number> {
  if (process.env.DATADOG_MOCK_MODE === 'true') {
    console.log('[Datadog] Mock mode — creating Alert nodes only');
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

    await upsertNode('Alert', `datadog:monitor:${monitor.id}`, orgId, {
      datadogId: String(monitor.id),
      metric: monitor.name,
      message: (monitor.message ?? '').slice(0, 500),
      firedAt,
      status: monitor.overall_state ?? 'unknown',
      severity: mapDdPriority(monitor.priority),
      source: 'datadog',
    });
    itemsSynced++;
    await sleep(100);
  }

  return itemsSynced;
}
