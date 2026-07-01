import axios from 'axios';
import { upsertNode, createRelationship } from '../../graph/queries';

const LINEAR_ISSUES_QUERY = `
  query RecentIssues($since: DateTimeOrDuration!) {
    issues(first: 100, filter: { updatedAt: { gte: $since } }) {
      nodes {
        id
        identifier
        title
        url
        priority
        state { name }
        assignee { name email }
        cycle { name }
        project { name }
        updatedAt
      }
    }
  }
`;

function mapPriority(priority: number): 'critical' | 'high' | 'medium' | 'low' {
  switch (priority) {
    case 1: return 'critical';
    case 2: return 'high';
    case 3: return 'medium';
    default: return 'low';
  }
}

export async function syncLinear(orgId: string, accessToken: string): Promise<number> {
  let itemsSynced = 0;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const res = await axios.post(
    'https://api.linear.app/graphql',
    { query: LINEAR_ISSUES_QUERY, variables: { since } },
    { headers: { Authorization: accessToken, 'Content-Type': 'application/json' }, timeout: 20_000 }
  );

  if (res.data.errors) {
    throw new Error(res.data.errors[0]?.message ?? 'Linear GraphQL query failed');
  }

  const issues: any[] = res.data.data?.issues?.nodes ?? [];

  for (const issue of issues) {
    const bugId = `linear:${issue.identifier}`;

    await upsertNode('Bug', bugId, orgId, {
      jiraId: issue.identifier,
      title: issue.title,
      priority: mapPriority(issue.priority),
      status: issue.state?.name ?? 'unknown',
      url: issue.url,
      source: 'linear',
      linearId: issue.id,
      cycleName: issue.cycle?.name ?? null,
      projectName: issue.project?.name ?? null,
    });
    itemsSynced++;

    if (issue.assignee?.email) {
      const engineerId = `linear:user:${issue.assignee.email}`;
      await upsertNode('Engineer', engineerId, orgId, {
        name: issue.assignee.name,
        email: issue.assignee.email,
        githubLogin: null,
        avatarUrl: null,
        source: 'linear',
      });
      try {
        await createRelationship('Bug', bugId, 'Engineer', engineerId, 'ASSIGNED_TO', orgId);
      } catch {
        // non-critical
      }
    }
  }

  return itemsSynced;
}
