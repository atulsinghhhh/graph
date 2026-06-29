import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

import neo4j from 'neo4j-driver';

const ORG = '5613be20-e134-48f7-854f-9ced29326898';

async function run() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!)
  );
  const session = driver.session();

  const counts = await session.run(
    'MATCH (n { orgId: $orgId }) RETURN labels(n)[0] AS label, count(n) AS cnt ORDER BY cnt DESC',
    { orgId: ORG }
  );
  console.log('Node counts:');
  counts.records.forEach(r => console.log(' ', r.get('label'), r.get('cnt').toNumber()));

  const rels = await session.run(
    `MATCH (pr:PullRequest { orgId: $orgId })-[r:AUTHORED_BY]->(e:Engineer { orgId: $orgId })
     RETURN count(r) AS cnt, collect(DISTINCT r.role)[0..5] AS roles`,
    { orgId: ORG }
  );
  console.log('\nAUTHORED_BY count:', rels.records[0]?.get('cnt')?.toNumber());
  console.log('Sample roles:', JSON.stringify(rels.records[0]?.get('roles')));

  const sample = await session.run(
    `MATCH (pr:PullRequest { orgId: $orgId })-[r:AUTHORED_BY]->(e:Engineer { orgId: $orgId })
     RETURN pr.title AS title, e.name AS author, r.role AS role LIMIT 3`,
    { orgId: ORG }
  );
  console.log('\nSample PR→Engineer rows:');
  sample.records.forEach(r =>
    console.log(' ', r.get('author'), '|', r.get('role'), '|', r.get('title')?.slice(0, 50))
  );

  await session.close();
  await driver.close();
}

run().catch(console.error);
