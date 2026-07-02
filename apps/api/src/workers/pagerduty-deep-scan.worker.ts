import Queue from 'bull';
import { getSupabase } from '../config/postgres';
import { runPagerDutyDeepScan } from '../integrations/pagerduty/deep-scan';
import { buildScanSummary } from '../ai/scan-summary';

export const pagerdutyDeepScanQueue = new Queue('pagerduty-deep-scan', process.env.REDIS_URL!);

pagerdutyDeepScanQueue.process(async () => {
  const supabase = getSupabase();

  const { data: integrations } = await supabase
    .from('integrations')
    .select('id, org_id, extra_data')
    .eq('provider', 'pagerduty')
    .eq('status', 'connected');

  for (const integ of integrations ?? []) {
    const { apiKey } = (integ.extra_data ?? {}) as { apiKey?: string };
    if (!apiKey) continue;

    try {
      const scan = await runPagerDutyDeepScan(integ.org_id, apiKey);
      const summaryText = await buildScanSummary('pagerduty', scan.issuesFound);

      await supabase.from('tool_scan_reports').insert({
        org_id: integ.org_id,
        tool: 'pagerduty',
        items_scanned: scan.itemsScanned,
        issues_found: scan.issuesFound,
        critical_count: scan.criticalCount,
        high_count: scan.highCount,
        summary_text: summaryText,
        raw_stats: scan.rawStats,
      });
    } catch (err: any) {
      console.error(`[PagerDutyDeepScan] scan failed for org ${integ.org_id}:`, err.message);
    }
  }
});

export async function registerPagerDutyDeepScanScheduler(): Promise<void> {
  const existing = await pagerdutyDeepScanQueue.getRepeatableJobs();
  if (existing.length === 0) {
    await pagerdutyDeepScanQueue.add({}, { repeat: { every: 15 * 60 * 1000 }, jobId: 'pagerduty-deep-scan-every-15min' });
  }
}
