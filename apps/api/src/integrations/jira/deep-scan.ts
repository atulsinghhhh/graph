import axios from 'axios';
import { upsertNode, runQuery } from '../../graph/queries';
import { recordIssue, summarizeIssues, ScanIssue, ScanResult } from '../scan-types';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (attempts <= 1) throw err;
    await sleep(1500);
    return withRetry(fn, attempts - 1);
  }
}

function isResolvedStatus(statusName: string): boolean {
  return ['done', 'resolved', 'closed', "won't fix"].includes((statusName ?? '').toLowerCase());
}

async function jqlSearch(base: string, headers: Record<string, string>, jql: string, fields: string): Promise<any[]> {
  let startAt = 0;
  const maxResults = 100;
  const all: any[] = [];
  while (true) {
    const { data } = await withRetry(() =>
      axios.get(`${base}/search`, { headers, params: { jql, startAt, maxResults, fields } })
    );
    const issues: any[] = data.issues ?? [];
    all.push(...issues);
    if (issues.length === 0 || startAt + issues.length >= data.total) break;
    startAt += issues.length;
    await sleep(100);
  }
  return all;
}

// ── J1 — Stale incidents and bugs ───────────────────────────────────────────────

async function scanStaleIssues(base: string, headers: Record<string, string>, orgId: string): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];
  const fields = 'summary,status,priority,updated,created';

  const staleIncidents = await jqlSearch(
    base, headers,
    `issuetype = Incident AND status != Done AND updated <= -3d`,
    fields
  );
  for (const issue of staleIncidents) {
    const staleDays = Math.floor((Date.now() - new Date(issue.fields.updated).getTime()) / 86_400_000);
    await upsertNode('Incident', `jira:${issue.key}`, orgId, { isStale: true, staleDays });
    issues.push(await recordIssue({
      id: `jira:issue:stale:${issue.key}`,
      orgId,
      source: 'jira',
      type: 'stale_incident',
      severity: issue.fields.priority?.name === 'Highest' ? 'critical' : 'high',
      title: `Stale incident: ${issue.key} — ${staleDays} days without update`,
      description: `Incident ${issue.key} (${issue.fields.summary}) hasn't been updated in ${staleDays} days.`,
      url: issue.self ?? '',
      fixSuggestion:
        `Incident ${issue.key} has been open for ${staleDays} days with no update. Immediate actions:\n` +
        `1. Update the status in Jira to reflect current state\n` +
        `2. Add a comment with the latest investigation findings\n` +
        `3. If blocked, add a blocker link to the blocking issue\n` +
        `4. If resolved, close with a resolution summary\n` +
        `5. Schedule a post-mortem if severity was high or critical`,
    }));
  }

  const staleBugs = await jqlSearch(
    base, headers,
    `issuetype = Bug AND status != Done AND updated <= -7d`,
    fields
  );
  for (const issue of staleBugs) {
    const staleDays = Math.floor((Date.now() - new Date(issue.fields.updated).getTime()) / 86_400_000);
    await upsertNode('Bug', `jira:${issue.key}`, orgId, { isStale: true, staleDays });
    issues.push(await recordIssue({
      id: `jira:issue:stale:${issue.key}`,
      orgId,
      source: 'jira',
      type: 'stale_bug',
      severity: issue.fields.priority?.name === 'Highest' ? 'critical' : 'high',
      title: `Stale bug: ${issue.key} — ${staleDays} days without update`,
      description: `Bug ${issue.key} (${issue.fields.summary}) hasn't been updated in ${staleDays} days.`,
      url: issue.self ?? '',
      fixSuggestion:
        `Bug ${issue.key} has been open for ${staleDays} days. Recommended actions:\n` +
        `1. Check if still reproducible in current build\n` +
        `2. Update priority if customer impact has changed\n` +
        `3. Add to current sprint if priority is high/highest\n` +
        `4. If cannot reproduce: close with 'Cannot Reproduce' status\n` +
        `5. If by design: close with 'Won't Fix' and document why`,
    }));
  }

  return issues;
}

// ── J2 — Unassigned critical issues ─────────────────────────────────────────────

