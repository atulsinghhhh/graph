import { Router, Response } from 'express';
import { runQuery } from '../graph/queries';
import { LABELS } from '../graph/schema';
import { authMiddleware, AuthedRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware as any);

function flatProps(props: any): Record<string, unknown> {
  if (!props || typeof props !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = (v && typeof v === 'object' && 'low' in (v as any))
      ? (v as any).low
      : v;
  }
  return out;
}

// GET /api/graph — returns { nodes, links } for the graph visualization.
// Pulls every node label in the schema (GitHub, Jira, Slack, PagerDuty, Linear,
// Datadog — not just the original GitHub/Jira/Datadog core graph), capped per
// label so no single noisy tool crowds out the others, then every relationship
// that exists between the collected nodes.
router.get('/', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;

    const nodeRows = (
      await Promise.all(
        LABELS.map(label =>
          runQuery<any>(
            `MATCH (n:${label} { orgId: $orgId })
             RETURN elementId(n) AS eid, labels(n)[0] AS type, properties(n) AS props
             ORDER BY coalesce(n.syncedAt, n.detectedAt, n.createdAt) DESC
             LIMIT 75`,
            { orgId }
          )
        )
      )
    ).flat();

    const nodes = nodeRows.map((r: any) => {
      const p = flatProps(r.props);
      const appId = p.id; // application-level id (e.g. "jira:INC-100")
      delete p.id;        // prevent overwriting the elementId below
      return { id: r.eid, type: r.type, nodeId: appId, ...p };
    });

    if (nodes.length === 0) {
      res.json({ nodes: [], links: [] });
      return;
    }

    const nodeEids = nodeRows.map((r: any) => r.eid);

    const edgeRows = await runQuery<any>(
      `MATCH (a { orgId: $orgId })-[r]->(b { orgId: $orgId })
       WHERE elementId(a) IN $ids AND elementId(b) IN $ids
       RETURN elementId(a) AS source, elementId(b) AS target,
              type(r) AS type, properties(r) AS props
       LIMIT 1000`,
      { orgId, ids: nodeEids }
    );

    const links = edgeRows.map((r: any) => {
      const p = flatProps(r.props);
      return { source: r.source, target: r.target, type: r.type, ...p };
    });

    res.json({ nodes, links });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
