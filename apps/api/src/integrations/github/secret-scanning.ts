import { AxiosInstance } from 'axios';
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

async function getCommitShaForAlert(
  gh: AxiosInstance,
  repoName: string,
  alertNumber: number
): Promise<string | null> {
  try {
    const { data: locations } = await withRetry(() =>
      gh.get(`/repos/${repoName}/secret-scanning/alerts/${alertNumber}/locations`, {
        params: { per_page: 10 },
      })
    );
    const commitLoc = (locations as any[]).find((l: any) => l.type === 'commit');
    return commitLoc?.details?.commit_sha ?? null;
  } catch {
    return null;
  }
}

async function getCommitAuthorLogin(
  gh: AxiosInstance,
  repoName: string,
  commitSha: string
): Promise<string | null> {
  try {
    const { data: commit } = await withRetry(() =>
      gh.get(`/repos/${repoName}/commits/${commitSha}`)
    );
    return (commit as any).author?.login ?? null;
  } catch {
    return null;
  }
}

async function getPrsForCommit(
  gh: AxiosInstance,
  repoName: string,
  commitSha: string
): Promise<number[]> {
  try {
    const { data: prs } = await withRetry(() =>
      gh.get(`/repos/${repoName}/commits/${commitSha}/pulls`, {
        headers: { Accept: 'application/vnd.github.groot-preview+json' },
        params: { per_page: 20 },
      })
    );
    return (prs as any[]).map((pr: any) => pr.number);
  } catch {
    return [];
  }
}

export async function syncSecretScanningAlerts(
  orgId: string,
  gh: AxiosInstance,
  repoName: string,
  serviceId: string
): Promise<number> {
  let synced = 0;
  let page = 1;
  const perPage = 100;

  while (true) {
    let alerts: any[];
    try {
      const { data } = await withRetry(() =>
        gh.get(`/repos/${repoName}/secret-scanning/alerts`, {
          params: { state: 'all', per_page: perPage, page },
        })
      );
      alerts = data as any[];
    } catch (err: any) {
      const status = err.response?.status;
      // 400/404 = secret scanning not enabled or not available for this repo
      // 422 = not supported (e.g. public forks on free plan)
      if (status === 400 || status === 404 || status === 422) break;
      throw err;
    }

    if (!alerts.length) break;

    for (const alert of alerts) {
      const alertId = `github:secret:${alert.number}:${repoName}`;

      const commitSha = await getCommitShaForAlert(gh, repoName, alert.number);

      await upsertNode('SecretAlert', alertId, orgId, {
        alertNumber: alert.number,
        source: 'github',
        secretType: alert.secret_type_display_name ?? alert.secret_type,
        state: alert.state,
        resolution: alert.resolution ?? null,
        createdAt: alert.created_at,
        updatedAt: alert.updated_at,
        repository: repoName,
        url: alert.html_url,
        commitSha: commitSha ?? null,
        pushProtectionBypassed: alert.push_protection_bypassed ?? false,
      });
      synced++;

      // (Service)-[:HAS_SECRET_ALERT]->(SecretAlert)
      await createRelationship('Service', serviceId, 'SecretAlert', alertId, 'HAS_SECRET_ALERT', orgId);

      if (commitSha) {
        // (Engineer)-[:PUSHED_SECRET]->(SecretAlert)
        const authorLogin = await getCommitAuthorLogin(gh, repoName, commitSha);
        if (authorLogin) {
          const engineerId = `github:user:${authorLogin}`;
          try {
            await createRelationship('Engineer', engineerId, 'SecretAlert', alertId, 'PUSHED_SECRET', orgId);
          } catch {
            // Engineer not yet in graph — non-critical
          }
        }

        // (PullRequest)-[:INTRODUCED_SECRET]->(SecretAlert)
        const prNumbers = await getPrsForCommit(gh, repoName, commitSha);
        for (const prNumber of prNumbers) {
          const prId = `github:pr:${prNumber}:${repoName}`;
          try {
            await createRelationship('PullRequest', prId, 'SecretAlert', alertId, 'INTRODUCED_SECRET', orgId);
          } catch {
            // PR not in graph — non-critical
          }
        }
      }

      await sleep(100);
    }

    if (alerts.length < perPage) break;
    page++;
    await sleep(100);
  }

  return synced;
}
