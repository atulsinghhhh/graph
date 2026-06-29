import { Router, Response } from 'express';
import { getSupabase } from '../config/postgres';
import { authMiddleware, AuthedRequest } from '../middleware/auth';
import { triggerGitHubSync } from '../workers/github.worker';
import { triggerJiraSync } from '../workers/jira.worker';
import { triggerDatadogSync } from '../workers/datadog.worker';

const router = Router();
router.use(authMiddleware as any);

router.post('/start', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const supabase = getSupabase();

    const { data: integrations } = await supabase
      .from('integrations')
      .select('id, provider, status')
      .eq('org_id', orgId)
      .eq('status', 'connected');

    if (!integrations || integrations.length === 0) {
      res.status(400).json({ error: 'No connected integrations found' });
      return;
    }

    const triggered: { provider: string; syncJobId: string }[] = [];

    for (const integration of integrations) {
      if (integration.provider === 'github') {
        const result = await triggerGitHubSync(orgId, integration.id);
        triggered.push({ provider: 'github', syncJobId: result.syncJobId });
      } else if (integration.provider === 'jira') {
        const result = await triggerJiraSync(orgId, integration.id);
        triggered.push({ provider: 'jira', syncJobId: result.syncJobId });
      } else if (integration.provider === 'datadog') {
        const result = await triggerDatadogSync(orgId, integration.id);
        triggered.push({ provider: 'datadog', syncJobId: result.syncJobId });
      }
    }

    res.json({ triggered });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const supabase = getSupabase();

    const { data: jobs, error } = await supabase
      .from('sync_jobs')
      .select('id, provider, status, items_synced, error_message, started_at, finished_at, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw new Error(error.message);
    res.json(jobs ?? []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
