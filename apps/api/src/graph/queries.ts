import { runQuery } from '../config/neo4j';

export { runQuery };

const VALID_LABELS = new Set([
  'Deployment', 'PullRequest', 'Engineer', 'Service', 'Incident', 'Bug', 'Alert',
  'SecretAlert', 'WorkflowRun', 'SecurityIncident', 'Message',
  'Issue', 'SprintNode', 'IncidentChannel', 'Decision', 'AlertMessage', 'OnCallSchedule',
  'Cycle', 'Project', 'SLO',
]);

const VALID_REL_TYPES = new Set([
  'INCLUDES', 'AUTHORED_BY', 'AUTHORED', 'OWNS', 'DEPLOYED_TO', 'DEPLOYS_TO',
  'TRIGGERED', 'TRIGGERED_ALERT', 'LINKED_TO', 'FIRED', 'CHANGED',
  'ASSIGNED_TO', 'HAS_ALERT', 'RESOLVED_BY', 'REPORTED_BY',
  'HAS_SECRET_ALERT', 'INTRODUCED_SECRET', 'PUSHED_SECRET', 'POSSIBLY_TRIGGERED',
  'FAILED_ON', 'TRIGGERED_BY', 'CAUSED', 'FOUND_IN', 'CAUSED_BY', 'AFFECTS',
  'HAS_ISSUE', 'MENTIONS',
  'IN_SPRINT', 'MANAGED_BY', 'REFERENCES', 'RESPONDED_BY', 'SLACK_ALERT_FOR', 'MADE_BY',
  'ON_CALL_FOR', 'ESCALATED_TO', 'COVERS', 'IN_CYCLE', 'IN_PROJECT', 'BLOCKED_BY',
  'OWNED_BY', 'MEASURES', 'TRIGGERED_BY_DEPLOY', 'WATCHES',
]);

function assertLabel(label: string): void {
  if (!VALID_LABELS.has(label)) throw new Error(`Invalid node label: ${label}`);
}

function assertRelType(type: string): void {
  if (!VALID_REL_TYPES.has(type)) throw new Error(`Invalid relationship type: ${type}`);
}

export async function upsertNode(
  label: string,
  id: string,
  orgId: string,
  properties: Record<string, unknown>
): Promise<void> {
  assertLabel(label);
  await runQuery(
    `MERGE (n:${label} { id: $id, orgId: $orgId })
     SET n += $props
     SET n.id = $id, n.orgId = $orgId, n.syncedAt = $syncedAt`,
    { id, orgId, props: properties, syncedAt: new Date().toISOString() }
  );
}

export async function createRelationship(
  fromLabel: string,
  fromId: string,
  toLabel: string,
  toId: string,
  relType: string,
  orgId: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  assertLabel(fromLabel);
  assertLabel(toLabel);
  assertRelType(relType);
  await runQuery(
    `MATCH (a:${fromLabel} { id: $fromId, orgId: $orgId })
     MATCH (b:${toLabel} { id: $toId, orgId: $orgId })
     MERGE (a)-[r:${relType}]->(b)
     SET r += $props`,
    { fromId, toId, orgId, props: properties }
  );
}

export async function getIncidentContext(
  incidentId: string,
  orgId: string
): Promise<Record<string, unknown> | null> {
  const records = await runQuery<Record<string, unknown>>(
    `MATCH (i:Incident { id: $incidentId, orgId: $orgId })
     OPTIONAL MATCH (d:Deployment)-[t:TRIGGERED]->(i)
     OPTIONAL MATCH (d)-[:INCLUDES]->(pr:PullRequest)
     OPTIONAL MATCH (pr)-[:AUTHORED_BY { role: 'author' }]->(eng:Engineer)
     OPTIONAL MATCH (pr)-[:CHANGED]->(svc:Service)
     OPTIONAL MATCH (i)-[:FIRED]->(alert:Alert)
     OPTIONAL MATCH (i)-[:LINKED_TO]->(bug:Bug)
     RETURN
       i AS incident,
       collect(DISTINCT { deployment: d, confidence: t.confidence }) AS deployments,
       collect(DISTINCT pr)    AS pullRequests,
       collect(DISTINCT eng)   AS engineers,
       collect(DISTINCT svc)   AS services,
       collect(DISTINCT alert) AS alerts,
       collect(DISTINCT bug)   AS bugs`,
    { incidentId, orgId }
  );
  return records[0] ?? null;
}

// Finds the real resolution for a resolved incident: the next deployment to the
// affected service (via the same DEPLOYED_TO edge the triggering deployment used),
// deployed after the triggering deployment. If that deployment shipped a PR, the PR
// is returned as the fix PR (e.g. a rollback). Returns null if no such deployment
// exists in the graph — we never fabricate a fix when the data doesn't show one.
export async function getIncidentFix(
  incidentId: string,
  orgId: string
): Promise<Record<string, unknown> | null> {
  const records = await runQuery<Record<string, unknown>>(
    `MATCH (i:Incident { id: $incidentId, orgId: $orgId, status: 'resolved' })
     MATCH (d:Deployment { orgId: $orgId })-[:TRIGGERED]->(i)
     MATCH (d)-[:DEPLOYED_TO]->(svc:Service { orgId: $orgId })
     MATCH (fixD:Deployment { orgId: $orgId })-[:DEPLOYED_TO]->(svc)
     WHERE datetime(fixD.deployedAt) > datetime(d.deployedAt)
     WITH fixD ORDER BY fixD.deployedAt ASC LIMIT 1
     OPTIONAL MATCH (fixD)-[:INCLUDES]->(fixPr:PullRequest { orgId: $orgId })
     RETURN fixD AS fixDeployment, fixPr AS fixPullRequest`,
    { incidentId, orgId }
  );
  return records[0] ?? null;
}

