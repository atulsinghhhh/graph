import Queue from 'bull';
import { getSupabase } from '../config/postgres';
import { runSlackDeepScan } from '../integrations/slack/deep-scan';
import { buildScanSummary } from '../ai/scan-summary';

export const slackDeepScanQueue = new Queue('slack-deep-scan', process.env.REDIS_URL!);

slackDeepScanQueue.process(async () => {
  const supabase = getSupabase();

  const { data: integrations } = await supabase
    .from('integrations')
    .select('id, org_id, access_token')
    .eq('provider', 'slack')
    .eq('status', 'connected');

  for (const integ of integrations ?? []) {
    if (!integ.access_token) continue;

    try {
      const scan = await runSlackDeepScan(integ.org_id, integ.access_token);
      const summaryText = await buildScanSummary('slack', scan.issuesFound);

      await supabase.from('tool_scan_reports').insert({
        org_id: integ.org_id,
        tool: 'slack',
        items_scanned: scan.itemsScanned,
        issues_found: scan.issuesFound,
        critical_count: scan.criticalCount,
        high_count: scan.highCount,
        summary_text: summaryText,
        raw_stats: scan.rawStats,
      });
    } catch (err: any) {
      console.error(`[SlackDeepScan] scan failed for org ${integ.org_id}:`, err.message);
    }
  }
});

export async function registerSlackDeepScanScheduler(): Promise<void> {
  const existing = await slackDeepScanQueue.getRepeatableJobs();
  if (existing.length === 0) {
    await slackDeepScanQueue.add({}, { repeat: { every: 15 * 60 * 1000 }, jobId: 'slack-deep-scan-every-15min' });
  }
}
