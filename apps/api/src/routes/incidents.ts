import { Router, Response } from 'express';
import neo4j from 'neo4j-driver';
import { runQuery, getIncidentContext, getIncidentFix } from '../graph/queries';
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

type BreakPoint = 'pr' | 'deployment' | 'service' | null;

// Finds the earliest node in the chain with a problem: a PR (if it shipped in the
// triggering deployment), else the deployment itself, else — if only an alert/incident
// was traced with no deployment — the service level. Everything after the break point
// is a cascade caused by it.
function determineBreakPoint(ctx: {
  deployments: Array<{ id: string; confidence: number | null }>;
  pullRequests: Array<{ id: string }>;
  alerts: Array<{ id: string }>;
}): { breakPoint: BreakPoint; breakNodeId: string | null; cascadeNodes: string[] } {
  const { deployments, pullRequests, alerts } = ctx;

  if (deployments.length > 0 && (deployments[0].confidence ?? 0) > 0.5) {
    if (pullRequests.length > 0) {
      return {
        breakPoint: 'pr',
        breakNodeId: pullRequests[0].id,
        cascadeNodes: ['deployment', 'service', 'alert', 'incident', 'bug'],
      };
    }
    return {
      breakPoint: 'deployment',
      breakNodeId: deployments[0].id,
      cascadeNodes: ['service', 'alert', 'incident', 'bug'],
    };
  }

  if (alerts.length > 0) {
    return {
      breakPoint: 'service',
      breakNodeId: 'service',
      cascadeNodes: ['alert', 'incident', 'bug'],
    };
  }

  return { breakPoint: null, breakNodeId: null, cascadeNodes: [] };
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
    // Sorted by confidence desc so deployments[0] is the most likely trigger.
    const deployments = (raw.deployments ?? [])
      .map((entry: any) => {
        const p = props(entry.deployment ?? entry);
        if (!p) return null;
        return { ...p, confidence: toNum(entry.confidence) };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0));

    // pullRequests, engineers, services, alerts, bugs: collect(DISTINCT <node>)
    const pullRequests = (raw.pullRequests ?? []).map(props).filter(Boolean);
    const engineers   = (raw.engineers   ?? []).map(props).filter(Boolean);
    const services    = (raw.services    ?? []).map(props).filter(Boolean);
    const alerts      = (raw.alerts      ?? []).map(props).filter(Boolean);
    const bugs        = (raw.bugs        ?? []).map(props).filter(Boolean);

    const { breakPoint, breakNodeId, cascadeNodes } = determineBreakPoint({
      deployments, pullRequests, alerts,
    });

    // Only attach a fix node when the graph actually shows a resolving deployment/PR —
    // never fabricate one just because the incident is marked resolved.
    let fix: { fixDeployment: Record<string, unknown>; fixPullRequest: Record<string, unknown> | null } | null = null;
    if (incident.status === 'resolved') {
      const fixRaw = await getIncidentFix(req.params.id, orgId) as any;
      const fixDeployment = fixRaw ? props(fixRaw.fixDeployment) : null;
      if (fixDeployment) {
        fix = { fixDeployment, fixPullRequest: props(fixRaw.fixPullRequest) };
      }
    }

    res.json({
      incident, deployments, pullRequests, engineers, services, alerts, bugs,
      breakPoint, breakNodeId, cascadeNodes, fix,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
