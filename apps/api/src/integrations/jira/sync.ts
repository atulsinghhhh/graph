import axios from 'axios';
import { upsertNode, createRelationship } from '../../graph/queries';

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

function mapPriority(name: string): 'critical' | 'high' | 'medium' | 'low' {
  switch (name?.toLowerCase()) {
    case 'highest': return 'critical';
    case 'high': return 'high';
    case 'low':
    case 'lowest': return 'low';
    default: return 'medium';
  }
}

function isResolved(statusName: string): boolean {
  return ['done', 'resolved', 'closed', 'won\'t fix'].includes(statusName.toLowerCase());
}

export async function syncJira(
  orgId: string,
  accessToken: string,
  cloudId: string,
  siteUrl: string
): Promise<number> {
  const base = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
  let itemsSynced = 0;

  // Fetch all projects
  const { data: projectsData } = await withRetry(() =>
    axios.get(`${base}/project/search`, { headers, params: { maxResults: 50 } })
  );
  const projects: any[] = projectsData.values ?? projectsData;

  for (const project of projects) {
    await sleep(100);

    const jql = `project = "${project.key}" AND issuetype in (Bug, Incident) AND updated >= -30d ORDER BY updated DESC`;

    let startAt = 0;
    const maxResults = 100;

    while (true) {
      const { data: searchData } = await withRetry(() =>
        axios.get(`${base}/search`, {
          headers,
          params: {
            jql,
            startAt,
            maxResults,
            fields: 'summary,status,priority,assignee,created,updated,issuetype',
          },
        })
      );

      const issues: any[] = searchData.issues ?? [];
      if (issues.length === 0) break;

      for (const issue of issues) {
        const { fields, key } = issue;
        const issueType: string = fields.issuetype?.name ?? '';
        const priority = mapPriority(fields.priority?.name ?? 'Medium');
        const statusName: string = fields.status?.name ?? '';
        const resolved = isResolved(statusName);

        if (issueType === 'Incident') {
          await upsertNode('Incident', `jira:${key}`, orgId, {
            title: fields.summary,
            severity: priority,
            startedAt: fields.created,
            resolvedAt: resolved ? fields.updated : null,
            status: resolved ? 'resolved' : 'open',
            source: 'jira',
          });
          itemsSynced++;
        } else {
          // Bug
          await upsertNode('Bug', `jira:${key}`, orgId, {
            jiraId: key,
            title: fields.summary,
            priority,
            status: statusName,
            url: `${siteUrl}/browse/${key}`,
            source: 'jira',
          });
          itemsSynced++;
        }

        // Assignee
        if (fields.assignee) {
          const assignee = fields.assignee;
          const engineerId = `jira:user:${assignee.accountId}`;
          await upsertNode('Engineer', engineerId, orgId, {
            name: assignee.displayName,
            email: assignee.emailAddress ?? null,
            githubLogin: null,
            avatarUrl: assignee.avatarUrls?.['48x48'] ?? null,
            source: 'jira',
          });
          const nodeLabel = issueType === 'Incident' ? 'Incident' : 'Bug';
          await createRelationship(
            nodeLabel, `jira:${key}`,
            'Engineer', engineerId,
            'ASSIGNED_TO', orgId
          );
          itemsSynced++;
        }
      }

      if (startAt + issues.length >= searchData.total) break;
      startAt += issues.length;
      await sleep(100);
    }
  }

  return itemsSynced;
}
