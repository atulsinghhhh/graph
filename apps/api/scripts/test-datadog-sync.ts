import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });
process.env.DATADOG_MOCK_MODE = 'true';

import { initNeo4j, closeNeo4j } from '../src/config/neo4j';
import { syncDatadog } from '../src/integrations/datadog/sync';

const ORG_ID = 'demo-org';

async function run() {
  console.log('Connecting to Neo4j...');
  await initNeo4j();

  console.log('Running Datadog mock sync...');
  const items = await syncDatadog(ORG_ID, 'mock-api-key', 'mock-app-key', 'datadoghq.com');
  console.log(`Datadog mock sync completed — items synced: ${items}`);

  // Verify
  const { runQuery } = await import('../src/graph/queries');

  const alerts = await runQuery(
    'MATCH (a:Alert { orgId: $orgId }) RETURN a.id AS id, a.metric AS metric, a.status AS status, a.firedAt AS firedAt',
    { orgId: ORG_ID }
  );
  console.log('\nAlerts in graph:');
  alerts.forEach((r: any) => console.log(' ', r.id, '|', r.metric, '|', r.status, '|', r.firedAt));

  const depLinks = await runQuery(
    'MATCH (d:Deployment { orgId: $orgId })-[r:TRIGGERED]->(a:Alert { orgId: $orgId }) RETURN d.version AS deploy, a.metric AS alert, r.confidence AS confidence',
    { orgId: ORG_ID }
  );
  console.log('\nDeployment → Alert links:');
  if (depLinks.length === 0) console.log('  (none — no deployments in window)');
  depLinks.forEach((r: any) => console.log(' ', r.deploy, '→', r.alert, `(confidence: ${r.confidence?.toFixed(2)})`));

  const incLinks = await runQuery(
    'MATCH (i:Incident { orgId: $orgId })-[:HAS_ALERT]->(a:Alert { orgId: $orgId }) RETURN i.title AS incident, a.metric AS alert',
    { orgId: ORG_ID }
  );
  console.log('\nIncident → Alert links:');
  if (incLinks.length === 0) console.log('  (none — no incidents in time window)');
  incLinks.forEach((r: any) => console.log(' ', r.incident, '→', r.alert));

  // Run twice to confirm idempotency (MERGE should not create duplicates)
  console.log('\nRunning again to verify idempotency...');
  await syncDatadog(ORG_ID, 'mock-api-key', 'mock-app-key', 'datadoghq.com');
  const alertsAfter = await runQuery('MATCH (a:Alert { orgId: $orgId }) RETURN count(a) AS cnt', { orgId: ORG_ID });
  const cnt = (alertsAfter[0] as any)?.cnt;
  const count = typeof cnt === 'object' ? cnt.low ?? cnt : cnt;
  console.log(`Alert count after second run: ${count} (should still be 1)`);

  await closeNeo4j();
}

run().catch(err => { console.error('Test failed:', err.message); process.exit(1); });
