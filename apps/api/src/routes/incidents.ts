import { Router, Response } from 'express';
import { runQuery } from '../graph/queries';
import { getIncidentContext } from '../graph/queries';
import { authMiddleware, AuthedRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware as any);

router.get('/', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const incidents = await runQuery(
      `MATCH (i:Incident { orgId: $orgId })
       RETURN i ORDER BY i.startedAt DESC LIMIT 50`,
      { orgId }
    );
    res.json(incidents.map((r: any) => r.i?.properties ?? r.i));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const raw = await getIncidentContext(req.params.id, orgId);
    if (!raw) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }
    // Flatten Neo4j Node → plain properties object
    const ctx = raw as any;
    const incident = ctx.i?.properties ?? ctx.i ?? {};
    res.json({
      incident,
      deployments: (ctx.deployments ?? []).filter((d: any) => d.id),
      pullRequests: (ctx.pullRequests ?? []).filter((p: any) => p.id),
      engineers: (ctx.engineers ?? []).filter((e: any) => e.id),
      bugs: (ctx.bugs ?? []).filter((b: any) => b.id),
      alerts: (ctx.alerts ?? []).filter((a: any) => a.id),
      services: (ctx.services ?? []).filter((s: any) => s.id),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
