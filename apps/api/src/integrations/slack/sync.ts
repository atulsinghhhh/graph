import axios from 'axios';
import { upsertNode, createRelationship, runQuery } from '../../graph/queries';
import { getSupabase } from '../../config/postgres';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const WATCHED_CHANNEL_NAMES = ['incidents', 'alerts', 'engineering', 'security'];

function slackClient(accessToken: string) {
  return axios.create({
    baseURL: 'https://slack.com/api',
    timeout: 15_000,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Best-effort immediate alert — never throws, no-ops if Slack isn't connected for this org
export async function postSlackMessage(orgId: string, text: string): Promise<void> {
  try {
    const supabase = getSupabase();
    const { data: integration } = await supabase
      .from('integrations')
      .select('access_token, extra_data')
      .eq('org_id', orgId)
      .eq('provider', 'slack')
      .eq('status', 'connected')
      .single();

    if (!integration?.access_token) return;

    const slack = slackClient(integration.access_token);
    const { data: channelsRes } = await slack.get('/conversations.list', {
      params: { types: 'public_channel', limit: 200 },
    });
    const channel = (channelsRes.channels ?? []).find((c: any) =>
      ['incidents', 'security'].includes(c.name)
    );
    if (!channel) return;

    await slack.post('/chat.postMessage', { channel: channel.id, text });
  } catch (err: any) {
    console.warn('[Slack] postSlackMessage failed:', err.message);
  }
}

// Extracts graph node IDs mentioned in message text, e.g. "jira:INC-100" or "github:pr:421:org/repo".
// jira: IDs are ambiguous between Bug and Incident (both use the same "jira:{key}" scheme) —
// both labels are attempted; createRelationship's MATCH is a no-op (not an error) if the label is wrong.
function extractMentionedIds(text: string): { label: string; id: string }[] {
  const found: { label: string; id: string }[] = [];
  const idPattern = /\b(github:pr:\d+:[\w./-]+|jira:[A-Z]+-\d+|github:deploy:\d+)\b/g;
  let match: RegExpExecArray | null;
  while ((match = idPattern.exec(text)) !== null) {
    const id = match[1];
    if (id.startsWith('github:pr:')) found.push({ label: 'PullRequest', id });
    else if (id.startsWith('jira:')) found.push({ label: 'Bug', id }, { label: 'Incident', id });
    else if (id.startsWith('github:deploy:')) found.push({ label: 'Deployment', id });
  }
  return found;
}

export interface SlackSyncResult {
  itemsSynced: number;
  channels: number;
}

export async function syncSlack(orgId: string, accessToken: string): Promise<SlackSyncResult> {
  const slack = slackClient(accessToken);
  let itemsSynced = 0;

  const { data: channelsRes } = await slack.get('/conversations.list', {
    params: { types: 'public_channel', limit: 200 },
  });
  const channels: any[] = channelsRes.channels ?? [];
  const watched = channels.filter(c => WATCHED_CHANNEL_NAMES.includes(c.name));

  for (const channel of watched) {
    await sleep(200);
    let history: any;
    try {
      const { data } = await slack.get('/conversations.history', {
        params: { channel: channel.id, limit: 100 },
      });
      history = data;
    } catch (err: any) {
      console.warn(`[Slack] history fetch failed for #${channel.name}: ${err.message}`);
      continue;
    }

    for (const msg of history.messages ?? []) {
      if (!msg.ts || !msg.text) continue;
      const messageId = `slack:${channel.id}:${msg.ts}`;

      await upsertNode('Message', messageId, orgId, {
        source: 'slack',
        channel: channel.name,
        text: msg.text.slice(0, 500),
        user: msg.user ?? null,
        postedAt: new Date(Number(msg.ts) * 1000).toISOString(),
      });
      itemsSynced++;

      for (const mention of extractMentionedIds(msg.text)) {
        try {
          await createRelationship('Message', messageId, mention.label as any, mention.id, 'MENTIONS', orgId);
        } catch {
          // referenced node not in graph — non-critical
        }
      }
    }
  }

  return { itemsSynced, channels: watched.length };
}
