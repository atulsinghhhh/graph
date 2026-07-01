import Queue from 'bull';
import { getSupabase } from '../config/postgres';
import { syncSlack } from '../integrations/slack/sync';
import { runLinker } from './linker.worker';

interface SlackSyncJobData {
  orgId: string;
  integrationId: string;
  syncJobId: string;
}

export const slackQueue = new Queue<SlackSyncJobData>('slack-sync', process.env.REDIS_URL!);

slackQueue.process(async (job) => {
  const { orgId, integrationId, syncJobId } = job.data;
  const supabase = getSupabase();

  await supabase
    .from('sync_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', syncJobId);

  try {
    const { data: integration, error } = await supabase
      .from('integrations')
      .select('access_token')
      .eq('id', integrationId)
      .single();

    if (error || !integration?.access_token) {
      throw new Error('Slack integration not found or missing access token');
    }

    const syncResult = await syncSlack(orgId, integration.access_token);

    await Promise.all([
      supabase
        .from('sync_jobs')
        .update({ status: 'done', items_synced: syncResult.itemsSynced, finished_at: new Date().toISOString() })
        .eq('id', syncJobId),
      supabase
        .from('integrations')
        .update({
          last_synced_at: new Date().toISOString(),
          sync_counts: { channels: syncResult.channels, messages: syncResult.itemsSynced },
        })
        .eq('id', integrationId),
    ]);

    runLinker(orgId).catch(e => console.error('Linker error (slack):', e));
  } catch (err: any) {
    await supabase
      .from('sync_jobs')
      .update({ status: 'error', error_message: err.message, finished_at: new Date().toISOString() })
      .eq('id', syncJobId);
    throw err;
  }
});

export async function triggerSlackSync(
  orgId: string,
  integrationId: string
): Promise<{ syncJobId: string; jobId: string | number }> {
  const supabase = getSupabase();

  const { data: syncJob, error } = await supabase
    .from('sync_jobs')
    .insert({ org_id: orgId, provider: 'slack', status: 'pending' })
    .select('id')
    .single();

  if (error || !syncJob) throw new Error('Failed to create Slack sync job');

  const job = await slackQueue.add({ orgId, integrationId, syncJobId: syncJob.id });
  return { syncJobId: syncJob.id, jobId: job.id };
}
