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

const TOOLS = ['jira', 'slack', 'pagerduty', 'linear', 'datadog'] as const;
type Tool = (typeof TOOLS)[number];

function isTool(value: string): value is Tool {
  return (TOOLS as readonly string[]).includes(value);
}

// GET /api/reports/overview — latest report per tool (incl. github) + merged critical issues
router.get('/overview', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const supabase = getSupabase();

    const [toolReports, githubReport] = await Promise.all([
      supabase
        .from('tool_scan_reports')
        .select('*')
        .eq('org_id', orgId)
        .in('tool', TOOLS as unknown as string[])
        .order('scanned_at', { ascending: false }),
      supabase
        .from('github_hourly_reports')
        .select('*')
        .eq('org_id', orgId)
        .order('scanned_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const latestByTool: Record<string, any> = {};
    for (const row of toolReports.data ?? []) {
      if (!latestByTool[row.tool]) latestByTool[row.tool] = row;
    }
    if (githubReport.data) {
      const issuesFound = githubReport.data.issues_found ?? [];
      latestByTool.github = {
        tool: 'github',
        scanned_at: githubReport.data.scanned_at,
        items_scanned: githubReport.data.repos_scanned,
        issues_found: issuesFound,
        critical_count: issuesFound.filter((i: any) => i.severity === 'critical').length,
        high_count: issuesFound.filter((i: any) => i.severity === 'high').length,
        summary_text: githubReport.data.summary_text,
        raw_stats: { secretsFound: githubReport.data.secrets_found, ciFailures: githubReport.data.ci_failures, prIssues: githubReport.data.pr_issues, repoHealth: githubReport.data.repo_health },
      };
    }

    const [issueRows, securityIncidentRows] = await Promise.all([
      runQuery<any>(
        `MATCH (i:Issue { orgId: $orgId, severity: 'critical' }) RETURN i ORDER BY i.detectedAt DESC LIMIT 50`,
        { orgId }
      ),
      runQuery<any>(
        `MATCH (s:SecurityIncident { orgId: $orgId, severity: 'critical', status: 'open' }) RETURN s ORDER BY s.detectedAt DESC LIMIT 50`,
        { orgId }
      ),
    ]);

    const criticalIssues = [
      ...issueRows.map((r: any) => props(r.i)).filter(Boolean),
      ...securityIncidentRows.map((r: any) => props(r.s)).filter(Boolean),
    ].sort((a: any, b: any) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());

    res.json({ reports: latestByTool, criticalIssues });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/:tool — latest report for one of the 5 non-GitHub tools
router.get('/:tool', async (req: AuthedRequest, res: Response) => {
  try {
    const { tool } = req.params;
    if (!isTool(tool)) {
      res.status(400).json({ error: `Unknown tool '${tool}'. Use jira, slack, pagerduty, linear, or datadog (GitHub uses /api/github/hourly-report).` });
      return;
    }

    const orgId = req.user!.orgId;
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('tool_scan_reports')
      .select('*')
      .eq('org_id', orgId)
      .eq('tool', tool)
      .order('scanned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    res.json(data ?? null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reports/issue/:nodeId/acknowledge
router.post('/issue/:nodeId/acknowledge', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.id;
    const { nodeId } = req.params;
    const { note } = req.body as { note?: string };
    const supabase = getSupabase();

    await supabase.from('issue_acknowledgments').insert({
      org_id: orgId,
      issue_id: nodeId,
      acknowledged_by: userId === 'dev' ? null : userId,
      note: note ?? null,
    });

    await runQuery(
      `MATCH (n { id: $nodeId, orgId: $orgId }) SET n.status = 'acknowledged'`,
      { nodeId, orgId }
    );

    res.json({ acknowledged: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reports/issue/:nodeId/resolve
router.post('/issue/:nodeId/resolve', async (req: AuthedRequest, res: Response) => {
  try {
    const orgId = req.user!.orgId;
    const { nodeId } = req.params;

    await runQuery(
      `MATCH (n { id: $nodeId, orgId: $orgId }) SET n.status = 'resolved', n.resolvedAt = $resolvedAt`,
      { nodeId, orgId, resolvedAt: new Date().toISOString() }
    );

    res.json({ resolved: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
