import { getGroqClient } from './groq-client';

const MODEL = 'llama-3.3-70b-versatile';

const FIX_SUGGESTION_SYSTEM_PROMPT = `You are a senior DevOps engineer writing specific, actionable
fix instructions for engineering teams. Always write numbered steps. Always be specific — include
actual commands, URLs, or menu paths where possible. Never say "contact support". Maximum 5 steps.
Be direct.`;

export interface FixSuggestionIssue {
  source: string;
  type: string;
  title: string;
  description: string;
  severity: string;
}

// Fallback generator for issue types that don't have a hardcoded fixSuggestion template.
// Callers must check for an existing cached fixSuggestion first (getIssueFixSuggestion) —
// this is never called for an issue that already has one, so re-scans don't regenerate it.
export async function generateFixSuggestion(issue: FixSuggestionIssue): Promise<string> {
  try {
    const groq = getGroqClient();
    const res = await groq.chat.completions.create({
      model: MODEL,
      max_tokens: 400,
      messages: [
        { role: 'system', content: FIX_SUGGESTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Write fix steps for this issue:
Tool: ${issue.source}
Type: ${issue.type}
Title: ${issue.title}
Description: ${issue.description}
Severity: ${issue.severity}`,
        },
      ],
    });
    return res.choices[0]?.message?.content ?? 'Investigate and resolve this issue manually.';
  } catch (err: any) {
    console.warn('[FixSuggestion] generation failed:', err.message);
    return 'Investigate and resolve this issue manually — the AI fix generator could not be reached.';
  }
}