async function scanUnassignedCritical(base: string, headers: Record<string, string>, orgId: string): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];
  const found = await jqlSearch(
    base, headers,
    `priority in (Highest, High) AND assignee is EMPTY AND status != Done AND updated >= -24h`,
    'summary,status,priority,updated'
  );

  for (const issue of found) {
    issues.push(await recordIssue({
      id: `jira:issue:unassigned:${issue.key}`,
      orgId,
      source: 'jira',
      type: 'unassigned_critical',
      severity: 'critical',
      title: `Unassigned critical issue: ${issue.key}`,
      description: `${issue.key} (${issue.fields.summary}) is ${issue.fields.priority?.name} priority with no assignee.`,
      url: issue.self ?? '',
      fixSuggestion:
        `Issue ${issue.key} is ${issue.fields.priority?.name} priority with no assignee.\n` +
        `1. Assign to the engineer who owns the affected service (check the graph: who has an OWNS edge to this service?)\n` +
        `2. If unknown owner: assign to team lead for triage\n` +
        `3. Set a due date matching the SLA for ${issue.fields.priority?.name} issues\n` +
        `4. Add to the active sprint immediately`,
    }));
  }

  return issues;
}

// ── J3 — Sprint health ───────────────────────────────────────────────────────────

async function scanSprintHealth(
  agileBase: string,
  headers: Record<string, string>,
  orgId: string,
  projectKeys: string[]
): Promise<{ issues: ScanIssue[]; sprints: any[] }> {
  const issues: ScanIssue[] = [];
  const sprintSummaries: any[] = [];

  for (const projectKey of projectKeys) {
    await sleep(100);
    let boards: any[] = [];
    try {
      const { data } = await withRetry(() => axios.get(`${agileBase}/board`, { headers, params: { projectKeyOrId: projectKey } }));
      boards = data.values ?? [];
    } catch {
      continue; // no board access for this project — skip
    }
    if (boards.length === 0) continue;
    const boardId = boards[0].id;

    let sprints: any[] = [];
    try {
      const { data } = await withRetry(() => axios.get(`${agileBase}/board/${boardId}/sprint`, { headers, params: { state: 'active' } }));
      sprints = data.values ?? [];
    } catch {
      continue;
    }

    for (const sprint of sprints) {
      await sleep(100);
      let sprintIssues: any[] = [];
      try {
        const { data } = await withRetry(() => axios.get(`${agileBase}/sprint/${sprint.id}/issue`, { headers, params: { fields: 'status' } }));
        sprintIssues = data.issues ?? [];
      } catch {
        continue;
      }

      const totalIssues = sprintIssues.length;
      const closedIssues = sprintIssues.filter(i => isResolvedStatus(i.fields?.status?.name)).length;
      const completionRate = totalIssues > 0 ? Math.round((closedIssues / totalIssues) * 100) : 0;
      const daysRemaining = sprint.endDate
        ? Math.ceil((new Date(sprint.endDate).getTime() - Date.now()) / 86_400_000)
        : null;
      const issuesAtRisk = sprintIssues.filter(
        i => !isResolvedStatus(i.fields?.status?.name) && daysRemaining !== null && daysRemaining < 2
      );

      const sprintNodeId = `jira:sprint:${sprint.id}`;
      await upsertNode('SprintNode', sprintNodeId, orgId, {
        name: sprint.name,
        state: sprint.state,
        startDate: sprint.startDate ?? null,
        endDate: sprint.endDate ?? null,
        completionRate,
        totalIssues,
        closedIssues,
      });

      // Link any already-synced Bug/Incident nodes in this sprint — no-op (MERGE) if not found.
      for (const si of sprintIssues) {
        await runQuery(
          `MATCH (n { id: $issueId, orgId: $orgId })
           WHERE n:Bug OR n:Incident
           MATCH (s:SprintNode { id: $sprintNodeId, orgId: $orgId })
           MERGE (n)-[:IN_SPRINT]->(s)`,
          { issueId: `jira:${si.key}`, orgId, sprintNodeId }
        );
      }

      sprintSummaries.push({ sprintName: sprint.name, totalIssues, closedIssues, completionRate, daysRemaining, issuesAtRisk: issuesAtRisk.length });

      if (completionRate < 40 && daysRemaining !== null && daysRemaining <= 3) {
        issues.push(await recordIssue({
          id: `jira:issue:sprint-risk:${sprint.id}`,
          orgId,
          source: 'jira',
          type: 'sprint_at_risk',
          severity: 'high',
          title: `Sprint at risk: ${completionRate}% complete with ${daysRemaining} days left`,
          description: `Sprint '${sprint.name}' is ${completionRate}% complete with ${daysRemaining} days remaining and ${issuesAtRisk.length} issues at risk.`,
          url: '',
          fixSuggestion:
            `Sprint '${sprint.name}' is at risk of not completing on time.\n` +
            `1. Identify the ${issuesAtRisk.length} issues most likely to complete\n` +
            `2. Move remaining issues to next sprint\n` +
            `3. Notify stakeholders of reduced scope\n` +
            `4. Host a quick sync to unblock in-progress items\n` +
            `5. Update sprint goal to reflect achievable scope`,
        }));
      }
    }
  }

  return { issues, sprints: sprintSummaries };
}

