import { Router, Response } from 'express';
import neo4j from 'neo4j-driver';
import { runQuery, getIncidentContext } from '../graph/queries';
import { authMiddleware, AuthedRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware as any);

// Extract plain properties from a Neo4j Node or already-plain object.
function props(node: unknown): Record<string, unknown> | null {
  if (!node) return null;
  if (neo4j.isNode(node as any)) return (node as any).properties as Record<string, unknown>;
  if (typeof node === 'object' && (node as any).properties) return (node as any).properties;
  return null;
}

// Convert Neo4j integer (low/high) to a plain JS number.
function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'low' in (v as any)) return (v as any).low as number;
  return null;
}

router.get('/', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const rows = await runQuery(
      `MATCH (i:Incident { orgId: $orgId })
       RETURN i ORDER BY i.startedAt DESC LIMIT 50`,
      { orgId }
    );
    res.json(rows.map((r: any) => props(r.incident) ?? props(r.i) ?? r));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const raw = await getIncidentContext(req.params.id, orgId) as any;
    if (!raw) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    const incident = props(raw.incident);
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }

    // deployments: collect(DISTINCT { deployment: d, confidence: t.confidence })
    const deployments = (raw.deployments ?? [])
      .map((entry: any) => {
        const p = props(entry.deployment ?? entry);
        if (!p) return null;
        return { ...p, confidence: toNum(entry.confidence) };
      })
      .filter(Boolean);

    // pullRequests, engineers, services, alerts, bugs: collect(DISTINCT <node>)
    const pullRequests = (raw.pullRequests ?? []).map(props).filter(Boolean);
    const engineers   = (raw.engineers   ?? []).map(props).filter(Boolean);
    const services    = (raw.services    ?? []).map(props).filter(Boolean);
    const alerts      = (raw.alerts      ?? []).map(props).filter(Boolean);
    const bugs        = (raw.bugs        ?? []).map(props).filter(Boolean);

    res.json({ incident, deployments, pullRequests, engineers, services, alerts, bugs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
