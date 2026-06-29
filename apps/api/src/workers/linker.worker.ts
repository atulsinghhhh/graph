import { runQuery } from '../graph/queries';

// Link 1: Deployment -[:TRIGGERED]-> Incident
// Fires when an incident starts within 90 min of a deployment, no existing edge.
async function linkDeploymentToIncident(orgId: string): Promise<void> {
  const now = new Date().toISOString();
  await runQuery(
    `MATCH (d:Deployment { orgId: $orgId })
     MATCH (i:Incident { orgId: $orgId })
     WHERE datetime(i.startedAt) >= datetime(d.deployedAt)
       AND datetime(i.startedAt) <= datetime(d.deployedAt) + duration({ minutes: 90 })
       AND NOT (d)-[:TRIGGERED]->(i)
     WITH d, i,
       duration.inSeconds(datetime(d.deployedAt), datetime(i.startedAt)).seconds AS gapSec
     WITH d, i, gapSec, 1.0 - (toFloat(gapSec) / 5400.0) AS confidence
     WHERE confidence > 0.2
     MERGE (d)-[r:TRIGGERED]->(i)
     SET r.confidence = confidence, r.detectedAt = $now`,
    { orgId, now }
  );
}

// Link 2: Engineer -[:OWNS]-> Service
// Based on PR authorship frequency — confidence = author's PR count / total PR count for that service.
async function linkEngineerOwnsService(orgId: string): Promise<void> {
  const now = new Date().toISOString();
  await runQuery(
    `MATCH (e:Engineer { orgId: $orgId })<-[:AUTHORED_BY { role: 'author' }]
          -(pr:PullRequest { orgId: $orgId })-[:CHANGED]->(s:Service { orgId: $orgId })
     WITH s, e, count(pr) AS prCount
     WITH s, collect({ e: e, count: prCount }) AS pairs, sum(prCount) AS total
     WHERE total > 0
     UNWIND pairs AS pair
     WITH s, pair.e AS e, toFloat(pair.count) / toFloat(total) AS confidence
     MERGE (e)-[r:OWNS]->(s)
     SET r.confidence = confidence, r.since = $now`,
    { orgId, now }
  );
}

// Link 3: Incident -[:LINKED_TO]-> Bug
// Matches when the incident title or description contains the bug's Jira ID (e.g. "ENG-281").
async function linkIncidentToBug(orgId: string): Promise<void> {
  await runQuery(
    `MATCH (i:Incident { orgId: $orgId })
     MATCH (b:Bug { orgId: $orgId })
     WHERE b.jiraId IS NOT NULL
       AND (i.title CONTAINS b.jiraId
            OR coalesce(i.description, '') CONTAINS b.jiraId
            OR i.id CONTAINS b.jiraId)
     MERGE (i)-[:LINKED_TO]->(b)`,
    { orgId }
  );
}

// Link 4: Incident -[:FIRED]-> Alert
// Matches when an alert fired within ±30 min of an incident starting.
async function linkIncidentToAlert(orgId: string): Promise<void> {
  await runQuery(
    `MATCH (i:Incident { orgId: $orgId })
     MATCH (a:Alert { orgId: $orgId })
     WHERE i.startedAt IS NOT NULL AND a.firedAt IS NOT NULL
     WITH i, a,
       abs(duration.inSeconds(datetime(i.startedAt), datetime(a.firedAt)).seconds) AS gapSec
     WHERE gapSec <= 1800
     MERGE (i)-[:FIRED]->(a)`,
    { orgId }
  );
}

export async function runLinker(orgId: string): Promise<void> {
  await linkDeploymentToIncident(orgId);
  await linkEngineerOwnsService(orgId);
  await linkIncidentToBug(orgId);
  await linkIncidentToAlert(orgId);
  console.log(`[Linker] Complete for org ${orgId}`);
}
