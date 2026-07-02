import axios from 'axios';
import { upsertNode, createRelationship } from '../../graph/queries';
import { recordIssue, summarizeIssues, ScanIssue, ScanResult } from '../scan-types';

async function linearGraphQL(accessToken: string, query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const res = await axios.post(
    'https://api.linear.app/graphql',
    { query, variables },
    { headers: { Authorization: accessToken, 'Content-Type': 'application/json' }, timeout: 20_000 }
  );
  if (res.data.errors) {
    throw new Error(res.data.errors[0]?.message ?? 'Linear GraphQL query failed');
  }
  return res.data.data;
}

// ── L1 — Blocked issues ──────────────────────────────────────────────────────────

const BLOCKED_ISSUES_QUERY = `
  query BlockedIssues {
    issues(first: 100, filter: { blockedByCount: { gt: 0 }, state: { type: { neq: "completed" } } }) {
      nodes {
        id identifier title priority
        blockedBy { nodes { id title identifier } }
        assignee { name email }
        cycle { id name }
        project { id name }
      }
    }
  }
`;

async function scanBlockedIssues(accessToken: string, orgId: string): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];
  const data = await linearGraphQL(accessToken, BLOCKED_ISSUES_QUERY);
  const nodes: any[] = data.issues?.nodes ?? [];

  for (const issue of nodes) {
    const bugId = `linear:${issue.identifier}`;
    const blockerIds = (issue.blockedBy?.nodes ?? []).map((b: any) => `linear:${b.identifier}`);

    await upsertNode('Bug', bugId, orgId, { isBlocked: true, blockedBy: blockerIds });
    for (const blockerId of blockerIds) {
      await createRelationship('Bug', bugId, 'Bug', blockerId, 'BLOCKED_BY', orgId).catch(() => {});
    }

    if (issue.cycle?.id) {
      await createRelationship('Bug', bugId, 'Cycle', `linear:cycle:${issue.cycle.id}`, 'IN_CYCLE', orgId).catch(() => {});
    }
    if (issue.project?.id) {
      await upsertNode('Project', `linear:project:${issue.project.id}`, orgId, { name: issue.project.name });
      await createRelationship('Bug', bugId, 'Project', `linear:project:${issue.project.id}`, 'IN_PROJECT', orgId).catch(() => {});
    }

    const blockerTitles = (issue.blockedBy?.nodes ?? []).map((b: any) => b.title).join(', ');
    issues.push(await recordIssue({
      id: `linear:issue:blocked:${issue.identifier}`,
      orgId,
      source: 'linear',
      type: 'blocked_issue',
      severity: issue.priority <= 2 ? 'high' : 'medium',
      title: `Blocked: ${issue.identifier} — ${issue.title}`,
      description: `${issue.identifier} is blocked by: ${blockerTitles}.`,
      url: issue.url ?? '',
      fixSuggestion:
        `Issue ${issue.identifier} is blocked by: ${blockerTitles}.\n` +
        `1. Is the blocking issue being actively worked on? Check assignee of blocking issue and current status.\n` +
        `2. Can the blocked work be partially done while waiting?\n` +
        `3. Escalate the blocker to higher priority if this is on the critical path\n` +
        `4. Consider temporarily unblocking with a workaround/stub\n` +
        `5. Flag in daily standup to get team visibility on the blocker`,
    }));
  }

  return issues;
}

// ── L2 — Cycle (sprint) health ───────────────────────────────────────────────────

const ACTIVE_CYCLES_QUERY = `
  query ActiveCycles {
    cycles(filter: { isActive: { eq: true } }, first: 50) {
      nodes { id name startsAt endsAt issueCount completedIssueCount progress team { id name } }
    }
  }
`;

async function scanCycleHealth(accessToken: string, orgId: string): Promise<{ issues: ScanIssue[]; cycles: any[] }> {
  const issues: ScanIssue[] = [];
  const data = await linearGraphQL(accessToken, ACTIVE_CYCLES_QUERY);
  const cycles: any[] = data.cycles?.nodes ?? [];
  const summaries: any[] = [];

  for (const cycle of cycles) {
    const completionRate = cycle.issueCount > 0 ? Math.round((cycle.completedIssueCount / cycle.issueCount) * 100) : 0;
    const daysRemaining = cycle.endsAt ? Math.ceil((new Date(cycle.endsAt).getTime() - Date.now()) / 86_400_000) : null;

    await upsertNode('Cycle', `linear:cycle:${cycle.id}`, orgId, {
      name: cycle.name ?? `Cycle ${cycle.id.slice(0, 8)}`,
      startsAt: cycle.startsAt,
      endsAt: cycle.endsAt,
      completionRate,
      totalIssues: cycle.issueCount,
      completedIssues: cycle.completedIssueCount,
      progress: cycle.progress,
    });

    summaries.push({ cycleId: cycle.id, name: cycle.name, completionRate, daysRemaining, issueCount: cycle.issueCount, completedIssueCount: cycle.completedIssueCount });

    if (completionRate < 50 && daysRemaining !== null && daysRemaining < 2) {
      const remaining = cycle.issueCount - cycle.completedIssueCount;
      issues.push(await recordIssue({
        id: `linear:issue:cycle-risk:${cycle.id}`,
        orgId,
        source: 'linear',
        type: 'cycle_at_risk',
        severity: 'high',
        title: `Cycle at risk: ${cycle.name ?? 'current cycle'} — ${completionRate}% done, ${daysRemaining} days left`,
        description: `Cycle '${cycle.name ?? cycle.id}' is ${completionRate}% complete with ${daysRemaining} days remaining.`,
        url: '',
        fixSuggestion:
          `Cycle '${cycle.name ?? 'current cycle'}' is at risk.\n` +
          `1. Identify the ${remaining} remaining issues\n` +
          `2. Triage: which can realistically be completed? Move the rest to next cycle\n` +
          `3. Communicate reduced scope to product/stakeholders now\n` +
          `4. Focus the team on the highest-priority remaining issues\n` +
          `5. Remove any blocked issues from this cycle immediately`,
      }));
    }
  }

  return { issues, cycles: summaries };
}

