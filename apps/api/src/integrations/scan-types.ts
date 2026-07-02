import { upsertNode, getIssueFixSuggestion } from '../graph/queries';
import { generateFixSuggestion } from '../ai/fix-suggestion';

export type ScanSeverity = 'critical' | 'high' | 'medium' | 'low';
export type ScanTool = 'jira' | 'slack' | 'pagerduty' | 'linear' | 'datadog';

export interface ScanIssueInput {
  id: string;
  orgId: string;
  source: ScanTool;
  type: string;
  severity: ScanSeverity;
  title: string;
  description: string;
  url: string;
  detectedAt?: string;
  /** Provide when the caller already has a hardcoded fixSuggestion template for this issue type. */
  fixSuggestion?: string;
}

export interface ScanIssue extends Required<Omit<ScanIssueInput, 'fixSuggestion'>> {
  fixSuggestion: string;
  status: 'open';
}

export interface ScanResult {
  itemsScanned: number;
  issuesFound: ScanIssue[];
  criticalCount: number;
  highCount: number;
  rawStats: Record<string, unknown>;
}

// Writes the Issue node and resolves fixSuggestion: uses the caller's hardcoded template if
// given, otherwise reuses a cached suggestion from a prior scan of the same issue id, otherwise
// falls back to generateFixSuggestion(). Never regenerates for an issue that already has one.
export async function recordIssue(input: ScanIssueInput): Promise<ScanIssue> {
  let fixSuggestion = input.fixSuggestion;
  if (!fixSuggestion) {
    fixSuggestion = (await getIssueFixSuggestion(input.id, input.orgId)) ?? undefined;
  }
  if (!fixSuggestion) {
    fixSuggestion = await generateFixSuggestion({
      source: input.source,
      type: input.type,
      title: input.title,
      description: input.description,
      severity: input.severity,
    });
  }

  const detectedAt = input.detectedAt ?? new Date().toISOString();

  await upsertNode('Issue', input.id, input.orgId, {
    source: input.source,
    type: input.type,
    severity: input.severity,
    title: input.title,
    description: input.description,
    fixSuggestion,
    detectedAt,
    status: 'open',
    url: input.url,
  });

  return {
    id: input.id,
    orgId: input.orgId,
    source: input.source,
    type: input.type,
    severity: input.severity,
    title: input.title,
    description: input.description,
    fixSuggestion,
    detectedAt,
    status: 'open',
    url: input.url,
  };
}

export function summarizeIssues(issuesFound: ScanIssue[], itemsScanned: number, rawStats: Record<string, unknown> = {}): ScanResult {
  return {
    itemsScanned,
    issuesFound,
    criticalCount: issuesFound.filter(i => i.severity === 'critical').length,
    highCount: issuesFound.filter(i => i.severity === 'high').length,
    rawStats,
  };
}
