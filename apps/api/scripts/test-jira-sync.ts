import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });
process.env.JIRA_MOCK_MODE = 'true';

import { initNeo4j, closeNeo4j } from '../src/config/neo4j';
import { syncJira } from '../src/integrations/jira/sync';

const ORG_ID = 'demo-org';

async function run() {
  console.log('Connecting to Neo4j...');
  await initNeo4j();

  console.log('Running Jira mock sync...');
  const items = await syncJira(ORG_ID, 'mock-token', 'mock-cloud-id', 'https://mock.atlassian.net');
  console.log(`Jira mock sync completed — items synced: ${items}`);

  // Verify
  const { runQuery } = await import('../src/graph/queries');

  const incidents = await runQuery('MATCH (i:Incident { orgId: $orgId }) RETURN i.id AS id, i.title AS title', { orgId: ORG_ID });
  console.log('\nIncidents in graph:');
  incidents.forEach((r: any) => console.log(' ', r.id, '|', r.title));

  const bugs = await runQuery('MATCH (b:Bug { orgId: $orgId }) RETURN b.id AS id, b.jiraId AS jiraId, b.title AS title', { orgId: ORG_ID });
  console.log('\nBugs in graph:');
  bugs.forEach((r: any) => console.log(' ', r.id, '|', r.jiraId, '|', r.title));

  const engineers = await runQuery('MATCH (e:Engineer { orgId: $orgId, source: "jira" }) RETURN e.id AS id, e.name AS name', { orgId: ORG_ID });
  console.log('\nEngineers (Jira) in graph:');
  engineers.forEach((r: any) => console.log(' ', r.id, '|', r.name));

  const links = await runQuery(
    'MATCH (i:Incident { orgId: $orgId })-[:LINKED_TO]->(b:Bug { orgId: $orgId }) RETURN i.id AS inc, b.id AS bug',
    { orgId: ORG_ID }
  );
  console.log('\nIncident → Bug links:');
  links.forEach((r: any) => console.log(' ', r.inc, '→', r.bug));

  await closeNeo4j();
}

run().catch(err => { console.error('Test failed:', err.message); process.exit(1); });