export async function findIncidentsByTimeRange(
  orgId: string,
  fromISO: string,
  toISO: string
): Promise<Record<string, unknown>[]> {
  return runQuery<Record<string, unknown>>(
    `MATCH (i:Incident { orgId: $orgId })
     WHERE i.startedAt >= $fromISO AND i.startedAt <= $toISO
     OPTIONAL MATCH (d:Deployment { orgId: $orgId })-[t:TRIGGERED]->(i)
     OPTIONAL MATCH (d)-[:INCLUDES]->(pr:PullRequest { orgId: $orgId })
       -[:AUTHORED_BY { role: 'author' }]->(e:Engineer { orgId: $orgId })
     RETURN i,
       collect(DISTINCT { id: d.id, version: d.version, confidence: t.confidence }) AS deployments,
       collect(DISTINCT { id: e.id, name: e.name, githubLogin: e.githubLogin }) AS authors
     ORDER BY i.startedAt DESC
     LIMIT 10`,
    { orgId, fromISO, toISO }
  );
}

export async function findServiceOwner(
  serviceName: string,
  orgId: string
): Promise<Record<string, unknown> | null> {
  const records = await runQuery<Record<string, unknown>>(
    `MATCH (e:Engineer { orgId: $orgId })-[o:OWNS]->(s:Service { name: $serviceName, orgId: $orgId })
     RETURN e, o.confidence AS confidence
     ORDER BY confidence DESC
     LIMIT 1`,
    { serviceName, orgId }
  );
  return records[0] ?? null;
}

export async function getRecentSecretAlerts(
  orgId: string,
  limitCount = 20
): Promise<Record<string, unknown>[]> {
  return runQuery<Record<string, unknown>>(
    `MATCH (s:SecretAlert { orgId: $orgId })
     OPTIONAL MATCH (svc:Service { orgId: $orgId })-[:HAS_SECRET_ALERT]->(s)
     OPTIONAL MATCH (e:Engineer { orgId: $orgId })-[:PUSHED_SECRET]->(s)
     RETURN s, svc.name AS service, e.name AS pushedBy
     ORDER BY s.createdAt DESC
     LIMIT $limitCount`,
    { orgId, limitCount }
  );
}

export async function getSecretsForIncident(
  incidentId: string,
  orgId: string
): Promise<Record<string, unknown>[]> {
  return runQuery<Record<string, unknown>>(
    `MATCH (s:SecretAlert { orgId: $orgId })-[r:POSSIBLY_TRIGGERED]->(i:Incident { id: $incidentId, orgId: $orgId })
     OPTIONAL MATCH (e:Engineer { orgId: $orgId })-[:PUSHED_SECRET]->(s)
     OPTIONAL MATCH (svc:Service { orgId: $orgId })-[:HAS_SECRET_ALERT]->(s)
     RETURN s, r.confidence AS confidence, e.name AS pushedBy, svc.name AS service
     ORDER BY r.confidence DESC`,
    { incidentId, orgId }
  );
}

export async function findEngineerSecrets(
  engineerId: string,
  orgId: string
): Promise<Record<string, unknown>[]> {
  return runQuery<Record<string, unknown>>(
    `MATCH (e:Engineer { id: $engineerId, orgId: $orgId })-[:PUSHED_SECRET]->(s:SecretAlert { orgId: $orgId })
     OPTIONAL MATCH (svc:Service { orgId: $orgId })-[:HAS_SECRET_ALERT]->(s)
     OPTIONAL MATCH (s)-[r:POSSIBLY_TRIGGERED]->(i:Incident { orgId: $orgId })
     RETURN s, svc.name AS service, r.confidence AS incidentConfidence, i.title AS incidentTitle
     ORDER BY s.createdAt DESC`,
    { engineerId, orgId }
  );
}

// Returns an existing node's cached fixSuggestion, if any — used so re-scans
// never regenerate AI text for an issue that's still open from a prior scan.
export async function getIssueFixSuggestion(id: string, orgId: string): Promise<string | null> {
  const records = await runQuery<{ fixSuggestion: string | null }>(
    `MATCH (n { id: $id, orgId: $orgId }) RETURN n.fixSuggestion AS fixSuggestion LIMIT 1`,
    { id, orgId }
  );
  return records[0]?.fixSuggestion ?? null;
}

export async function countEngineers(orgId: string): Promise<number> {
  const records = await runQuery<{ count: number }>(
    `MATCH (e:Engineer { orgId: $orgId }) RETURN count(e) AS count`,
    { orgId }
  );
  return Number(records[0]?.count ?? 0);
}

export async function findDeploymentsNearAlert(
  orgId: string,
  alertFiredAt: string,
  windowMinutes = 60
): Promise<Record<string, unknown>[]> {
  const windowStart = new Date(
    new Date(alertFiredAt).getTime() - windowMinutes * 60 * 1000
  ).toISOString();

  return runQuery<Record<string, unknown>>(
    `MATCH (d:Deployment { orgId: $orgId })
     WHERE d.deployedAt <= $alertFiredAt AND d.deployedAt >= $windowStart
     OPTIONAL MATCH (d)-[:DEPLOYED_TO]->(s:Service { orgId: $orgId })
     RETURN d, collect(DISTINCT s) AS services
     ORDER BY d.deployedAt DESC`,
    { orgId, alertFiredAt, windowStart }
  );
}
