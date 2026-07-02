import { AxiosInstance } from 'axios';
import { slackClient, extractMentionedIds } from './sync';
import { upsertNode, createRelationship, runQuery } from '../../graph/queries';
import { recordIssue, summarizeIssues, ScanIssue, ScanResult } from '../scan-types';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const INCIDENT_CHANNEL_PATTERN = /^(incident|outage|alert|on-?call)/i;
const ALERT_CHANNEL_NAMES = ['alerts', 'monitoring', 'datadog', 'pagerduty'];
const ENGINEERING_CHANNEL_NAMES = ['engineering', 'backend', 'frontend', 'platform'];

const URGENCY_KEYWORDS = ['down', 'broken', 'failing', 'critical', 'outage', 'p0', 'p1', 'sev1', 'sev2'];
const RESOLUTION_KEYWORDS = ['resolved', 'fixed', 'rolled back', 'all clear', 'postmortem'];
const DECISION_KEYWORDS = ['we decided', 'going with', 'agreed to', 'will use', 'switching to', 'deprecating', 'migrating to', 'rolling back'];
const ALERT_KEYWORDS = ['error', 'alert', 'critical', 'warning', 'failed', 'failure'];

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

async function fetchHistory(slack: AxiosInstance, channelId: string): Promise<any[]> {
  try {
    const { data } = await slack.get('/conversations.history', { params: { channel: channelId, limit: 200 } });
    // Slack returns newest-first — reverse so we can walk chronologically.
    return (data.messages ?? []).slice().reverse();
  } catch (err: any) {
    console.warn(`[SlackDeepScan] history fetch failed for ${channelId}: ${err.message}`);
    return [];
  }
}

// ── S1 + S3 — Incident channel monitoring + response time ──────────────────────

async function scanIncidentChannels(slack: AxiosInstance, orgId: string, channels: any[]): Promise<ScanIssue[]> {
  const issues: ScanIssue[] = [];
  const incidentChannels = channels.filter(c => INCIDENT_CHANNEL_PATTERN.test(c.name));

  for (const channel of incidentChannels) {
    await sleep(150);
    const messages = await fetchHistory(slack, channel.id);
    if (messages.length === 0) continue;

    const firstMsg = messages[0];
    const incidentAgeMin = Math.round((Date.now() - Number(firstMsg.ts) * 1000) / 60_000);
    const responders = new Set<string>();
    const mentionedIssueIds: string[] = [];
    let hasResolutionSignal = false;
    let lastMessageMs = 0;

    for (const msg of messages) {
      if (msg.user) responders.add(msg.user);
      if (msg.text) {
        for (const m of extractMentionedIds(msg.text)) {
          if (!mentionedIssueIds.includes(m.id)) mentionedIssueIds.push(m.id);
        }
        if (containsAny(msg.text, RESOLUTION_KEYWORDS)) hasResolutionSignal = true;
      }
      lastMessageMs = Math.max(lastMessageMs, Number(msg.ts) * 1000);
    }

    const isActive = Date.now() - lastMessageMs < 30 * 60_000;
    const channelNodeId = `slack:channel:${channel.id}`;

    await upsertNode('IncidentChannel', channelNodeId, orgId, {
      channelName: channel.name,
      channelId: channel.id,
      incidentAge: incidentAgeMin,
      respondersCount: responders.size,
      mentionedIssues: mentionedIssueIds,
      isActive,
    });

    for (const id of mentionedIssueIds) {
      await runQuery(
        `MATCH (c:IncidentChannel { id: $channelNodeId, orgId: $orgId })
         MATCH (n { id: $id, orgId: $orgId })
         WHERE n:Incident OR n:Bug OR n:PullRequest
         MERGE (c)-[:REFERENCES]->(n)`,
        { channelNodeId, orgId, id }
      ).catch(() => {});
    }
    // Note: Slack user IDs aren't resolved to Engineer nodes (no shared identity mapping
    // exists between Slack and GitHub/Jira accounts) — this MERGE is a safe no-op until one does.
    for (const userId of responders) {
      await createRelationship('IncidentChannel', channelNodeId, 'Engineer', `slack:user:${userId}`, 'RESPONDED_BY', orgId).catch(() => {});
    }

    if (incidentAgeMin > 60 && !hasResolutionSignal) {
      issues.push(await recordIssue({
        id: `slack:issue:unresolved:${channel.id}`,
        orgId,
        source: 'slack',
        type: 'unresolved_incident_channel',
        severity: 'high',
        title: `Active incident channel #${channel.name} — ${incidentAgeMin} min old`,
        description: `#${channel.name} has been active for ${incidentAgeMin} minutes with no resolution signal detected.`,
        url: `https://slack.com/app_redirect?channel=${channel.id}`,
        fixSuggestion:
          `Incident channel #${channel.name} has been active for ${incidentAgeMin} minutes.\n` +
          `1. Designate an incident commander if not already done\n` +
          `2. Post a status update: current state, actions taken, ETA\n` +
          `3. Check if the linked issues (${mentionedIssueIds.join(', ') || 'none found'}) are being tracked in Jira\n` +
          `4. If resolved: post resolution summary and archive the channel\n` +
          `5. Schedule post-mortem within 24 hours of resolution`,
      }));
    }

    const signalMsg = messages.find(m => m.text && containsAny(m.text, URGENCY_KEYWORDS));
    if (signalMsg) {
      const signalMs = Number(signalMsg.ts) * 1000;
      const responseMsg = messages.find(m => Number(m.ts) * 1000 > signalMs && m.user && m.user !== signalMsg.user);
      if (responseMsg) {
        const responseTimeMin = Math.round((Number(responseMsg.ts) * 1000 - signalMs) / 60_000);
        if (responseTimeMin > 15) {
          issues.push(await recordIssue({
            id: `slack:issue:slow-response:${channel.id}`,
            orgId,
            source: 'slack',
            type: 'slow_incident_response',
            severity: 'high',
            title: `Slow incident response: ${responseTimeMin} min in #${channel.name}`,
            description: `First response in #${channel.name} took ${responseTimeMin} minutes against a 15-minute SLA.`,
            url: `https://slack.com/app_redirect?channel=${channel.id}`,
            fixSuggestion:
              `Incident response took ${responseTimeMin} minutes — SLA is 15 minutes.\n` +
              `1. Check on-call rotation: was the right person paged?\n` +
              `2. Review PagerDuty escalation policy for this service\n` +
              `3. Add redundant alerting: Slack + PagerDuty + email\n` +
              `4. Run a response time drill with the team this week\n` +
              `5. Update runbook with faster triage steps`,
          }));
        }
      }
    }
  }

  return issues;
}

