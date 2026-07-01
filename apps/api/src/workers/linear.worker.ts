import Queue from 'bull';
import { getSupabase } from '../config/postgres';
import { syncLinear } from '../integrations/linear/sync';
import { runLinker } from './linker.worker';

interface LinearSyncJobData {
  orgId: string;
  integrationId: string;
  syncJobId: string;
}

export const linearQueue = new Queue<LinearSyncJobData>('linear-sync', process.env.REDIS_URL!);

linearQueue.process(async (job) => {
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
      throw new Error('Linear integration not found or missing access token');
    }

    const itemsSynced = await syncLinear(orgId, integration.access_token);

    await Promise.all([
      supabase
        .from('sync_jobs')
        .update({ status: 'done', items_synced: itemsSynced, finished_at: new Date().toISOString() })
        .eq('id', syncJobId),
      supabase
        .from('integrations')
        .update({ last_synced_at: new Date().toISOString(), sync_counts: { issues: itemsSynced } })
        .eq('id', integrationId),
    ]);

    runLinker(orgId).catch(e => console.error('Linker error (linear):', e));
  } catch (err: any) {
    await supabase
      .from('sync_jobs')
      .update({ status: 'error', error_message: err.message, finished_at: new Date().toISOString() })
      .eq('id', syncJobId);
    throw err;
  }
});

export async function triggerLinearSync(
  orgId: string,
  integrationId: string
): Promise<{ syncJobId: string; jobId: string | number }> {
  const supabase = getSupabase();

  const { data: syncJob, error } = await supabase
    .from('sync_jobs')
    .insert({ org_id: orgId, provider: 'linear', status: 'pending' })
    .select('id')
    .single();

  if (error || !syncJob) throw new Error('Failed to create Linear sync job');

  const job = await linearQueue.add({ orgId, integrationId, syncJobId: syncJob.id });
  return { syncJobId: syncJob.id, jobId: job.id };
}
