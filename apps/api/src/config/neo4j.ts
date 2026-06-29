import neo4j, { Driver, Session } from 'neo4j-driver';

let driver: Driver | null = null;

export async function initNeo4j(): Promise<'connected' | 'not_configured' | string> {
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USERNAME;
  const pass = process.env.NEO4J_PASSWORD;

  if (!uri || !user || !pass) return 'not_configured';

  try {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, pass));
    await driver.verifyConnectivity();
    console.log('Neo4j connected');
    return 'connected';
  } catch (err: any) {
    driver = null;
    return `error: ${err.message}`;
  }
}

export function getDriver(): Driver {
  if (!driver) throw new Error('Neo4j not initialized');
  return driver;
}

export function getSession(): Session {
  return getDriver().session();
}

export async function runQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const session = getSession();
  try {
    const result = await session.run(cypher, params);
    return result.records.map(r => r.toObject() as T);
  } finally {
    await session.close();
  }
}

export async function closeNeo4j(): Promise<void> {
  await driver?.close();
}
