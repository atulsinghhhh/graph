import Queue from 'bull';
import { getSupabase } from '../config/postgres';
import { syncPagerDuty } from '../integrations/pagerduty/sync';
import { runLinker } from './linker.worker';

interface PagerDutySyncJobData {
  orgId: string;
  integrationId: string;
  syncJobId: string;
}

export const pagerdutyQueue = new Queue<PagerDutySyncJobData>('pagerduty-sync', process.env.REDIS_URL!);

pagerdutyQueue.process(async (job) => {
  const { orgId, integrationId, syncJobId } = job.data;
  const supabase = getSupabase();

  await supabase
    .from('sync_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', syncJobId);

  try {
    const { data: integration, error } = await supabase
      .from('integrations')
      .select('extra_data')
      .eq('id', integrationId)
      .single();

    if (error || !integration) throw new Error('PagerDuty integration not found');

    const { apiKey } = integration.extra_data as { apiKey: string };
    const result = await syncPagerDuty(orgId, apiKey);

    await Promise.all([
      supabase
        .from('sync_jobs')
        .update({ status: 'done', items_synced: result.itemsSynced, finished_at: new Date().toISOString() })
        .eq('id', syncJobId),
      supabase
        .from('integrations')
        .update({
          last_synced_at: new Date().toISOString(),
          sync_counts: { services: result.services, onCallSchedules: result.onCallSchedules },
        })
        .eq('id', integrationId),
    ]);

    runLinker(orgId).catch(e => console.error('Linker error (pagerduty):', e));
  } catch (err: any) {
    await supabase
      .from('sync_jobs')
      .update({ status: 'error', error_message: err.message, finished_at: new Date().toISOString() })
      .eq('id', syncJobId);
    throw err;
  }
});

export async function triggerPagerDutySync(
  orgId: string,
  integrationId: string
): Promise<{ syncJobId: string; jobId: string | number }> {
  const supabase = getSupabase();

  const { data: syncJob, error } = await supabase
    .from('sync_jobs')
    .insert({ org_id: orgId, provider: 'pagerduty', status: 'pending' })
    .select('id')
    .single();

  if (error || !syncJob) throw new Error('Failed to create PagerDuty sync job');

  const job = await pagerdutyQueue.add({ orgId, integrationId, syncJobId: syncJob.id });
  return { syncJobId: syncJob.id, jobId: job.id };
}