// ── S2 — Alert message detection ────────────────────────────────────────────────

async function scanAlertMessages(slack: AxiosInstance, orgId: string, channels: any[]): Promise<number> {
  let count = 0;
  const alertChannels = channels.filter(c => ALERT_CHANNEL_NAMES.includes(c.name));

  for (const channel of alertChannels) {
    await sleep(150);
    const messages = await fetchHistory(slack, channel.id);

    for (const msg of messages) {
      if (msg.subtype !== 'bot_message' || !msg.text || !containsAny(msg.text, ALERT_KEYWORDS)) continue;

      const msgId = `slack:msg:${msg.ts}`;
      const severity = /critical/i.test(msg.text) ? 'critical' : /error/i.test(msg.text) ? 'error' : 'warning';

      await upsertNode('AlertMessage', msgId, orgId, {
        channelId: channel.id,
        botName: msg.username ?? msg.bot_id ?? 'bot',
        message: msg.text.slice(0, 500),
        detectedAt: new Date(Number(msg.ts) * 1000).toISOString(),
        severity,
      });
      count++;

      await runQuery(
        `MATCH (am:AlertMessage { id: $msgId, orgId: $orgId })
         MATCH (a:Alert { orgId: $orgId })
         WHERE am.message CONTAINS a.metric
         MERGE (am)-[:SLACK_ALERT_FOR]->(a)`,
        { msgId, orgId }
      ).catch(() => {});
    }
  }

  return count;
}

// ── S4 — Key decision extraction ────────────────────────────────────────────────

async function scanDecisions(slack: AxiosInstance, orgId: string, channels: any[]): Promise<number> {
  let count = 0;
  const engChannels = channels.filter(c => ENGINEERING_CHANNEL_NAMES.includes(c.name));

  for (const channel of engChannels) {
    await sleep(150);
    const messages = await fetchHistory(slack, channel.id);

    for (const msg of messages) {
      if (!msg.text || !containsAny(msg.text, DECISION_KEYWORDS)) continue;

      const decisionId = `slack:decision:${msg.ts}`;
      await upsertNode('Decision', decisionId, orgId, {
        channelId: channel.id,
        channelName: channel.name,
        madeBy: msg.user ?? null,
        decisionText: msg.text.slice(0, 1000),
        madeAt: new Date(Number(msg.ts) * 1000).toISOString(),
      });
      count++;

      if (msg.user) {
        await createRelationship('Decision', decisionId, 'Engineer', `slack:user:${msg.user}`, 'MADE_BY', orgId).catch(() => {});
      }

      await runQuery(
        `MATCH (d:Decision { id: $decisionId, orgId: $orgId })
         MATCH (s:Service { orgId: $orgId })
         WHERE toLower(d.decisionText) CONTAINS toLower(s.name)
         MERGE (d)-[:AFFECTS]->(s)`,
        { decisionId, orgId }
      ).catch(() => {});
    }
  }

  return count;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────────

export async function runSlackDeepScan(orgId: string, accessToken: string): Promise<ScanResult> {
  const slack = slackClient(accessToken);

  const { data: channelsRes } = await slack.get('/conversations.list', { params: { types: 'public_channel', limit: 200 } });
  const channels: any[] = channelsRes.channels ?? [];

  const [incidentIssues, alertCount, decisionCount] = await Promise.all([
    scanIncidentChannels(slack, orgId, channels).catch(err => {
      console.warn('[SlackDeepScan] incident channel scan failed:', err.message);
      return [] as ScanIssue[];
    }),
    scanAlertMessages(slack, orgId, channels).catch(err => {
      console.warn('[SlackDeepScan] alert message scan failed:', err.message);
      return 0;
    }),
    scanDecisions(slack, orgId, channels).catch(err => {
      console.warn('[SlackDeepScan] decision scan failed:', err.message);
      return 0;
    }),
  ]);

  return summarizeIssues(incidentIssues, channels.length, { alertMessages: alertCount, decisions: decisionCount });
}
