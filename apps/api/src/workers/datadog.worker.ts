import Queue from 'bull';
import { getSupabase } from '../config/postgres';
import { syncDatadog } from '../integrations/datadog/sync';
import { runLinker } from './linker.worker';

interface DatadogSyncJobData {
  orgId: string;
  integrationId: string;
  syncJobId: string;
}

export const datadogQueue = new Queue<DatadogSyncJobData>(
  'datadog-sync',
  process.env.REDIS_URL!
);

datadogQueue.process(async (job) => {
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

    if (error || !integration) throw new Error('Datadog integration not found');

    const { apiKey, appKey, site } = integration.extra_data as {
      apiKey: string;
      appKey: string;
      site: string;
    };

    const itemsSynced = await syncDatadog(orgId, apiKey, appKey, site);

    await Promise.all([
      supabase
        .from('sync_jobs')
        .update({ status: 'done', items_synced: itemsSynced, finished_at: new Date().toISOString() })
        .eq('id', syncJobId),
      supabase
        .from('integrations')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', integrationId),
    ]);

    runLinker(orgId).catch(e => console.error('Linker error:', e));
  } catch (err: any) {
    await supabase
      .from('sync_jobs')
      .update({ status: 'error', error_message: err.message, finished_at: new Date().toISOString() })
      .eq('id', syncJobId);
    throw err;
  }
});

export async function triggerDatadogSync(
  orgId: string,
  integrationId: string
): Promise<{ syncJobId: string; jobId: string | number }> {
  const supabase = getSupabase();

  const { data: syncJob, error } = await supabase
    .from('sync_jobs')
    .insert({ org_id: orgId, provider: 'datadog', status: 'pending' })
    .select('id')
    .single();

  if (error || !syncJob) throw new Error('Failed to create Datadog sync job');

  const job = await datadogQueue.add({ orgId, integrationId, syncJobId: syncJob.id });
  return { syncJobId: syncJob.id, jobId: job.id };
}
