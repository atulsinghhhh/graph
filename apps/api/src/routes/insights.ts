import { Router, Response } from 'express';
import Groq from 'groq-sdk';
import { authMiddleware, AuthedRequest } from '../middleware/auth';
import { runQuery } from '../config/neo4j';

const router = Router();
router.use(authMiddleware as any);

function getGroq() {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

export interface Insight {
  prNumber: number;
  prTitle: string;
  prUrl?: string;
  engineer: string;
  mergedAt?: string;
  services: string[];
  linkedIncidents: { title: string; severity: string }[];
  linkedBugs: { jiraId: string; title: string; priority: string }[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  potentialIssues: string[];
  fixSuggestions: string[];
}

router.get('/', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;

    // Pull every merged PR with its full relationship context
    const records = await runQuery<Record<string, any>>(`
      MATCH (e:Engineer { orgId: $orgId })-[:AUTHORED]->(pr:PullRequest { orgId: $orgId })
      WHERE pr.state = 'merged'
      OPTIONAL MATCH (d:Deployment { orgId: $orgId })-[:INCLUDES]->(pr)
      OPTIONAL MATCH (d)-[:TRIGGERED]->(i:Incident { orgId: $orgId })
      OPTIONAL MATCH (d)-[:DEPLOYS_TO]->(s:Service { orgId: $orgId })
      OPTIONAL MATCH (i)-[:LINKED_TO]->(b:Bug { orgId: $orgId })
      OPTIONAL MATCH (pr)-[:INTRODUCED_SECRET]->(sa:SecretAlert { orgId: $orgId })
      RETURN
        e.name           AS engineer,
        pr.number        AS prNumber,
        pr.title         AS prTitle,
        pr.url           AS prUrl,
        pr.mergedAt      AS mergedAt,
        pr.additions     AS additions,
        pr.deletions     AS deletions,
        collect(DISTINCT s.name)       AS services,
        collect(DISTINCT { title: i.title, severity: i.severity }) AS incidents,
        collect(DISTINCT { jiraId: b.jiraId, title: b.title, priority: b.priority }) AS bugs,
        collect(DISTINCT { type: sa.secretType, state: sa.state }) AS secrets
      ORDER BY pr.mergedAt DESC
      LIMIT 10
    `, { orgId });

    if (records.length === 0) {
      return res.json([]);
    }

    // Strip null entries introduced by OPTIONAL MATCH on absent nodes
    const prs = records.map(r => ({
      engineer:  r.engineer  ?? 'Unknown',
      prNumber:  typeof r.prNumber === 'object' ? r.prNumber.toNumber() : Number(r.prNumber),
      prTitle:   r.prTitle   ?? '',
      prUrl:     r.prUrl,
      mergedAt:  r.mergedAt,
      additions: typeof r.additions === 'object' ? r.additions?.toNumber?.() ?? 0 : Number(r.additions ?? 0),
      deletions: typeof r.deletions === 'object' ? r.deletions?.toNumber?.() ?? 0 : Number(r.deletions ?? 0),
      services:  (r.services  as string[]).filter(Boolean),
      incidents: (r.incidents as any[]).filter(x => x?.title),
      bugs:      (r.bugs      as any[]).filter(x => x?.title),
      secrets:   (r.secrets   as any[]).filter(x => x?.type),
    }));

    // Ask Groq to analyse risk and generate actionable insights
    const groq = getGroq();
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: `You are a senior engineering advisor. Analyse recent pull requests and their real-world outcomes (incidents, bugs, secret leaks) to produce developer insights.

For every PR respond with a JSON array — one object per PR — using exactly this shape:
{
  "prNumber": <number>,
  "riskLevel": "low" | "medium" | "high" | "critical",
  "summary": "<one sentence — what risk this push introduced>",
  "potentialIssues": ["<issue 1>", "<issue 2>"],
  "fixSuggestions": ["<fix 1>", "<fix 2>", "<fix 3>"]
}

Rules:
- riskLevel is "critical" if a secret was leaked or if an incident occurred; "high" if a bug was filed; "medium" if the PR is large (>200 lines changed); "low" otherwise.
- potentialIssues must reference specific things from the PR data (service name, secret type, incident title, etc.).
- fixSuggestions must be concrete and actionable (e.g. "Add integration tests for Stripe SCA flows before merging payment validation changes").
- Return ONLY valid JSON — no markdown, no prose.`,
        },
        {
          role: 'user',
          content: JSON.stringify(prs, null, 2),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '[]';
    let aiInsights: any[];
    try {
      aiInsights = JSON.parse(raw);
    } catch {
      // Strip any accidental markdown fences
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      aiInsights = JSON.parse(cleaned);
    }

    // Merge AI output with the original graph data
    const enriched: Insight[] = aiInsights.map((ai: any) => {
      const pr = prs.find(p => p.prNumber === ai.prNumber) ?? prs[0];
      return {
        prNumber:         pr.prNumber,
        prTitle:          pr.prTitle,
        prUrl:            pr.prUrl,
        engineer:         pr.engineer,
        mergedAt:         pr.mergedAt,
        services:         pr.services,
        linkedIncidents:  pr.incidents,
        linkedBugs:       pr.bugs,
        riskLevel:        ai.riskLevel ?? 'low',
        summary:          ai.summary   ?? '',
        potentialIssues:  ai.potentialIssues  ?? [],
        fixSuggestions:   ai.fixSuggestions   ?? [],
      };
    });

    res.json(enriched);
  } catch (err: any) {
    console.error('Insights error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
