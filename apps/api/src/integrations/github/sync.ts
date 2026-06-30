import axios, { AxiosInstance } from 'axios';
import { upsertNode, createRelationship, runQuery } from '../../graph/queries';
import { syncSecretScanningAlerts } from './secret-scanning';

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

function makeGitHubClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: 'https://api.github.com',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

export async function syncGitHub(orgId: string, accessToken: string): Promise<number> {
  const gh = makeGitHubClient(accessToken);
  let itemsSynced = 0;

  // Fetch repos (single page, up to 100)
  const { data: repos } = await withRetry(() =>
    gh.get('/user/repos', { params: { per_page: 100, type: 'all', sort: 'updated' } })
  );

  for (const repo of repos) {
    const repoName: string = repo.full_name;
    const serviceId = `github:${repoName}`;

    // 1 — Upsert Service node
    await upsertNode('Service', serviceId, orgId, {
      name: repo.name,
      repoUrl: repo.html_url,
      language: repo.language ?? null,
      description: repo.description ?? null,
      source: 'github',
    });
    itemsSynced++;

    // 2 — Sync pull requests (most recent 100 merged, no date filter)
    await sleep(100);

    const { data: prs } = await withRetry(() =>
      gh.get(`/repos/${repoName}/pulls`, {
        params: { state: 'closed', per_page: 100, sort: 'updated', direction: 'desc' },
      })
    );

    const mergedPRs = prs.filter((pr: any) => pr.merged_at);

    for (const pr of mergedPRs) {
      const prId = `github:pr:${pr.number}:${repoName}`;

      // Fetch changed files
      await sleep(100);
      let changedFiles: string[] = [];
      try {
        const { data: files } = await withRetry(() =>
          gh.get(`/repos/${repoName}/pulls/${pr.number}/files`, { params: { per_page: 100 } })
        );
        changedFiles = files.map((f: any) => f.filename);
      } catch {
        // non-critical
      }

      await upsertNode('PullRequest', prId, orgId, {
        githubId: pr.number,
        title: pr.title,
        body: pr.body ? pr.body.slice(0, 1000) : null,
        mergedAt: pr.merged_at,
        branch: pr.head.ref,
        repoName,
        url: pr.html_url,
        changedFiles,
        source: 'github',
      });
      itemsSynced++;

      // Link PR → Service
      await createRelationship('PullRequest', prId, 'Service', serviceId, 'CHANGED', orgId);

      // Author
      if (pr.user) {
        const authorId = `github:user:${pr.user.login}`;
        await upsertNode('Engineer', authorId, orgId, {
          name: pr.user.name ?? pr.user.login,
          email: pr.user.email ?? null,
          githubLogin: pr.user.login,
          avatarUrl: pr.user.avatar_url,
          source: 'github',
        });
        itemsSynced++;
        await createRelationship('PullRequest', prId, 'Engineer', authorId, 'AUTHORED_BY', orgId, { role: 'author' });
      }

      // Reviewers (from requested_reviewers on the PR object)
      for (const reviewer of pr.requested_reviewers ?? []) {
        const reviewerId = `github:user:${reviewer.login}`;
        await upsertNode('Engineer', reviewerId, orgId, {
          name: reviewer.login,
          email: null,
          githubLogin: reviewer.login,
          avatarUrl: reviewer.avatar_url,
          source: 'github',
        });
        await createRelationship('PullRequest', prId, 'Engineer', reviewerId, 'AUTHORED_BY', orgId, { role: 'reviewer' });
      }
    }

    // 3 — Sync deployments
    await sleep(100);
    let deployments: any[] = [];
    try {
      const { data } = await withRetry(() =>
        gh.get(`/repos/${repoName}/deployments`, { params: { per_page: 50 } })
      );
      deployments = data;
    } catch {
      continue;
    }

    for (const dep of deployments) {
      const deployId = `github:deploy:${dep.id}`;
      const deployedAt: string = dep.created_at;

      // Get latest status
      await sleep(100);
      let status = 'unknown';
      try {
        const { data: statuses } = await withRetry(() =>
          gh.get(`/repos/${repoName}/deployments/${dep.id}/statuses`, { params: { per_page: 1 } })
        );
        if (statuses.length > 0) status = statuses[0].state;
      } catch {
        // non-critical
      }

      await upsertNode('Deployment', deployId, orgId, {
        version: dep.ref,
        environment: dep.environment,
        deployedAt,
        status,
        repoName,
        source: 'github',
      });
      itemsSynced++;

      // Link Deployment → Service
      await createRelationship('Deployment', deployId, 'Service', serviceId, 'DEPLOYED_TO', orgId);

      // Link Deployment → PRs merged in the 60 min before deployment
      const windowStart = new Date(new Date(deployedAt).getTime() - 60 * 60 * 1000).toISOString();
      await runQuery(
        `MATCH (d:Deployment { id: $deployId, orgId: $orgId })
         MATCH (pr:PullRequest { repoName: $repoName, orgId: $orgId })
         WHERE pr.mergedAt >= $windowStart AND pr.mergedAt <= $deployedAt
         MERGE (d)-[:INCLUDES]->(pr)`,
        { deployId, orgId, repoName, windowStart, deployedAt }
      );
    }

    // 4 — Sync secret scanning alerts (paginated, 100ms between pages)
    await sleep(100);
    try {
      const secretsSynced = await syncSecretScanningAlerts(orgId, gh, repoName, serviceId);
      itemsSynced += secretsSynced;
    } catch (err: any) {
      console.warn(`[GitHub] Secret scanning sync failed for ${repoName}: ${err.message}`);
    }
  }

  return itemsSynced;
}
