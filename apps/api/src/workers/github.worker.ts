import Queue from 'bull';
import { getSupabase } from '../config/postgres';
import { syncGitHub } from '../integrations/github/sync';
import { runLinker } from './linker.worker';

interface GithubSyncJobData {
  orgId: string;
  integrationId: string;
  syncJobId: string;
}

export const githubQueue = new Queue<GithubSyncJobData>(
  'github-sync',
  process.env.REDIS_URL!
);

githubQueue.process(async (job) => {
  const { orgId, integrationId, syncJobId } = job.data;
  const supabase = getSupabase();

  // Mark as running
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
      throw new Error('Integration not found or missing access token');
    }

    const itemsSynced = await syncGitHub(orgId, integration.access_token);

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

    runLinker(orgId).catch(e => console.error('Linker error (github):', e));
  } catch (err: any) {
    await supabase
      .from('sync_jobs')
      .update({
        status: 'error',
        error_message: err.message,
        finished_at: new Date().toISOString(),
      })
      .eq('id', syncJobId);

    throw err; // re-throw so Bull marks job as failed
  }
});

export async function triggerGitHubSync(
  orgId: string,
  integrationId: string
): Promise<{ syncJobId: string; jobId: string | number }> {
  const supabase = getSupabase();

  const { data: syncJob, error } = await supabase
    .from('sync_jobs')
    .insert({ org_id: orgId, provider: 'github', status: 'pending' })
    .select('id')
    .single();

  if (error || !syncJob) throw new Error('Failed to create sync job');

  const job = await githubQueue.add({ orgId, integrationId, syncJobId: syncJob.id });

  return { syncJobId: syncJob.id, jobId: job.id };
}
