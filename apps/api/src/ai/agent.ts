import Groq from 'groq-sdk';
import neo4j from 'neo4j-driver';
import { runQuery } from '../graph/queries';
import { CYPHER_GENERATION_PROMPT, ANSWER_SYNTHESIS_PROMPT } from './prompts';

const MODEL = 'llama-3.3-70b-versatile';

function getClient(): Groq {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set — add it to apps/api/.env');
  }
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CitedSource {
  type: string;
  id: string;
  label: string;
  url?: string;
}

export interface AgentResult {
  answer: string;
  cypherQuery: string;
  rawData: Record<string, unknown>[];
  sources: CitedSource[];
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:cypher)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function generateCypher(question: string, orgId: string, errorContext = ''): Promise<string> {
  const userContent = errorContext
    ? `OrgId: ${orgId}\nQuestion: ${question}\nPrevious query failed with: ${errorContext}\nGenerate a corrected Cypher query:`
    : `OrgId: ${orgId}\nQuestion: ${question}\nGenerate Cypher:`;

  const res = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: CYPHER_GENERATION_PROMPT },
      { role: 'user', content: userContent },
    ],
  });

  return stripCodeFences(res.choices[0]?.message?.content ?? '');
}

// Maps a flat-record key name to a graph node label
const KEY_TO_TYPE: Record<string, string> = {
  incident: 'Incident', title: 'Incident',
  deployment: 'Deployment', version: 'Deployment',
  pullrequest: 'PullRequest', pr: 'PullRequest',
  engineer: 'Engineer', author: 'Engineer', name: 'Engineer',
  bug: 'Bug', jiraid: 'Bug',
  alert: 'Alert', metric: 'Alert',
  service: 'Service',
};

function extractSources(records: Record<string, unknown>[]): CitedSource[] {
  const seen = new Set<string>();
  const sources: CitedSource[] = [];

  function addSource(type: string, id: string, label: string, url?: string) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    sources.push({ type, id, label, url });
  }

  function walk(value: unknown) {
    if (neo4j.isNode(value as any)) {
      const node = value as any;
      const props = node.properties as Record<string, any>;
      const id: string = props.id;
      addSource(
        node.labels[0] ?? 'Unknown',
        id,
        props.title ?? props.name ?? props.metric ?? props.version ?? props.jiraId ?? id,
        props.url ?? props.repoUrl ?? undefined
      );
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value !== null && typeof value === 'object') {
      Object.values(value as object).forEach(walk);
    }
  }

  for (const record of records) {
    Object.values(record).forEach(walk);
  }

  // Second pass: flat-property records (AI returned scalar fields, not full nodes)
  if (sources.length === 0) {
    for (const record of records) {
      const flat = record as Record<string, any>;
      // Collect candidate id/label fields by their key name
      const id = flat.id ?? flat.incidentId ?? flat.deploymentId ?? flat.prId ?? flat.bugId ?? flat.alertId ?? flat.serviceId;
      const label = flat.title ?? flat.name ?? flat.version ?? flat.metric ?? flat.jiraId ?? id;
      const url = flat.url ?? flat.repoUrl;

      if (id && typeof id === 'string') {
        // Infer type from which id-like field was set
        let type = 'Unknown';
        if (flat.incidentId || flat.severity || flat.startedAt) type = 'Incident';
        else if (flat.version || flat.deployedAt || flat.environment) type = 'Deployment';
        else if (flat.githubId || flat.branch || flat.mergedAt) type = 'PullRequest';
        else if (flat.jiraId || flat.priority) type = 'Bug';
        else if (flat.metric || flat.firedAt) type = 'Alert';
        else if (flat.githubLogin || flat.email) type = 'Engineer';
        addSource(type, id, typeof label === 'string' ? label : id, url);
      } else {
        // Last resort: look for string values that match namespaced ID patterns (e.g. "jira:INC-100")
        for (const [key, val] of Object.entries(flat)) {
          if (typeof val === 'string' && /^[a-z]+:[A-Z]/.test(val) && !seen.has(val)) {
            const keyLow = key.toLowerCase().replace(/[_\s]/g, '');
            const type = KEY_TO_TYPE[keyLow] ?? 'Unknown';
            addSource(type, val, val);
          }
        }
      }
    }
  }

  return sources.slice(0, 10);
}

async function synthesizeAnswer(
  question: string,
  graphData: Record<string, unknown>[],
  history: ConversationMessage[]
): Promise<string> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    {
      role: 'user',
      content: `Question: ${question}\n\nGraph query results (${graphData.length} records):\n${JSON.stringify(graphData, null, 2)}`,
    },
  ];

  const res = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      { role: 'system', content: ANSWER_SYNTHESIS_PROMPT },
      ...messages,
    ],
  });

  return res.choices[0]?.message?.content ?? 'Unable to generate answer.';
}

export async function runIncidentAgent(
  question: string,
  orgId: string,
  history: ConversationMessage[] = []
): Promise<AgentResult> {
  let cypher = await generateCypher(question, orgId);
  let graphData: Record<string, unknown>[] = [];
  let queryFailed = false;

  try {
    graphData = await runQuery(cypher, { orgId });
  } catch (firstErr: any) {
    try {
      cypher = await generateCypher(question, orgId, firstErr.message);
      graphData = await runQuery(cypher, { orgId });
    } catch (secondErr: any) {
      console.error('Cypher execution failed twice:', secondErr.message);
      queryFailed = true;
    }
  }

  const sources = queryFailed ? [] : extractSources(graphData);
  const answer = await synthesizeAnswer(question, graphData, history);

  return { answer, cypherQuery: cypher, rawData: graphData, sources };
}
