import { getGroqClient } from './groq-client';

const MODEL = 'llama-3.3-70b-versatile';

function buildSystemPrompt(tool: string): string {
  return `You summarize ${tool} monitoring scan results for an engineering team.
Be specific about what needs attention and what to fix first.
Prioritize by severity: critical > high > medium > low.
Never invent data not present in the issues list. If the list is empty, say everything is healthy.
Keep it to one tight paragraph, 3-6 sentences.`;
}

// Shared summary generator for the 5 non-GitHub deep-scan workers (GitHub's own
// worker keeps its existing inline buildSummary — this is for jira/slack/pagerduty/linear/datadog).
export async function buildScanSummary(tool: string, issues: unknown[]): Promise<string> {
  if (issues.length === 0) {
    return `${tool[0].toUpperCase()}${tool.slice(1)} is healthy — no issues detected in this scan.`;
  }
  try {
    const groq = getGroqClient();
    const res = await groq.chat.completions.create({
      model: MODEL,
      max_tokens: 512,
      messages: [
        { role: 'system', content: buildSystemPrompt(tool) },
        {
          role: 'user',
          content: `Summarize these ${tool} scan results for an engineering team:\n${JSON.stringify(issues)}`,
        },
      ],
    });
    return res.choices[0]?.message?.content ?? 'Summary unavailable.';
  } catch (err: any) {
    console.warn(`[ScanSummary] ${tool} summary generation failed:`, err.message);
    return 'Summary unavailable — the AI summarizer could not be reached, but the issues list above is complete.';
  }
}