// ── L3 — Overdue issues ──────────────────────────────────────────────────────────

const OVERDUE_ISSUES_QUERY = `
  query OverdueIssues($now: DateTimeOrDuration!) {
    issues(first: 100, filter: { dueDate: { lt: $now }, state: { type: { neq: "completed" } } }) {
      nodes { id identifier title dueDate priority assignee { name } project { name } url }
    }
  }
`;

async function scanOverdueIssues(accessToken: string, orgId: string): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];
  const data = await linearGraphQL(accessToken, OVERDUE_ISSUES_QUERY, { now: new Date().toISOString() });
  const nodes: any[] = data.issues?.nodes ?? [];

  for (const issue of nodes) {
    const daysOverdue = Math.floor((Date.now() - new Date(issue.dueDate).getTime()) / 86_400_000);
    const severity = issue.priority <= 1 ? 'critical' : issue.priority <= 2 ? 'high' : 'medium';

    issues.push(await recordIssue({
      id: `linear:issue:overdue:${issue.identifier}`,
      orgId,
      source: 'linear',
      type: 'overdue_issue',
      severity,
      title: `Overdue ${daysOverdue} days: ${issue.identifier} — ${issue.title}`,
      description: `${issue.identifier} (${issue.title}) is ${daysOverdue} days past its due date.`,
      url: issue.url ?? '',
      fixSuggestion:
        `Issue ${issue.identifier} is ${daysOverdue} days past its due date.\n` +
        `1. Update the due date if the original estimate was wrong\n` +
        `2. Check with ${issue.assignee?.name ?? 'the assignee'}: is it blocked? needs more time?\n` +
        `3. If priority is still high: move to top of assignee's queue\n` +
        `4. If deprioritized: update priority to reflect current reality\n` +
        `5. Add a comment with the new expected completion date`,
    }));
  }

  return issues;
}

// ── L4 — No estimate issues in active cycles ────────────────────────────────────

const CYCLE_ISSUES_QUERY = `
  query CycleIssues($cycleId: ID!) {
    issues(first: 250, filter: { cycle: { id: { eq: $cycleId } } }) {
      nodes { id estimate }
    }
  }
`;

async function scanMissingEstimates(accessToken: string, orgId: string, cycles: any[]): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];

  for (const cycle of cycles) {
    if (!cycle.issueCount) continue;
    let cycleIssues: any[] = [];
    try {
      const data = await linearGraphQL(accessToken, CYCLE_ISSUES_QUERY, { cycleId: cycle.cycleId });
      cycleIssues = data.issues?.nodes ?? [];
    } catch (err: any) {
      console.warn(`[LinearDeepScan] cycle issues fetch failed for ${cycle.cycleId}: ${err.message}`);
      continue;
    }

    const unestimated = cycleIssues.filter(i => i.estimate == null).length;
    if (unestimated === 0 || unestimated <= cycleIssues.length * 0.2) continue;

    issues.push(await recordIssue({
      id: `linear:issue:no-estimate:${cycle.cycleId}`,
      orgId,
      source: 'linear',
      type: 'missing_estimates',
      severity: 'medium',
      title: `${unestimated} unestimated issues in current cycle`,
      description: `${unestimated} of ${cycleIssues.length} issues in cycle '${cycle.name ?? cycle.cycleId}' have no estimate.`,
      url: '',
      fixSuggestion:
        `${unestimated} issues in the current cycle have no estimates.\n` +
        `1. Run a quick estimation session (planning poker) for these issues\n` +
        `2. Without estimates, sprint velocity is unmeasurable\n` +
        `3. Use T-shirt sizes if full story points estimation is too slow\n` +
        `4. Prioritize estimating the highest-priority unestimated issues first\n` +
        `5. Set a team norm: no issue moves to In Progress without an estimate`,
    }));
  }

  return issues;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────────

export async function runLinearDeepScan(orgId: string, accessToken: string): Promise<ScanResult> {
  const [blockedIssues, cycleResult, overdueIssues] = await Promise.all([
    scanBlockedIssues(accessToken, orgId).catch(err => { console.warn('[LinearDeepScan] blocked scan failed:', err.message); return []; }),
    scanCycleHealth(accessToken, orgId).catch(err => { console.warn('[LinearDeepScan] cycle scan failed:', err.message); return { issues: [], cycles: [] }; }),
    scanOverdueIssues(accessToken, orgId).catch(err => { console.warn('[LinearDeepScan] overdue scan failed:', err.message); return []; }),
  ]);

  const missingEstimateIssues = await scanMissingEstimates(accessToken, orgId, cycleResult.cycles).catch(err => {
    console.warn('[LinearDeepScan] estimate scan failed:', err.message);
    return [] as ScanIssue[];
  });

  const allIssues = [...blockedIssues, ...cycleResult.issues, ...overdueIssues, ...missingEstimateIssues];
  const itemsScanned = blockedIssues.length + overdueIssues.length + cycleResult.cycles.reduce((sum, c) => sum + (c.issueCount ?? 0), 0);

  return summarizeIssues(allIssues, itemsScanned, { cycles: cycleResult.cycles });
}
