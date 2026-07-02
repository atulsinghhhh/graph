import axios, { AxiosInstance } from 'axios';
import { upsertNode, createRelationship, runQuery } from '../../graph/queries';
import { postSlackMessage } from '../slack/sync';

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
    timeout: 20_000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

export interface DeepScanIssue {
  repo: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  fixSuggestion: string;
  nodeId: string;
  url?: string;
}

export interface DeepScanResult {
  reposScanned: number;
  issuesFound: DeepScanIssue[];
  secretsFound: number;
  ciFailures: number;
  prIssues: number;
  repoHealth: number;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// ── Scan 1 — Workflow / CI failures ────────────────────────────────────────────

async function scanWorkflowFailures(
  gh: AxiosInstance,
  orgId: string,
  repoName: string
): Promise<DeepScanIssue[]> {
  const issues: DeepScanIssue[] = [];
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  let runs: any[] = [];
  try {
    const { data } = await withRetry(() =>
      gh.get(`/repos/${repoName}/actions/runs`, {
        params: { status: 'failure', per_page: 20, created: `>=${since}` },
      })
    );
    runs = data.workflow_runs ?? [];
  } catch (err: any) {
    if (![403, 404].includes(err.response?.status)) {
      console.warn(`[DeepScan] workflow runs failed for ${repoName}: ${err.message}`);
    }
    return issues;
  }

  for (const run of runs) {
    const runId = `github:run:${run.id}`;
    const headBranch: string = run.head_branch;
    const triggeredBy: string | null = run.actor?.login ?? null;
    const workflowName: string = run.name ?? `workflow-${run.workflow_id}`;
    const logsUrl: string = run.logs_url ?? run.html_url;

    const fixSuggestion =
      `Check the workflow logs at ${logsUrl}. The failure is on branch ${headBranch} ` +
      `triggered by ${triggeredBy ?? 'unknown'}. Common fixes: dependency install errors → check package-lock.json, ` +
      `test failures → run tests locally with the same env vars, timeout → increase timeout in .github/workflows/${workflowName}.yml`;

    await upsertNode('WorkflowRun', runId, orgId, {
      source: 'github',
      repo: repoName,
      workflowName,
      status: 'failure',
      conclusion: run.conclusion,
      headBranch,
      headCommit: run.head_sha,
      triggeredBy,
      failedAt: run.created_at,
      url: run.html_url,
      logsUrl,
      fixSuggestion,
    });

    await runQuery(
      `MATCH (w:WorkflowRun { id: $runId, orgId: $orgId })
       MATCH (pr:PullRequest { branch: $headBranch, repoName: $repoName, orgId: $orgId })
       MERGE (w)-[:FAILED_ON]->(pr)`,
      { runId, orgId, headBranch, repoName }
    );

    if (triggeredBy) {
      try {
        await createRelationship('WorkflowRun', runId, 'Engineer', `github:user:${triggeredBy}`, 'TRIGGERED_BY', orgId);
      } catch {
        // engineer not yet in graph — non-critical
      }
    }

    // 3+ failures of the same workflow in 24h → auto-create an Incident
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const countRecords = await runQuery<{ count: number }>(
      `MATCH (w:WorkflowRun { orgId: $orgId, repo: $repoName, workflowName: $workflowName })
       WHERE w.failedAt >= $dayAgo
       RETURN count(w) AS count`,
      { orgId, repoName, workflowName, dayAgo }
    );
    if (Number(countRecords[0]?.count ?? 0) >= 3) {
      const incidentId = `github:ci-incident:${repoName}:${workflowName}`;
      await upsertNode('Incident', incidentId, orgId, {
        title: `CI pipeline failing on ${repoName}`,
        severity: 'high',
        startedAt: run.created_at,
        status: 'open',
        source: 'github',
      });
      await createRelationship('WorkflowRun', runId, 'Incident', incidentId, 'CAUSED', orgId);
    }

    issues.push({
      repo: repoName,
      type: 'ci_failure',
      severity: 'high',
      title: `${workflowName} failed on ${repoName} (${headBranch})`,
      fixSuggestion,
      nodeId: runId,
      url: run.html_url,
    });
  }

  return issues;
}

// ── Scan 2 — Secret / credential detection ─────────────────────────────────────

const SECRET_PATTERNS: { type: string; regex: RegExp }[] = [
  { type: 'private_key', regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { type: 'aws_key', regex: /AKIA[0-9A-Z]{16}/ },
  { type: 'github_token', regex: /ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}/ },
  { type: 'stripe_key', regex: /sk_live_[a-zA-Z0-9]{24}|pk_live_[a-zA-Z0-9]{24}/ },
  { type: 'database_url', regex: /(postgres|mysql):\/\/[^:]+:[^@]+@/ },
  { type: 'slack_token', regex: /xox[baprs]-[0-9a-zA-Z-]{10,}/ },
  { type: 'jwt_secret', regex: /"(jwt_secret|JWT_SECRET|secret_key)"\s*[:=]\s*"[^"]{8,}"/ },
  { type: 'generic_secret', regex: /(secret|password|passwd|pwd|api_key|apikey)\s*[:=]\s*["'][^"']{8,}["']/i },
];

function detectSecretType(patchText: string): string | null {
  for (const p of SECRET_PATTERNS) {
    if (p.regex.test(patchText)) return p.type;
  }
  if (/aws_secret/i.test(patchText) && /[0-9a-zA-Z/+]{40}/.test(patchText)) return 'aws_secret';
  if (/datadog/i.test(patchText) && /[a-f0-9]{32}/.test(patchText)) return 'datadog_key';
  return null;
}

function buildSecretFixSuggestion(type: string): string {
  switch (type) {
    case 'aws_key':
    case 'aws_secret':
      return 'CRITICAL: Rotate this AWS key immediately at console.aws.amazon.com/iam → Access Keys. After rotating: remove the secret from git history with git filter-branch or BFG Repo Cleaner. Enable AWS CloudTrail to check if the key was used.';
    case 'github_token':
      return 'CRITICAL: Revoke this token immediately at github.com/settings/tokens. Check if the token was used: GitHub → Settings → Security log. Remove from git history with BFG Repo Cleaner.';
    case 'stripe_key':
      return 'CRITICAL: Rotate this Stripe key immediately at dashboard.stripe.com/apikeys. Check Stripe logs for unauthorized charges. Remove from git history.';
    case 'private_key':
      return 'CRITICAL: This private key is now compromised. Generate a new key pair. Revoke the old key from wherever it was registered (SSH, SSL cert, etc). Remove from git history immediately.';
    case 'database_url':
      return 'CRITICAL: Rotate your database password immediately. Check database access logs for unauthorized queries. Update all services using this connection string.';
    default:
      return 'After rotating: add this file pattern to .gitignore, add the secret to your secrets manager (AWS Secrets Manager, HashiCorp Vault, or GitHub Actions Secrets), never commit secrets directly to code.';
  }
}

async function scanSecrets(
  gh: AxiosInstance,
  orgId: string,
  repoName: string,
  serviceId: string
): Promise<{ issues: DeepScanIssue[]; secretsFound: number }> {
  const issues: DeepScanIssue[] = [];
  let secretsFound = 0;
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  let commits: any[] = [];
  try {
    const { data } = await withRetry(() => gh.get(`/repos/${repoName}/commits`, { params: { since, per_page: 50 } }));
    commits = data;
  } catch (err: any) {
    if (![403, 404, 409].includes(err.response?.status)) {
      console.warn(`[DeepScan] commits fetch failed for ${repoName}: ${err.message}`);
    }
    return { issues, secretsFound };
  }

  for (const commitStub of commits) {
    const sha: string = commitStub.sha;
    await sleep(100);

    let commit: any;
    try {
      const { data } = await withRetry(() => gh.get(`/repos/${repoName}/commits/${sha}`));
      commit = data;
    } catch {
      continue;
    }

    let match: { type: string; filePath: string } | null = null;
    for (const file of commit.files ?? []) {
      if (!file.patch) continue;
      const type = detectSecretType(file.patch);
      if (type) {
        match = { type, filePath: file.filename };
        break;
      }
    }
    if (!match) continue;

    secretsFound++;
    const incidentId = `github:secret:${sha}:${repoName}`;
    const pushedBy: string | null = commit.author?.login ?? null;
    const fixSuggestion = buildSecretFixSuggestion(match.type);

    await upsertNode('SecurityIncident', incidentId, orgId, {
      source: 'github',
      type: 'secret_exposed',
      severity: 'critical',
      repo: repoName,
      branch: null,
      commitSha: sha,
      filePath: match.filePath,
      secretType: match.type,
      detectedAt: new Date().toISOString(),
      status: 'open',
      pushedBy,
      fixSuggestion,
    });

    try {
      const { data: prs } = await withRetry(() =>
        gh.get(`/repos/${repoName}/commits/${sha}/pulls`, {
          headers: { Accept: 'application/vnd.github.groot-preview+json' },
          params: { per_page: 5 },
        })
      );
      for (const pr of prs as any[]) {
        try {
          await createRelationship(
            'SecurityIncident', incidentId, 'PullRequest', `github:pr:${pr.number}:${repoName}`, 'FOUND_IN', orgId
          );
        } catch {
          // PR not in graph — non-critical
        }
      }
    } catch {
      // non-critical
    }

    if (pushedBy) {
      try {
        await createRelationship('SecurityIncident', incidentId, 'Engineer', `github:user:${pushedBy}`, 'CAUSED_BY', orgId);
      } catch {
        // engineer not yet in graph
      }
    }

    try {
      await createRelationship('SecurityIncident', incidentId, 'Service', serviceId, 'AFFECTS', orgId);
    } catch {
      // non-critical
    }

    issues.push({
      repo: repoName,
      type: 'secret',
      severity: 'critical',
      title: `${match.type} exposed in ${repoName} (${match.filePath})`,
      fixSuggestion,
      nodeId: incidentId,
      url: commit.html_url,
    });

    postSlackMessage(
      orgId,
      `🚨 Secret detected in ${repoName}: *${match.type}* in \`${match.filePath}\`${pushedBy ? ` (pushed by ${pushedBy})` : ''}. ${fixSuggestion}`
    ).catch(() => {});
  }

  return { issues, secretsFound };
}

// ── Scan 3 — Pull request health ───────────────────────────────────────────────

function buildPrFixSuggestion(issueType: string, pr: any, updates: Record<string, unknown>): string {
  switch (issueType) {
    case 'failing_checks':
      return `Run ${((updates.failingChecks as string[] | undefined) ?? [])[0] ?? 'the failing check'} locally to debug. Check the workflow logs at ${pr.html_url}.`;
    case 'merge_conflict':
      return 'Rebase this branch onto main: git fetch origin && git rebase origin/main. Then resolve conflicts and force push.';
    case 'stale':
      return `This PR has been open for ${updates.daysSinceActivity} days with no activity. Either merge, close, or assign a reviewer.`;
    case 'large_pr':
      return `This PR is too large (${updates.changedFilesCount} files changed). Consider splitting into smaller, focused PRs.`;
    case 'no_review':
      return `This PR has been waiting for review. Ping ${(pr.requested_reviewers ?? []).map((r: any) => r.login).join(', ') || 'a reviewer'} or reassign.`;
    default:
      return '';
  }
}

async function scanPullRequestHealth(
  gh: AxiosInstance,
  orgId: string,
  repoName: string,
  serviceId: string
): Promise<DeepScanIssue[]> {
  const issues: DeepScanIssue[] = [];

  let prs: any[] = [];
  try {
    const { data } = await withRetry(() => gh.get(`/repos/${repoName}/pulls`, { params: { state: 'open', per_page: 50 } }));
    prs = data;
  } catch {
    return issues;
  }

  for (const pr of prs) {
    const prId = `github:pr:${pr.number}:${repoName}`;
    const foundIssues: string[] = [];
    const updates: Record<string, unknown> = {
      githubId: pr.number,
      title: pr.title,
      branch: pr.head.ref,
      repoName,
      url: pr.html_url,
      source: 'github',
    };

    try {
      const { data: checkRunsData } = await withRetry(() =>
        gh.get(`/repos/${repoName}/commits/${pr.head.sha}/check-runs`, { params: { per_page: 50 } })
      );
      const failing = (checkRunsData.check_runs ?? []).filter((c: any) => c.conclusion === 'failure');
      updates.checksStatus = failing.length > 0 ? 'failing' : 'passing';
      if (failing.length > 0) {
        updates.failingChecks = failing.map((c: any) => c.name);
        foundIssues.push('failing_checks');
      }
    } catch {
      // checks not available — non-critical
    }

    updates.hasConflicts = pr.mergeable === false;
    if (updates.hasConflicts) foundIssues.push('merge_conflict');

    const daysSinceActivity = Math.floor((Date.now() - new Date(pr.updated_at).getTime()) / 86_400_000);
    updates.isStale = daysSinceActivity >= 7;
    if (updates.isStale) {
      updates.daysSinceActivity = daysSinceActivity;
      foundIssues.push('stale');
    }

    const changedFiles = pr.changed_files ?? 0;
    const totalChanges = (pr.additions ?? 0) + (pr.deletions ?? 0);
    updates.isLarge = changedFiles > 20 || totalChanges > 1000;
    if (updates.isLarge) {
      updates.changedFilesCount = changedFiles;
      foundIssues.push('large_pr');
    }

    const reviewers = pr.requested_reviewers ?? [];
    const hoursSinceOpen = (Date.now() - new Date(pr.created_at).getTime()) / 3_600_000;
    updates.awaitingReview = false;
    if (reviewers.length > 0 && hoursSinceOpen >= 24) {
      let hasApproval = false;
      try {
        const { data: reviews } = await withRetry(() =>
          gh.get(`/repos/${repoName}/pulls/${pr.number}/reviews`, { params: { per_page: 20 } })
        );
        hasApproval = (reviews as any[]).some(r => r.state === 'APPROVED');
      } catch {
        // non-critical
      }
      if (!hasApproval) {
        updates.awaitingReview = true;
        foundIssues.push('no_review');
      }
    }

    await upsertNode('PullRequest', prId, orgId, updates);
    try {
      await createRelationship('PullRequest', prId, 'Service', serviceId, 'CHANGED', orgId);
    } catch {
      // non-critical
    }

    if (foundIssues.length > 0) {
      try {
        await createRelationship('PullRequest', prId, 'Service', serviceId, 'HAS_ISSUE', orgId, { type: foundIssues.join(',') });
      } catch {
        // non-critical
      }

      for (const issueType of foundIssues) {
        issues.push({
          repo: repoName,
          type: issueType,
          severity: issueType === 'failing_checks' ? 'high' : issueType === 'merge_conflict' ? 'medium' : 'low',
          title: `PR #${pr.number} (${repoName}): ${issueType.replace(/_/g, ' ')}`,
          fixSuggestion: buildPrFixSuggestion(issueType, pr, updates),
          nodeId: prId,
          url: pr.html_url,
        });
      }
    }

    await sleep(100);
  }

  return issues;
}

// ── Scan 4 — Repository health ─────────────────────────────────────────────────

async function scanRepoHealth(
  gh: AxiosInstance,
  orgId: string,
  repoName: string,
  serviceId: string
): Promise<DeepScanIssue[]> {
  const issues: DeepScanIssue[] = [];

  let repo: any;
  try {
    const { data } = await withRetry(() => gh.get(`/repos/${repoName}`));
    repo = data;
  } catch {
    return issues;
  }

  const defaultBranch: string = repo.default_branch ?? 'main';

  let branchProtected = false;
  try {
    await withRetry(() => gh.get(`/repos/${repoName}/branches/${defaultBranch}/protection`));
    branchProtected = true;
  } catch {
    branchProtected = false;
  }
  if (!branchProtected) {
    issues.push({
      repo: repoName,
      type: 'no_branch_protection',
      severity: 'high',
      title: `No branch protection on ${defaultBranch} (${repoName})`,
      fixSuggestion: `Enable branch protection at github.com/${repoName}/settings/branches. Require: PR reviews before merging, status checks to pass, no force pushes.`,
      nodeId: `${serviceId}:no_branch_protection`,
      url: `https://github.com/${repoName}/settings/branches`,
    });
  }

  let vulnerabilities: any[] = [];
  try {
    const { data } = await withRetry(() => gh.get(`/repos/${repoName}/dependabot/alerts`, { params: { per_page: 20, state: 'open' } }));
    vulnerabilities = Array.isArray(data) ? data : [];
  } catch {
    vulnerabilities = [];
  }
  for (const alert of vulnerabilities) {
    const pkg = alert.security_vulnerability?.package?.name ?? alert.dependency?.package?.name ?? 'dependency';
    const fixedIn = alert.security_vulnerability?.first_patched_version?.identifier ?? 'the latest version';
    issues.push({
      repo: repoName,
      type: 'vulnerability',
      severity: (alert.security_advisory?.severity ?? 'medium') as DeepScanIssue['severity'],
      title: `Vulnerable dependency ${pkg} in ${repoName}`,
      fixSuggestion: `Update ${pkg} to ${fixedIn} or later. Run: npm update ${pkg} or pip install --upgrade ${pkg}`,
      nodeId: `${serviceId}:vulnerability:${alert.number ?? pkg}`,
      url: `https://github.com/${repoName}/security/dependabot`,
    });
  }

  let hasGitignore = false;
  try {
    await withRetry(() => gh.get(`/repos/${repoName}/contents/.gitignore`));
    hasGitignore = true;
  } catch {
    hasGitignore = false;
  }
  if (!hasGitignore) {
    issues.push({
      repo: repoName,
      type: 'missing_gitignore',
      severity: 'medium',
      title: `No .gitignore in ${repoName}`,
      fixSuggestion: 'Add sensitive file patterns to .gitignore immediately.',
      nodeId: `${serviceId}:missing_gitignore`,
      url: `https://github.com/${repoName}`,
    });
  }

  await upsertNode('Service', serviceId, orgId, {
    branchProtected,
    vulnerabilityAlerts: vulnerabilities.length,
    hasGitignore,
  });

  return issues;
}

// ── Orchestrator ────────────────────────────────────────────────────────────────

export async function runDeepScan(orgId: string, accessToken: string): Promise<DeepScanResult> {
  const gh = makeGitHubClient(accessToken);
  const result: DeepScanResult = {
    reposScanned: 0, issuesFound: [], secretsFound: 0, ciFailures: 0, prIssues: 0, repoHealth: 0,
  };

  let repos: any[] = [];
  try {
    const { data } = await withRetry(() => gh.get('/user/repos', { params: { per_page: 20, type: 'all', sort: 'updated' } }));
    repos = data;
  } catch (err: any) {
    console.warn(`[DeepScan] failed to list repos: ${err.message}`);
    return result;
  }

  for (const repo of repos) {
    const repoName: string = repo.full_name;
    const serviceId = `github:${repoName}`;
    result.reposScanned++;

    const [workflowIssues, secretResult, prIssues, repoHealthIssues] = await Promise.all([
      scanWorkflowFailures(gh, orgId, repoName).catch(err => {
        console.warn(`[DeepScan] workflow scan failed for ${repoName}:`, err.message);
        return [] as DeepScanIssue[];
      }),
      scanSecrets(gh, orgId, repoName, serviceId).catch(err => {
        console.warn(`[DeepScan] secret scan failed for ${repoName}:`, err.message);
        return { issues: [] as DeepScanIssue[], secretsFound: 0 };
      }),
      scanPullRequestHealth(gh, orgId, repoName, serviceId).catch(err => {
        console.warn(`[DeepScan] PR health scan failed for ${repoName}:`, err.message);
        return [] as DeepScanIssue[];
      }),
      scanRepoHealth(gh, orgId, repoName, serviceId).catch(err => {
        console.warn(`[DeepScan] repo health scan failed for ${repoName}:`, err.message);
        return [] as DeepScanIssue[];
      }),
    ]);

    result.issuesFound.push(...workflowIssues, ...secretResult.issues, ...prIssues, ...repoHealthIssues);
    result.secretsFound += secretResult.secretsFound;
    result.ciFailures += workflowIssues.length;
    result.prIssues += prIssues.length;
    result.repoHealth += repoHealthIssues.length;

    await sleep(150);
  }

  result.issuesFound.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return result;
}
