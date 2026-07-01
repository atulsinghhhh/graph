import { runQuery } from '../config/neo4j';

const LABELS = [
  'Deployment', 'PullRequest', 'Engineer', 'Service', 'Incident', 'Bug', 'Alert', 'SecretAlert',
  'WorkflowRun', 'SecurityIncident', 'Message',
];

const TIME_INDEXES: [string, string][] = [
  ['Deployment', 'deployedAt'],
  ['Incident', 'startedAt'],
  ['Alert', 'firedAt'],
  ['SecretAlert', 'createdAt'],
  ['WorkflowRun', 'failedAt'],
  ['SecurityIncident', 'detectedAt'],
];

export async function applyNeo4jSchema(): Promise<void> {
  for (const label of LABELS) {
    const keyName = `${label.toLowerCase()}_node_key`;
    const fallbackName = `${label.toLowerCase()}_id_unique`;
    try {
      await runQuery(
        `CREATE CONSTRAINT ${keyName} IF NOT EXISTS FOR (n:${label}) REQUIRE (n.id, n.orgId) IS NODE KEY`
      );
    } catch {
      // NODE KEY requires Enterprise; fall back to uniqueness on id
      try {
        await runQuery(
          `CREATE CONSTRAINT ${fallbackName} IF NOT EXISTS FOR (n:${label}) REQUIRE n.id IS UNIQUE`
        );
      } catch (inner: any) {
        console.warn(`Could not create constraint for ${label}: ${inner.message}`);
      }
    }
  }

  for (const [label, prop] of TIME_INDEXES) {
    const indexName = `${label.toLowerCase()}_${prop.toLowerCase()}`;
    try {
      await runQuery(
        `CREATE INDEX ${indexName} IF NOT EXISTS FOR (n:${label}) ON (n.${prop})`
      );
    } catch (err: any) {
      console.warn(`Could not create index ${indexName}: ${err.message}`);
    }
  }

  console.log('Neo4j schema applied');
}
