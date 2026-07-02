import Queue from 'bull';
import { getSupabase } from '../config/postgres';
import { runJiraDeepScan } from '../integrations/jira/deep-scan';
import { getValidJiraToken } from '../integrations/jira/auth';
import { buildScanSummary } from '../ai/scan-summary';

export const jiraDeepScanQueue = new Queue('jira-deep-scan', process.env.REDIS_URL!);

jiraDeepScanQueue.process(async () => {
  const supabase = getSupabase();

  const { data: integrations } = await supabase
    .from('integrations')
    .select('id, org_id, access_token, refresh_token, token_expires_at, extra_data')
    .eq('provider', 'jira')
    .eq('status', 'connected');

  for (const integ of integrations ?? []) {
    const { cloudId } = (integ.extra_data ?? {}) as { cloudId?: string };
    if (!cloudId) continue;

    try {
      const accessToken = await getValidJiraToken(integ as any);
      const scan = await runJiraDeepScan(integ.org_id, accessToken, cloudId);
      const summaryText = await buildScanSummary('jira', scan.issuesFound);

      await supabase.from('tool_scan_reports').insert({
        org_id: integ.org_id,
        tool: 'jira',
        items_scanned: scan.itemsScanned,
        issues_found: scan.issuesFound,
        critical_count: scan.criticalCount,
        high_count: scan.highCount,
        summary_text: summaryText,
        raw_stats: scan.rawStats,
      });
    } catch (err: any) {
      console.error(`[JiraDeepScan] scan failed for org ${integ.org_id}:`, err.message);
    }
  }
});

export async function registerJiraDeepScanScheduler(): Promise<void> {
  const existing = await jiraDeepScanQueue.getRepeatableJobs();
  if (existing.length === 0) {
    await jiraDeepScanQueue.add({}, { repeat: { cron: '0 * * * *' }, jobId: 'jira-deep-scan-hourly' });
  }
}
