import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

import { initNeo4j, closeNeo4j } from '../src/config/neo4j';
import { upsertNode, createRelationship } from '../src/graph/queries';

const ORG_ID = process.env.SEED_ORG_ID || 'demo-org';
const now    = Date.now();
const t      = (m: number) => new Date(now - m * 60 * 1000).toISOString();

async function seed() {
  await initNeo4j();
  console.log('Seeding GitHub-only demo data for orgId:', ORG_ID);

  // ── Engineers (GitHub users) ──────────────────────────────────────────────
  await upsertNode('Engineer', 'eng-alice', ORG_ID, {
    name: 'Alice Chen', email: 'alice@acme.dev',
    githubLogin: 'alicechen', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Alice',
    role: 'Senior Backend Engineer',
  });
  await upsertNode('Engineer', 'eng-bob', ORG_ID, {
    name: 'Bob Kim', email: 'bob@acme.dev',
    githubLogin: 'bobkim', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Bob',
    role: 'Frontend Lead',
  });
  await upsertNode('Engineer', 'eng-carlos', ORG_ID, {
    name: 'Carlos Ruiz', email: 'carlos@acme.dev',
    githubLogin: 'carlosruiz', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Carlos',
    role: 'DevOps Engineer',
  });
  await upsertNode('Engineer', 'eng-diana', ORG_ID, {
    name: 'Diana Patel', email: 'diana@acme.dev',
    githubLogin: 'dianapatel', avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Diana',
    role: 'Full Stack Engineer',
  });

  // ── Services (GitHub repositories) ───────────────────────────────────────
  await upsertNode('Service', 'svc-checkout', ORG_ID, {
    name: 'checkout-api', repoName: 'acme/checkout-api',
    repoUrl: 'https://github.com/acme/checkout-api', language: 'TypeScript',
  });
  await upsertNode('Service', 'svc-payment', ORG_ID, {
    name: 'payment-service', repoName: 'acme/payment-service',
    repoUrl: 'https://github.com/acme/payment-service', language: 'Go',
  });
  await upsertNode('Service', 'svc-auth', ORG_ID, {
    name: 'auth-service', repoName: 'acme/auth-service',
    repoUrl: 'https://github.com/acme/auth-service', language: 'Python',
  });
  await upsertNode('Service', 'svc-gateway', ORG_ID, {
    name: 'api-gateway', repoName: 'acme/api-gateway',
    repoUrl: 'https://github.com/acme/api-gateway', language: 'TypeScript',
  });

  // ── Pull Requests ─────────────────────────────────────────────────────────
  await upsertNode('PullRequest', 'pr-421', ORG_ID, {
    number: 421, state: 'merged', mergedAt: t(180),
    title: 'refactor: remove legacy Stripe v2 payment validation checks',
    url: 'https://github.com/acme/checkout-api/pull/421',
    additions: 342, deletions: 89,
  });
  await upsertNode('PullRequest', 'pr-430', ORG_ID, {
    number: 430, state: 'merged', mergedAt: t(60),
    title: 'revert: rollback payment validation to v1.4.1',
    url: 'https://github.com/acme/checkout-api/pull/430',
    additions: 89, deletions: 342,
  });
  await upsertNode('PullRequest', 'pr-445', ORG_ID, {
    number: 445, state: 'merged', mergedAt: t(500),
    title: 'chore: optimise Docker image layers for auth-service',
    url: 'https://github.com/acme/auth-service/pull/445',
    additions: 45, deletions: 120,
  });
  await upsertNode('PullRequest', 'pr-460', ORG_ID, {
    number: 460, state: 'merged', mergedAt: t(300),
    title: 'fix: refresh JWT tokens silently before expiry',
    url: 'https://github.com/acme/auth-service/pull/460',
    additions: 88, deletions: 22,
  });
  await upsertNode('PullRequest', 'pr-471', ORG_ID, {
    number: 471, state: 'merged', mergedAt: t(130),
    title: 'feat: add per-IP rate limiting to api-gateway',
    url: 'https://github.com/acme/api-gateway/pull/471',
    additions: 210, deletions: 14,
  });
  await upsertNode('PullRequest', 'pr-480', ORG_ID, {
    number: 480, state: 'open',
    title: 'fix: cart item count incorrect on mobile viewport',
    url: 'https://github.com/acme/checkout-api/pull/480',
    additions: 31, deletions: 9,
  });

  // ── Deployments ───────────────────────────────────────────────────────────
  await upsertNode('Deployment', 'deploy-v142', ORG_ID, {
    version: 'v1.4.2', environment: 'production', status: 'failed',
    deployedAt: t(165), sha: 'a3f8c21d',
  });
  await upsertNode('Deployment', 'deploy-v143', ORG_ID, {
    version: 'v1.4.3', environment: 'production', status: 'success',
    deployedAt: t(55), sha: 'b92e4f07',
  });
  await upsertNode('Deployment', 'deploy-auth-v210', ORG_ID, {
    version: 'v2.1.0', environment: 'production', status: 'failed',
    deployedAt: t(290), sha: 'c11d8a3e',
  });
  await upsertNode('Deployment', 'deploy-auth-v211', ORG_ID, {
    version: 'v2.1.1', environment: 'production', status: 'success',
    deployedAt: t(240), sha: 'd44f9b12',
  });
  await upsertNode('Deployment', 'deploy-gw-v310', ORG_ID, {
    version: 'v3.1.0', environment: 'production', status: 'success',
    deployedAt: t(120), sha: 'e77c2f90',
  });

  // ── Alerts ────────────────────────────────────────────────────────────────
  await upsertNode('Alert', 'alert-checkout-errors', ORG_ID, {
    metric: 'checkout.error_rate', threshold: '5%', value: '23%',
    severity: 'critical', source: 'github-actions',
    firedAt: t(155), resolvedAt: t(45),
  });
  await upsertNode('Alert', 'alert-auth-timeout', ORG_ID, {
    metric: 'auth.timeout_rate', threshold: '1%', value: '8.4%',
    severity: 'high', source: 'github-actions',
    firedAt: t(285), resolvedAt: t(235),
  });
  await upsertNode('Alert', 'alert-rate-limit', ORG_ID, {
    metric: 'api.rate_limit_exceeded', threshold: '100/min', value: '430/min',
    severity: 'medium', source: 'github-actions',
    firedAt: t(140), resolvedAt: t(100),
  });

  // ── Incidents ─────────────────────────────────────────────────────────────
  await upsertNode('Incident', 'inc-checkout-001', ORG_ID, {
    title: 'Checkout failure — payment validation rejecting valid cards',
    severity: 'critical', status: 'resolved',
    startedAt: t(158), resolvedAt: t(40),
    postmortemUrl: 'https://github.com/acme/postmortems/issues/12',
  });
  await upsertNode('Incident', 'inc-auth-002', ORG_ID, {
    title: 'Auth service — JWT validation timeouts under load',
    severity: 'high', status: 'resolved',
    startedAt: t(283), resolvedAt: t(230),
    postmortemUrl: 'https://github.com/acme/postmortems/issues/11',
  });
  await upsertNode('Incident', 'inc-ratelimit-003', ORG_ID, {
    title: 'API gateway — rate limiter not applied to /checkout endpoint',
    severity: 'medium', status: 'resolved',
    startedAt: t(138), resolvedAt: t(98),
  });

  // ── Bugs (GitHub Issues) ──────────────────────────────────────────────────
  await upsertNode('Bug', 'bug-eng-281', ORG_ID, {
    jiraId: 'GH-281', title: 'Stripe SCA validation fails for non-US cards after payment refactor',
    priority: 'critical', status: 'resolved',
    url: 'https://github.com/acme/checkout-api/issues/281',
    reportedAt: t(152), resolvedAt: t(38),
  });
  await upsertNode('Bug', 'bug-eng-295', ORG_ID, {
    jiraId: 'GH-295', title: 'Auth token expiry not refreshed — users logged out prematurely',
    priority: 'high', status: 'resolved',
    url: 'https://github.com/acme/auth-service/issues/295',
    reportedAt: t(280), resolvedAt: t(228),
  });
  await upsertNode('Bug', 'bug-eng-310', ORG_ID, {
    jiraId: 'GH-310', title: 'Cart item count shows 0 on mobile after viewport resize',
    priority: 'medium', status: 'open',
    url: 'https://github.com/acme/checkout-api/issues/310',
    reportedAt: t(200),
  });

  // ── Secret Scanning Alerts ────────────────────────────────────────────────
  await upsertNode('SecretAlert', 'github:secret:100', ORG_ID, {
    alertNumber: 100, source: 'github', secretType: 'AWS Access Key',
    state: 'resolved', resolution: 'revoked',
    repository: 'acme/checkout-api',
    url: 'https://github.com/acme/checkout-api/security/secret-scanning/100',
    commitSha: 'abc123def456789abc123def456789abc12345ab',
    createdAt: t(170), updatedAt: t(50),
    pushProtectionBypassed: true,
  });
  await upsertNode('SecretAlert', 'github:secret:105', ORG_ID, {
    alertNumber: 105, source: 'github', secretType: 'GitHub Personal Access Token',
    state: 'open', resolution: null,
    repository: 'acme/auth-service',
    url: 'https://github.com/acme/auth-service/security/secret-scanning/105',
    commitSha: 'def456abc789012def456abc789012def456789d',
    createdAt: t(310), updatedAt: t(310),
    pushProtectionBypassed: false,
  });

  console.log('Nodes created. Building relationships...');

  // ── Engineer → PR (AUTHORED) ──────────────────────────────────────────────
  await createRelationship('Engineer', 'eng-alice',  'PullRequest', 'pr-421', 'AUTHORED', ORG_ID, {});
  await createRelationship('Engineer', 'eng-bob',    'PullRequest', 'pr-430', 'AUTHORED', ORG_ID, {});
  await createRelationship('Engineer', 'eng-carlos', 'PullRequest', 'pr-445', 'AUTHORED', ORG_ID, {});
  await createRelationship('Engineer', 'eng-diana',  'PullRequest', 'pr-460', 'AUTHORED', ORG_ID, {});
  await createRelationship('Engineer', 'eng-carlos', 'PullRequest', 'pr-471', 'AUTHORED', ORG_ID, {});
  await createRelationship('Engineer', 'eng-bob',    'PullRequest', 'pr-480', 'AUTHORED', ORG_ID, {});

  // ── Deployment → PR (INCLUDES) ────────────────────────────────────────────
  await createRelationship('Deployment', 'deploy-v142',      'PullRequest', 'pr-421', 'INCLUDES', ORG_ID, {});
  await createRelationship('Deployment', 'deploy-v143',      'PullRequest', 'pr-430', 'INCLUDES', ORG_ID, {});
  await createRelationship('Deployment', 'deploy-auth-v210', 'PullRequest', 'pr-445', 'INCLUDES', ORG_ID, {});
  await createRelationship('Deployment', 'deploy-auth-v211', 'PullRequest', 'pr-460', 'INCLUDES', ORG_ID, {});
  await createRelationship('Deployment', 'deploy-gw-v310',   'PullRequest', 'pr-471', 'INCLUDES', ORG_ID, {});

  // ── Deployment → Service (DEPLOYS_TO) ────────────────────────────────────
  await createRelationship('Deployment', 'deploy-v142',      'Service', 'svc-checkout', 'DEPLOYS_TO', ORG_ID, {});
  await createRelationship('Deployment', 'deploy-v143',      'Service', 'svc-checkout', 'DEPLOYS_TO', ORG_ID, {});
  await createRelationship('Deployment', 'deploy-auth-v210', 'Service', 'svc-auth',     'DEPLOYS_TO', ORG_ID, {});
  await createRelationship('Deployment', 'deploy-auth-v211', 'Service', 'svc-auth',     'DEPLOYS_TO', ORG_ID, {});
  await createRelationship('Deployment', 'deploy-gw-v310',   'Service', 'svc-gateway',  'DEPLOYS_TO', ORG_ID, {});

  // ── Engineer → Service (OWNS) ─────────────────────────────────────────────
  await createRelationship('Engineer', 'eng-alice',  'Service', 'svc-checkout', 'OWNS', ORG_ID, { prCount: 24, ratio: 0.82 });
  await createRelationship('Engineer', 'eng-bob',    'Service', 'svc-checkout', 'OWNS', ORG_ID, { prCount: 11, ratio: 0.38 });
  await createRelationship('Engineer', 'eng-diana',  'Service', 'svc-auth',     'OWNS', ORG_ID, { prCount: 18, ratio: 0.75 });
  await createRelationship('Engineer', 'eng-carlos', 'Service', 'svc-auth',     'OWNS', ORG_ID, { prCount: 9,  ratio: 0.42 });
  await createRelationship('Engineer', 'eng-carlos', 'Service', 'svc-gateway',  'OWNS', ORG_ID, { prCount: 21, ratio: 0.88 });
  await createRelationship('Engineer', 'eng-alice',  'Service', 'svc-payment',  'OWNS', ORG_ID, { prCount: 7,  ratio: 0.58 });

  // ── Deployment → Incident (TRIGGERED) ────────────────────────────────────
  await createRelationship('Deployment', 'deploy-v142',      'Incident', 'inc-checkout-001', 'TRIGGERED', ORG_ID, { confidence: 0.94, gapSeconds: 780 });
  await createRelationship('Deployment', 'deploy-auth-v210', 'Incident', 'inc-auth-002',     'TRIGGERED', ORG_ID, { confidence: 0.88, gapSeconds: 420 });
  await createRelationship('Deployment', 'deploy-gw-v310',   'Incident', 'inc-ratelimit-003','TRIGGERED', ORG_ID, { confidence: 0.76, gapSeconds: 600 });

  // ── Deployment → Alert (TRIGGERED_ALERT) ─────────────────────────────────
  await createRelationship('Deployment', 'deploy-v142',      'Alert', 'alert-checkout-errors', 'TRIGGERED_ALERT', ORG_ID, { confidence: 0.91, gapMinutes: 10 });
  await createRelationship('Deployment', 'deploy-auth-v210', 'Alert', 'alert-auth-timeout',    'TRIGGERED_ALERT', ORG_ID, { confidence: 0.85, gapMinutes: 5  });
  await createRelationship('Deployment', 'deploy-gw-v310',   'Alert', 'alert-rate-limit',      'TRIGGERED_ALERT', ORG_ID, { confidence: 0.79, gapMinutes: 15 });

  // ── Incident → Alert (HAS_ALERT) ─────────────────────────────────────────
  await createRelationship('Incident', 'inc-checkout-001', 'Alert', 'alert-checkout-errors', 'HAS_ALERT', ORG_ID, {});
  await createRelationship('Incident', 'inc-auth-002',     'Alert', 'alert-auth-timeout',    'HAS_ALERT', ORG_ID, {});
  await createRelationship('Incident', 'inc-ratelimit-003','Alert', 'alert-rate-limit',      'HAS_ALERT', ORG_ID, {});

  // ── Incident → Bug (LINKED_TO) ───────────────────────────────────────────
  await createRelationship('Incident', 'inc-checkout-001', 'Bug', 'bug-eng-281', 'LINKED_TO', ORG_ID, { matchedOn: 'title' });
  await createRelationship('Incident', 'inc-auth-002',     'Bug', 'bug-eng-295', 'LINKED_TO', ORG_ID, { matchedOn: 'title' });
  await createRelationship('Incident', 'inc-ratelimit-003','Bug', 'bug-eng-310', 'LINKED_TO', ORG_ID, { matchedOn: 'keyword' });

  // ── Incident → Deployment (RESOLVED_BY) ──────────────────────────────────
  await createRelationship('Incident', 'inc-checkout-001', 'Deployment', 'deploy-v143',      'RESOLVED_BY', ORG_ID, {});
  await createRelationship('Incident', 'inc-auth-002',     'Deployment', 'deploy-auth-v211', 'RESOLVED_BY', ORG_ID, {});

  // ── Bug → Engineer (REPORTED_BY) ─────────────────────────────────────────
  await createRelationship('Bug', 'bug-eng-281', 'Engineer', 'eng-alice',  'REPORTED_BY', ORG_ID, {});
  await createRelationship('Bug', 'bug-eng-295', 'Engineer', 'eng-diana',  'REPORTED_BY', ORG_ID, {});
  await createRelationship('Bug', 'bug-eng-310', 'Engineer', 'eng-bob',    'REPORTED_BY', ORG_ID, {});

  // ── Secret Alerts ─────────────────────────────────────────────────────────
  await createRelationship('Service',     'svc-checkout', 'SecretAlert', 'github:secret:100', 'HAS_SECRET_ALERT',  ORG_ID, {});
  await createRelationship('Service',     'svc-auth',     'SecretAlert', 'github:secret:105', 'HAS_SECRET_ALERT',  ORG_ID, {});
  await createRelationship('Engineer',    'eng-alice',    'SecretAlert', 'github:secret:100', 'PUSHED_SECRET',     ORG_ID, {});
  await createRelationship('Engineer',    'eng-diana',    'SecretAlert', 'github:secret:105', 'PUSHED_SECRET',     ORG_ID, {});
  await createRelationship('PullRequest', 'pr-421',       'SecretAlert', 'github:secret:100', 'INTRODUCED_SECRET', ORG_ID, {});
  await createRelationship('PullRequest', 'pr-460',       'SecretAlert', 'github:secret:105', 'INTRODUCED_SECRET', ORG_ID, {});

  await createRelationship('SecretAlert', 'github:secret:100', 'Incident', 'inc-checkout-001', 'POSSIBLY_TRIGGERED', ORG_ID, { confidence: 0.91 });
  await createRelationship('SecretAlert', 'github:secret:105', 'Incident', 'inc-auth-002',     'POSSIBLY_TRIGGERED', ORG_ID, { confidence: 0.78 });

  console.log('\n✓ Seed complete — GitHub-only demo graph:');
  console.log('  Engineers   : Alice Chen, Bob Kim, Carlos Ruiz, Diana Patel');
  console.log('  Services    : checkout-api, payment-service, auth-service, api-gateway');
  console.log('  PRs         : #421 #430 #445 #460 #471 #480');
  console.log('  Deployments : v1.4.2(fail) v1.4.3 v2.1.0(fail) v2.1.1 v3.1.0');
  console.log('  Alerts      : checkout.error_rate(critical) auth.timeout(high) rate_limit(medium)');
  console.log('  Incidents   : checkout(critical) auth-timeout(high) rate-limit(medium)');
  console.log('  Bugs        : GH-281(critical) GH-295(high) GH-310(medium/open)');
  console.log('  Secrets     : AWS Key #100(resolved/bypassed) GitHub PAT #105(open)');

  await closeNeo4j();
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
