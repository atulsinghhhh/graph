import { Router, Response } from 'express';
import neo4j from 'neo4j-driver';
import { runQuery } from '../graph/queries';
import { authMiddleware, AuthedRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware as any);

function props(node: unknown): Record<string, unknown> | null {
  if (!node) return null;
  if (neo4j.isNode(node as any)) return (node as any).properties as Record<string, unknown>;
  if (typeof node === 'object' && (node as any).properties) return (node as any).properties;
  return null;
}

// GET /api/secrets — list all SecretAlert nodes with linked engineer, service, incident
router.get('/', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;

    const rows = await runQuery<any>(
      `MATCH (sa:SecretAlert { orgId: $orgId })
       OPTIONAL MATCH (e:Engineer  { orgId: $orgId })-[:PUSHED_SECRET]   ->(sa)
       OPTIONAL MATCH (svc:Service { orgId: $orgId })-[:HAS_SECRET_ALERT]->(sa)
       OPTIONAL MATCH (pr:PullRequest { orgId: $orgId })-[:INTRODUCED_SECRET]->(sa)
       OPTIONAL MATCH (sa)-[pt:POSSIBLY_TRIGGERED]->(i:Incident { orgId: $orgId })
       RETURN sa,
              collect(DISTINCT e)   AS engineers,
              collect(DISTINCT svc) AS services,
              collect(DISTINCT pr)  AS pullRequests,
              collect(DISTINCT { incident: i, confidence: pt.confidence }) AS incidents
       ORDER BY sa.createdAt DESC`,
      { orgId }
    );

    const result = rows.map((r: any) => ({
      alert:       props(r.sa),
      engineers:   (r.engineers   ?? []).map(props).filter(Boolean),
      services:    (r.services    ?? []).map(props).filter(Boolean),
      pullRequests:(r.pullRequests ?? []).map(props).filter(Boolean),
      incidents:   (r.incidents   ?? [])
        .map((e: any) => {
          const p = props(e.incident ?? e);
          if (!p) return null;
          const raw = e.confidence;
          const conf = raw == null ? null
            : typeof raw === 'number' ? raw
            : typeof raw === 'object' && 'low' in raw ? (raw as any).low
            : null;
          return { ...p, confidence: conf };
        })
        .filter(Boolean),
    }));

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
