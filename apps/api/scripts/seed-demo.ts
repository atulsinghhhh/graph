import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

import { initNeo4j, closeNeo4j } from '../src/config/neo4j';
import { upsertNode, createRelationship } from '../src/graph/queries';

const ORG_ID = process.env.SEED_ORG_ID || 'demo-org';

const now = Date.now();
const t = (minutesAgo: number) => new Date(now - minutesAgo * 60 * 1000).toISOString();

async function seed() {
  console.log('Connecting to Neo4j...');
  await initNeo4j();
  console.log('Seeding demo data for orgId:', ORG_ID);

  // ── Engineers ──────────────────────────────────────────────
  await upsertNode('Engineer', 'eng-alice', ORG_ID, {
    name: 'Alice Chen',
    email: 'alice@acme.dev',
    githubLogin: 'alicechen',
    avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Alice',
  });
  await upsertNode('Engineer', 'eng-bob', ORG_ID, {
    name: 'Bob Kim',
    email: 'bob@acme.dev',
    githubLogin: 'bobkim',
    avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Bob',
  });

  // ── Services ───────────────────────────────────────────────
  await upsertNode('Service', 'svc-checkout', ORG_ID, {
    name: 'checkout-api',
    repoName: 'acme/checkout-api',
    repoUrl: 'https://github.com/acme/checkout-api',
    language: 'TypeScript',
  });
  await upsertNode('Service', 'svc-payment', ORG_ID, {
    name: 'payment-service',
    repoName: 'acme/payment-service',
    repoUrl: 'https://github.com/acme/payment-service',
    language: 'Go',
  });

  // ── Pull Requests ──────────────────────────────────────────
  await upsertNode('PullRequest', 'pr-421', ORG_ID, {
    number: 421,
    title: 'Refactor payment validation — remove legacy Stripe v2 checks',
    url: 'https://github.com/acme/checkout-api/pull/421',
    state: 'merged',
    mergedAt: t(120),
    additions: 342,
    deletions: 89,
  });
  await upsertNode('PullRequest', 'pr-430', ORG_ID, {
    number: 430,
    title: 'Revert "Refactor payment validation" — rollback to v1.4.1',
    url: 'https://github.com/acme/checkout-api/pull/430',
    state: 'merged',
    mergedAt: t(30),
    additions: 89,
    deletions: 342,
  });

  // ── Deployments ────────────────────────────────────────────
  await upsertNode('Deployment', 'deploy-v142', ORG_ID, {
    version: 'v1.4.2',
    environment: 'production',
    status: 'failed',
    deployedAt: t(90),
    sha: 'a3f8c21d',
  });
  await upsertNode('Deployment', 'deploy-v143', ORG_ID, {
    version: 'v1.4.3',
    environment: 'production',
    status: 'success',
    deployedAt: t(25),
    sha: 'b92e4f07',
  });

  // ── Alert ──────────────────────────────────────────────────
  await upsertNode('Alert', 'alert-checkout-errors', ORG_ID, {
    metric: 'checkout.error_rate',
    threshold: '5%',
    value: '23%',
    severity: 'critical',
    firedAt: t(78),
    resolvedAt: t(22),
    source: 'datadog',
  });

  // ── Incident ───────────────────────────────────────────────
  await upsertNode('Incident', 'inc-checkout-001', ORG_ID, {
    title: 'Checkout failure — payment validation rejecting valid cards',
    severity: 'critical',
    status: 'resolved',
    startedAt: t(82),
    resolvedAt: t(20),
    postmortemUrl: 'https://notion.acme.dev/postmortem/checkout-2024-001',
  });

  // ── Bug ────────────────────────────────────────────────────
  await upsertNode('Bug', 'bug-eng-281', ORG_ID, {
    jiraId: 'ENG-281',
    title: 'Stripe SCA validation fails for non-US cards after payment refactor',
    priority: 'critical',
    status: 'resolved',
    url: 'https://acme.atlassian.net/browse/ENG-281',
    reportedAt: t(75),
    resolvedAt: t(18),
  });

  // ── SecretAlert ────────────────────────────────────────────
  // Created ~5 min before the incident (t(87)) so confidence ≈ 0.917 (rounds to 0.91)
  await upsertNode('SecretAlert', 'github:secret:100', ORG_ID, {
    alertNumber: 100,
    source: 'github',
    secretType: 'AWS Access Key',
    state: 'resolved',
    resolution: 'revoked',
    createdAt: t(87),
    updatedAt: t(20),
    repository: 'acme/checkout-service',
    url: 'https://github.com/acme/checkout-service/security/secret-scanning/100',
    commitSha: 'abc123def456789abc123def456789abc12345ab',
    pushProtectionBypassed: false,
  });

  console.log('Nodes created. Building relationships...');

  // ── AUTHORED ───────────────────────────────────────────────
  await createRelationship('Engineer', 'eng-alice', 'PullRequest', 'pr-421', 'AUTHORED', ORG_ID, {});
  await createRelationship('Engineer', 'eng-bob', 'PullRequest', 'pr-430', 'AUTHORED', ORG_ID, {});

  // ── INCLUDES ───────────────────────────────────────────────
  await createRelationship('Deployment', 'deploy-v142', 'PullRequest', 'pr-421', 'INCLUDES', ORG_ID, {});
  await createRelationship('Deployment', 'deploy-v143', 'PullRequest', 'pr-430', 'INCLUDES', ORG_ID, {});

  // ── DEPLOYS_TO ─────────────────────────────────────────────
  await createRelationship('Deployment', 'deploy-v142', 'Service', 'svc-checkout', 'DEPLOYS_TO', ORG_ID, {});
  await createRelationship('Deployment', 'deploy-v143', 'Service', 'svc-checkout', 'DEPLOYS_TO', ORG_ID, {});

  // ── OWNS ───────────────────────────────────────────────────
  await createRelationship('Engineer', 'eng-alice', 'Service', 'svc-checkout', 'OWNS', ORG_ID, { prCount: 24, ratio: 0.82 });
  await createRelationship('Engineer', 'eng-bob', 'Service', 'svc-payment', 'OWNS', ORG_ID, { prCount: 17, ratio: 0.71 });

  // ── TRIGGERED ─────────────────────────────────────────────
  await createRelationship('Deployment', 'deploy-v142', 'Incident', 'inc-checkout-001', 'TRIGGERED', ORG_ID, {
    confidence: 0.87,
    gapSeconds: 480,
  });

  // ── TRIGGERED_ALERT ───────────────────────────────────────
  await createRelationship('Deployment', 'deploy-v142', 'Alert', 'alert-checkout-errors', 'TRIGGERED_ALERT', ORG_ID, {
    confidence: 0.91,
    gapMinutes: 12,
  });

  // ── HAS_ALERT ─────────────────────────────────────────────
  await createRelationship('Incident', 'inc-checkout-001', 'Alert', 'alert-checkout-errors', 'HAS_ALERT', ORG_ID, {});

  // ── LINKED_TO ─────────────────────────────────────────────
  await createRelationship('Incident', 'inc-checkout-001', 'Bug', 'bug-eng-281', 'LINKED_TO', ORG_ID, { matchedOn: 'title' });

  // ── RESOLVED_BY ───────────────────────────────────────────
  await createRelationship('Incident', 'inc-checkout-001', 'Deployment', 'deploy-v143', 'RESOLVED_BY', ORG_ID, {});

  // ── REPORTED_BY ───────────────────────────────────────────
  await createRelationship('Bug', 'bug-eng-281', 'Engineer', 'eng-alice', 'REPORTED_BY', ORG_ID, {});

  // ── HAS_SECRET_ALERT ──────────────────────────────────────
  await createRelationship('Service', 'svc-checkout', 'SecretAlert', 'github:secret:100', 'HAS_SECRET_ALERT', ORG_ID, {});

  // ── PUSHED_SECRET ─────────────────────────────────────────
  await createRelationship('Engineer', 'eng-alice', 'SecretAlert', 'github:secret:100', 'PUSHED_SECRET', ORG_ID, {});

  // ── INTRODUCED_SECRET ─────────────────────────────────────
  await createRelationship('PullRequest', 'pr-421', 'SecretAlert', 'github:secret:100', 'INTRODUCED_SECRET', ORG_ID, {});

  // ── POSSIBLY_TRIGGERED ────────────────────────────────────
  // Secret was created 5 min before incident: confidence = 1.0 - (5/60) ≈ 0.917
  await createRelationship('SecretAlert', 'github:secret:100', 'Incident', 'inc-checkout-001', 'POSSIBLY_TRIGGERED', ORG_ID, {
    confidence: 0.91,
    detectedAt: new Date().toISOString(),
  });

  console.log('\nSeed complete. Demo graph summary:');
  console.log('  Engineers    : Alice Chen, Bob Kim');
  console.log('  Services     : checkout-api, payment-service');
  console.log('  PRs          : #421 (breaking change), #430 (rollback)');
  console.log('  Deploys      : v1.4.2 (failed), v1.4.3 (success)');
  console.log('  Alert        : checkout.error_rate critical');
  console.log('  Incident     : checkout failure (resolved)');
  console.log('  Bug          : ENG-281');
  console.log('  SecretAlert  : AWS Access Key #100 (acme/checkout-service, pushed by Alice, confidence 0.91)');
  console.log('\nTry asking:');
  console.log('  "Why did checkout fail yesterday?"');
  console.log('  "Did anyone push a secret?"');
  console.log('  "Who leaked an AWS key?"');
  console.log('  "Which incident was caused by a secret?"');

  await closeNeo4j();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
