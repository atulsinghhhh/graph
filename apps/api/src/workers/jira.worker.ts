import Queue from 'bull';
import { getSupabase } from '../config/postgres';
import { syncJira } from '../integrations/jira/sync';
import { getValidJiraToken } from '../integrations/jira/auth';
import { runLinker } from './linker.worker';

interface JiraSyncJobData {
  orgId: string;
  integrationId: string;
  syncJobId: string;
}

export const jiraQueue = new Queue<JiraSyncJobData>(
  'jira-sync',
  process.env.REDIS_URL!
);

jiraQueue.process(async (job) => {
  const { orgId, integrationId, syncJobId } = job.data;
  const supabase = getSupabase();

  await supabase
    .from('sync_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', syncJobId);

  try {
    const { data: integration, error } = await supabase
      .from('integrations')
      .select('id, access_token, refresh_token, token_expires_at, extra_data')
      .eq('id', integrationId)
      .single();

    if (error || !integration?.access_token) {
      throw new Error('Jira integration not found or missing access token');
    }

    const { cloudId, siteUrl } = integration.extra_data as { cloudId: string; siteUrl: string };
    if (!cloudId || !siteUrl) throw new Error('Missing cloudId or siteUrl in Jira extra_data');

    let accessToken: string;
    try {
      accessToken = await getValidJiraToken(integration as any);
    } catch (refreshErr: any) {
      await supabase.from('integrations').update({ status: 'error' }).eq('id', integrationId);
      throw new Error('Jira token expired — reconnect Jira from the integrations page');
    }

    let itemsSynced: number;
    try {
      itemsSynced = await syncJira(orgId, accessToken, cloudId, siteUrl);
    } catch (apiErr: any) {
      const status = apiErr.response?.status;
      if (status === 401 || status === 403 || status === 410) {
        await supabase.from('integrations').update({ status: 'error' }).eq('id', integrationId);
        throw new Error(`Jira auth invalid (${status}) — reconnect Jira from the integrations page`);
      }
      throw apiErr;
    }

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

    runLinker(orgId).catch(e => console.error('Linker error (jira):', e));
  } catch (err: any) {
    await supabase
      .from('sync_jobs')
      .update({ status: 'error', error_message: err.message, finished_at: new Date().toISOString() })
      .eq('id', syncJobId);
    throw err;
  }
});

export async function triggerJiraSync(
  orgId: string,
  integrationId: string
): Promise<{ syncJobId: string; jobId: string | number }> {
  const supabase = getSupabase();

  const { data: syncJob, error } = await supabase
    .from('sync_jobs')
    .insert({ org_id: orgId, provider: 'jira', status: 'pending' })
    .select('id')
    .single();

  if (error || !syncJob) throw new Error('Failed to create Jira sync job');

  const job = await jiraQueue.add({ orgId, integrationId, syncJobId: syncJob.id });
  return { syncJobId: syncJob.id, jobId: job.id };
}
