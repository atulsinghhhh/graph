import Queue from 'bull';
import { getSupabase } from '../config/postgres';
import { triggerGitHubSync } from './github.worker';
import { triggerJiraSync } from './jira.worker';
import { triggerDatadogSync } from './datadog.worker';

const MIN_RESYNC_INTERVAL_MS = 10 * 60 * 1000;

export const schedulerQueue = new Queue('org-sync-scheduler', process.env.REDIS_URL!);

schedulerQueue.process(async () => {
  const supabase = getSupabase();
  const { data: integrations } = await supabase
    .from('integrations')
    .select('id, org_id, provider, last_synced_at')
    .eq('status', 'connected');

  for (const integ of integrations ?? []) {
    if (
      integ.last_synced_at &&
      Date.now() - new Date(integ.last_synced_at).getTime() < MIN_RESYNC_INTERVAL_MS
    ) {
      continue;
    }

    try {
      if (integ.provider === 'github') await triggerGitHubSync(integ.org_id, integ.id);
      else if (integ.provider === 'jira') await triggerJiraSync(integ.org_id, integ.id);
      else if (integ.provider === 'datadog') await triggerDatadogSync(integ.org_id, integ.id);
    } catch (err: any) {
      console.error(`[Scheduler] ${integ.provider} sync failed for org ${integ.org_id}:`, err.message);
    }
  }
});

export async function registerScheduler(): Promise<void> {
  const existing = await schedulerQueue.getRepeatableJobs();
  if (existing.length === 0) {
    await schedulerQueue.add({}, { repeat: { every: 15 * 60 * 1000 }, jobId: 'org-sync-every-15min' });
  }
}