// ── J4 — SLA breaches ────────────────────────────────────────────────────────────

async function scanSlaBreaches(base: string, headers: Record<string, string>, orgId: string): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];
  const found = await jqlSearch(
    base, headers,
    `issuetype = Incident AND status != Done AND priority in (Highest, High)`,
    'summary,status,priority,created'
  );

  for (const issue of found) {
    const slaHours = issue.fields.priority?.name === 'Highest' ? 4 : 24;
    const breachHours = Math.round((Date.now() - new Date(issue.fields.created).getTime()) / 3_600_000);
    if (breachHours <= slaHours) continue;

    issues.push(await recordIssue({
      id: `jira:issue:sla:${issue.key}`,
      orgId,
      source: 'jira',
      type: 'sla_breach',
      severity: 'critical',
      title: `SLA breached: ${issue.key} — ${breachHours}h overdue`,
      description: `${issue.key} (${issue.fields.summary}) has been open ${breachHours}h against a ${slaHours}h SLA.`,
      url: issue.self ?? '',
      fixSuggestion:
        `Incident ${issue.key} has breached its SLA by ${breachHours - slaHours} hours. Immediate escalation required:\n` +
        `1. Page the on-call engineer (check PagerDuty schedule)\n` +
        `2. Escalate to engineering manager\n` +
        `3. Draft a customer communication if external-facing\n` +
        `4. Open a war room in Slack (#incident-${issue.key})\n` +
        `5. Set up a 15-minute sync call with the team`,
    }));
  }

  return issues;
}

// ── J5 — Recurring bugs ──────────────────────────────────────────────────────────

async function scanRecurringBugs(base: string, headers: Record<string, string>, orgId: string): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];
  const found = await jqlSearch(
    base, headers,
    `issuetype = Bug AND created >= -30d AND status != Done`,
    'summary,status,components,labels'
  );

  const groups = new Map<string, any[]>();
  for (const issue of found) {
    const component = issue.fields.components?.[0]?.name ?? issue.fields.labels?.[0] ?? 'uncategorized';
    if (!groups.has(component)) groups.set(component, []);
    groups.get(component)!.push(issue);
  }

  for (const [component, group] of groups) {
    if (group.length < 3) continue;
    issues.push(await recordIssue({
      id: `jira:issue:recurring:${component}`,
      orgId,
      source: 'jira',
      type: 'recurring_bug',
      severity: 'high',
      title: `Recurring bugs in ${component}: ${group.length} in 30 days`,
      description: `${component} has had ${group.length} bugs reported in the last 30 days: ${group.map(g => g.key).join(', ')}.`,
      url: '',
      fixSuggestion:
        `${component} has had ${group.length} bugs in the last 30 days. This indicates a systemic issue:\n` +
        `1. Schedule a code review of ${component} with the team\n` +
        `2. Check test coverage — add unit tests for the failing scenarios\n` +
        `3. Consider a technical debt sprint focused on ${component}\n` +
        `4. Review recent deployments to ${component} for pattern\n` +
        `5. Add monitoring alerts for early detection of future issues`,
    }));
  }

  return issues;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────────

export async function runJiraDeepScan(
  orgId: string,
  accessToken: string,
  cloudId: string
): Promise<ScanResult> {
  const base = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
  const agileBase = `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0`;
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };

  const { data: projectsData } = await withRetry(() =>
    axios.get(`${base}/project/search`, { headers, params: { maxResults: 50 } })
  );
  const projectKeys: string[] = (projectsData.values ?? projectsData).map((p: any) => p.key);

  const [staleIssues, unassignedIssues, sprintResult, slaIssues, recurringIssues] = await Promise.all([
    scanStaleIssues(base, headers, orgId).catch(err => { console.warn('[JiraDeepScan] stale scan failed:', err.message); return []; }),
    scanUnassignedCritical(base, headers, orgId).catch(err => { console.warn('[JiraDeepScan] unassigned scan failed:', err.message); return []; }),
    scanSprintHealth(agileBase, headers, orgId, projectKeys).catch(err => { console.warn('[JiraDeepScan] sprint scan failed:', err.message); return { issues: [], sprints: [] }; }),
    scanSlaBreaches(base, headers, orgId).catch(err => { console.warn('[JiraDeepScan] SLA scan failed:', err.message); return []; }),
    scanRecurringBugs(base, headers, orgId).catch(err => { console.warn('[JiraDeepScan] recurring scan failed:', err.message); return []; }),
  ]);

  const allIssues = [...staleIssues, ...unassignedIssues, ...sprintResult.issues, ...slaIssues, ...recurringIssues];

  return summarizeIssues(allIssues, projectKeys.length, { projects: projectKeys.length, sprints: sprintResult.sprints });
}
