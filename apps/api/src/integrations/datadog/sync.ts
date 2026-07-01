import axios from 'axios';
import { upsertNode } from '../../graph/queries';

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
