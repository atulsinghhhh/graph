import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getRedis } from '../config/redis';
import { getSupabase } from '../config/postgres';
import { getGitHubAuthUrl, exchangeGitHubCode } from '../integrations/github/auth';
import { getJiraAuthUrl, exchangeJiraCode, getAccessibleSites } from '../integrations/jira/auth';
import { validateDatadogKeys } from '../integrations/datadog/auth';
import { authMiddleware, AuthedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

const router = Router();
const STATE_TTL = 15 * 60; // 15 minutes in seconds

// ── GitHub ────────────────────────────────────────────────────────────────────

// Returns the GitHub OAuth URL; frontend redirects the browser to it
router.get('/github/connect', authMiddleware as any, requireRole('owner', 'admin'), async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const state = uuidv4();
    const redis = getRedis();

    await redis.set(`github:oauth:state:${state}`, JSON.stringify({ orgId }), 'EX', STATE_TTL);

    const url = getGitHubAuthUrl(state);
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GitHub redirects the browser here after the user authorises the app
router.get('/github/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (error) {
    return res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect(`${frontendUrl}/integrations?error=missing_params`);
  }

  try {
    const redis = getRedis();
    const raw = await redis.get(`github:oauth:state:${state}`);
    if (!raw) {
      return res.redirect(`${frontendUrl}/integrations?error=invalid_state`);
    }
    await redis.del(`github:oauth:state:${state}`);

    const { orgId } = JSON.parse(raw) as { orgId: string };
    const accessToken = await exchangeGitHubCode(code);
    const supabase = getSupabase();

    const { error: upsertErr } = await supabase.from('integrations').upsert(
      {
        org_id: orgId,
        provider: 'github',
        access_token: accessToken,
        status: 'connected',
      },
      { onConflict: 'org_id,provider' }
    );

    if (upsertErr) {
      console.error('GitHub integration upsert failed:', upsertErr.message);
      return res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent(upsertErr.message)}`);
    }

    return res.redirect(`${frontendUrl}/integrations?connected=github`);
  } catch (err: any) {
    console.error('GitHub callback error:', err.message);
    return res.redirect(`${frontendUrl}/integrations?error=callback_failed`);
  }
});

// ── Jira ──────────────────────────────────────────────────────────────────────

router.get('/jira/connect', authMiddleware as any, requireRole('owner', 'admin'), async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const state = uuidv4();
    const redis = getRedis();

    await redis.set(`jira:oauth:state:${state}`, JSON.stringify({ orgId }), 'EX', STATE_TTL);

    const url = getJiraAuthUrl(state);
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/jira/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (error) {
    return res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return res.redirect(`${frontendUrl}/integrations?error=missing_params`);
  }

  try {
    const redis = getRedis();
    const raw = await redis.get(`jira:oauth:state:${state}`);
    if (!raw) return res.redirect(`${frontendUrl}/integrations?error=invalid_state`);
    await redis.del(`jira:oauth:state:${state}`);

    const { orgId } = JSON.parse(raw) as { orgId: string };
    const tokens = await exchangeJiraCode(code);
    const sites = await getAccessibleSites(tokens.access_token);

    if (sites.length === 0) {
      return res.redirect(`${frontendUrl}/integrations?error=no_jira_sites`);
    }

    const site = sites[0];
    const supabase = getSupabase();

    await supabase.from('integrations').upsert(
      {
        org_id: orgId,
        provider: 'jira',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        extra_data: { cloudId: site.id, siteUrl: site.url, siteName: site.name },
        status: 'connected',
      },
      { onConflict: 'org_id,provider' }
    );

    return res.redirect(`${frontendUrl}/integrations?connected=jira`);
  } catch (err: any) {
    console.error('Jira callback error:', err.message);
    return res.redirect(`${frontendUrl}/integrations?error=callback_failed`);
  }
});

// ── Datadog ───────────────────────────────────────────────────────────────────

router.post('/datadog/connect', authMiddleware as any, requireRole('owner', 'admin'), async (req: AuthedRequest, res: Response) => {
  const { apiKey, appKey, site = 'datadoghq.com' } = req.body as {
    apiKey: string;
    appKey: string;
    site?: string;
  };

  if (!apiKey || !appKey) {
    res.status(400).json({ error: 'apiKey and appKey are required' });
    return;
  }

  try {
    const valid = await validateDatadogKeys(apiKey, appKey, site);
    if (!valid) {
      res.status(400).json({ error: 'Invalid Datadog API or Application key' });
      return;
    }

    const orgId = req.user!.orgId;
    const supabase = getSupabase();

    await supabase.from('integrations').upsert(
      {
        org_id: orgId,
        provider: 'datadog',
        extra_data: { apiKey, appKey, site },
        status: 'connected',
      },
      { onConflict: 'org_id,provider' }
    );

    res.json({ connected: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Status ────────────────────────────────────────────────────────────────────

router.get('/status', authMiddleware as any, async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;

    const supabase = getSupabase();

    const { data } = await supabase
      .from('integrations')
      .select('provider, status, last_synced_at')
      .eq('org_id', orgId);

    const result: Record<string, { connected: boolean; lastSyncedAt: string | null }> = {
      github: { connected: false, lastSyncedAt: null },
      jira: { connected: false, lastSyncedAt: null },
      datadog: { connected: false, lastSyncedAt: null },
    };

    for (const row of data ?? []) {
      result[row.provider] = {
        connected: row.status === 'connected',
        lastSyncedAt: row.last_synced_at,
      };
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
