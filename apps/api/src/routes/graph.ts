import { Router, Response } from 'express';
import { runQuery } from '../graph/queries';
import { authMiddleware, AuthedRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware as any);

// GET /api/graph — returns { nodes, links } for force-directed graph visualization.
// Node shape:  { id (elementId), type, label, nodeId (app id), ...props }
// Link shape:  { source (elementId), target (elementId), type, ...props }
router.get('/', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;

    // ── Phase 1: incident-centric subgraph (guaranteed to include TRIGGERED, FIRED, etc.) ──
    const coreRows = await runQuery<any>(
      `MATCH (i:Incident { orgId: $orgId })
       OPTIONAL MATCH (d:Deployment  { orgId: $orgId })-[:TRIGGERED]->(i)
       OPTIONAL MATCH (i)-[:FIRED]    ->(a:Alert      { orgId: $orgId })
       OPTIONAL MATCH (i)-[:LINKED_TO]->(b:Bug        { orgId: $orgId })
       OPTIONAL MATCH (d)-[:INCLUDES] ->(pr:PullRequest{ orgId: $orgId })
       OPTIONAL MATCH (pr)-[:AUTHORED_BY { role: 'author' }]->(e:Engineer { orgId: $orgId })
       OPTIONAL MATCH (pr)-[:CHANGED]  ->(s:Service   { orgId: $orgId })
       OPTIONAL MATCH (e)-[:OWNS]      ->(s2:Service  { orgId: $orgId })
       OPTIONAL MATCH (i)-[:ASSIGNED_TO]->(ae:Engineer { orgId: $orgId })
       OPTIONAL MATCH (sec:SecretAlert  { orgId: $orgId })-[:POSSIBLY_TRIGGERED]->(i)
       WITH collect(DISTINCT i)  + collect(DISTINCT d)  +
            collect(DISTINCT a)  + collect(DISTINCT b)  +
            collect(DISTINCT pr) + collect(DISTINCT e)  +
            collect(DISTINCT ae) + collect(DISTINCT s)  + collect(DISTINCT s2) +
            collect(DISTINCT sec) AS all
       UNWIND all AS n
       WITH n WHERE n IS NOT NULL
       RETURN DISTINCT elementId(n) AS eid, labels(n)[0] AS type, properties(n) AS props`,
      { orgId }
    );

    // ── Phase 2: extra context (engineers and services not linked to incidents) ──
    const extraRows = await runQuery<any>(
      `MATCH (e:Engineer { orgId: $orgId })-[:OWNS]->(s:Service { orgId: $orgId })
       WITH collect(DISTINCT e) + collect(DISTINCT s) AS all
       UNWIND all AS n
       RETURN DISTINCT elementId(n) AS eid, labels(n)[0] AS type, properties(n) AS props
       LIMIT 20`,
      { orgId }
    );

    // Deduplicate by elementId
    const seen = new Set<string>();
    const allNodeRows: any[] = [];
    for (const r of [...coreRows, ...extraRows]) {
      if (!seen.has(r.eid)) { seen.add(r.eid); allNodeRows.push(r); }
    }

    const nodeEidSet = new Set(allNodeRows.map((r: any) => r.eid));

    const nodes = allNodeRows.map((r: any) => {
      const p = flatProps(r.props);
      const appId = p.id;           // application-level id (e.g. "jira:INC-100")
      delete p.id;                  // prevent overwriting the elementId below
      return { id: r.eid, type: r.type, nodeId: appId, ...p };
    });

    // ── Edges: all canonical relationship types between collected nodes ──
    const edgeRows = await runQuery<any>(
      `MATCH (a { orgId: $orgId })-[r]->(b { orgId: $orgId })
       WHERE (a:Deployment OR a:PullRequest OR a:Engineer OR a:Service
              OR a:Incident OR a:Bug OR a:Alert OR a:SecretAlert)
         AND (b:Deployment OR b:PullRequest OR b:Engineer OR b:Service
              OR b:Incident OR b:Bug OR b:Alert OR b:SecretAlert)
         AND type(r) IN ['TRIGGERED','INCLUDES','AUTHORED_BY','CHANGED',
                         'FIRED','LINKED_TO','OWNS','ASSIGNED_TO',
                         'HAS_SECRET_ALERT','PUSHED_SECRET','INTRODUCED_SECRET','POSSIBLY_TRIGGERED']
       RETURN elementId(a) AS source, elementId(b) AS target,
              type(r) AS type, properties(r) AS props
       LIMIT 500`,
      { orgId }
    );

    const links = edgeRows
      .filter((r: any) => nodeEidSet.has(r.source) && nodeEidSet.has(r.target))
      .map((r: any) => {
        const p = flatProps(r.props);
        return { source: r.source, target: r.target, type: r.type, ...p };
      });

    res.json({ nodes, links });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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

export default router;
