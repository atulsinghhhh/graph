import Queue from 'bull';
import { getSupabase } from '../config/postgres';
import { runDatadogDeepScan } from '../integrations/datadog/deep-scan';
import { buildScanSummary } from '../ai/scan-summary';

export const datadogDeepScanQueue = new Queue('datadog-deep-scan', process.env.REDIS_URL!);

datadogDeepScanQueue.process(async () => {
  const supabase = getSupabase();

  const { data: integrations } = await supabase
    .from('integrations')
    .select('id, org_id, extra_data')
    .eq('provider', 'datadog')
    .eq('status', 'connected');

  for (const integ of integrations ?? []) {
    const { apiKey, appKey, site } = (integ.extra_data ?? {}) as { apiKey?: string; appKey?: string; site?: string };
    if (!apiKey || !appKey) continue;

    try {
      const scan = await runDatadogDeepScan(integ.org_id, apiKey, appKey, site ?? 'datadoghq.com');
      const summaryText = await buildScanSummary('datadog', scan.issuesFound);

      await supabase.from('tool_scan_reports').insert({
        org_id: integ.org_id,
        tool: 'datadog',
        items_scanned: scan.itemsScanned,
        issues_found: scan.issuesFound,
        critical_count: scan.criticalCount,
        high_count: scan.highCount,
        summary_text: summaryText,
        raw_stats: scan.rawStats,
      });
    } catch (err: any) {
      console.error(`[DatadogDeepScan] scan failed for org ${integ.org_id}:`, err.message);
    }
  }
});

export async function registerDatadogDeepScanScheduler(): Promise<void> {
  const existing = await datadogDeepScanQueue.getRepeatableJobs();
  if (existing.length === 0) {
    await datadogDeepScanQueue.add({}, { repeat: { every: 15 * 60 * 1000 }, jobId: 'datadog-deep-scan-every-15min' });
  }
}
