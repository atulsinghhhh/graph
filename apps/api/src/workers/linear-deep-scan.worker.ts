import Queue from 'bull';
import { getSupabase } from '../config/postgres';
import { runLinearDeepScan } from '../integrations/linear/deep-scan';
import { buildScanSummary } from '../ai/scan-summary';

export const linearDeepScanQueue = new Queue('linear-deep-scan', process.env.REDIS_URL!);

linearDeepScanQueue.process(async () => {
  const supabase = getSupabase();

  const { data: integrations } = await supabase
    .from('integrations')
    .select('id, org_id, access_token')
    .eq('provider', 'linear')
    .eq('status', 'connected');

  for (const integ of integrations ?? []) {
    if (!integ.access_token) continue;

    try {
      const scan = await runLinearDeepScan(integ.org_id, integ.access_token);
      const summaryText = await buildScanSummary('linear', scan.issuesFound);

      await supabase.from('tool_scan_reports').insert({
        org_id: integ.org_id,
        tool: 'linear',
        items_scanned: scan.itemsScanned,
        issues_found: scan.issuesFound,
        critical_count: scan.criticalCount,
        high_count: scan.highCount,
        summary_text: summaryText,
        raw_stats: scan.rawStats,
      });
    } catch (err: any) {
      console.error(`[LinearDeepScan] scan failed for org ${integ.org_id}:`, err.message);
    }
  }
});

export async function registerLinearDeepScanScheduler(): Promise<void> {
  const existing = await linearDeepScanQueue.getRepeatableJobs();
  if (existing.length === 0) {
    await linearDeepScanQueue.add({}, { repeat: { cron: '0 * * * *' }, jobId: 'linear-deep-scan-hourly' });
  }
}
