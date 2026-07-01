import { Router, Response } from 'express';
import neo4j from 'neo4j-driver';
import { runQuery } from '../graph/queries';
import { getSupabase } from '../config/postgres';
import { authMiddleware, AuthedRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware as any);

function props(node: unknown): Record<string, unknown> | null {
  if (!node) return null;
  if (neo4j.isNode(node as any)) return (node as any).properties as Record<string, unknown>;
  if (typeof node === 'object' && (node as any).properties) return (node as any).properties;
  return null;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// GET /api/github/hourly-report — latest scan for this org
router.get('/hourly-report', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('github_hourly_reports')
      .select('*')
      .eq('org_id', orgId)
      .order('scanned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      res.json(null);
      return;
    }

    const issuesFound = (data.issues_found ?? []).slice().sort(
      (a: any, b: any) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4)
    );

    res.json({ ...data, issues_found: issuesFound });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/github/secrets — open SecurityIncident nodes
router.get('/secrets', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;

    const rows = await runQuery<any>(
      `MATCH (s:SecurityIncident { orgId: $orgId, status: 'open' })
       OPTIONAL MATCH (e:Engineer { orgId: $orgId })<-[:CAUSED_BY]-(s)
       OPTIONAL MATCH (svc:Service { orgId: $orgId })<-[:AFFECTS]-(s)
       RETURN s, collect(DISTINCT e) AS engineers, collect(DISTINCT svc) AS services
       ORDER BY s.detectedAt DESC`,
      { orgId }
    );

    const result = rows.map((r: any) => ({
      incident: props(r.s),
      engineers: (r.engineers ?? []).map(props).filter(Boolean),
      services: (r.services ?? []).map(props).filter(Boolean),
    }));

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/github/secrets/:id/resolve — mark a SecurityIncident resolved
router.patch('/secrets/:id/resolve', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const { id } = req.params;

    await runQuery(
      `MATCH (s:SecurityIncident { id: $id, orgId: $orgId })
       SET s.status = 'resolved'`,
      { id, orgId }
    );

    res.json({ resolved: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/github/repo-health — all Service nodes with health properties
router.get('/repo-health', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;

    const rows = await runQuery<any>(
      `MATCH (s:Service { orgId: $orgId })
       RETURN s ORDER BY s.name`,
      { orgId }
    );

    res.json(rows.map((r: any) => props(r.s)).filter(Boolean));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/github/pr-issues — PullRequest nodes with any known issue flag
router.get('/pr-issues', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;

    const rows = await runQuery<any>(
      `MATCH (pr:PullRequest { orgId: $orgId })
       WHERE pr.checksStatus = 'failing' OR pr.hasConflicts = true
          OR pr.isStale = true OR pr.awaitingReview = true OR pr.isLarge = true
       RETURN pr ORDER BY pr.repoName, pr.githubId`,
      { orgId }
    );

    res.json(rows.map((r: any) => props(r.pr)).filter(Boolean));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
