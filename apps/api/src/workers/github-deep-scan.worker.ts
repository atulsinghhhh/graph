import Queue from 'bull';
import { getSupabase } from '../config/postgres';
import { runDeepScan } from '../integrations/github/deep-scan';
import { getGroqClient } from '../ai/groq-client';
import { GITHUB_SUMMARY_SYSTEM_PROMPT, buildGithubSummaryUserPrompt } from '../ai/prompts';

export const githubDeepScanQueue = new Queue('github-deep-scan', process.env.REDIS_URL!);

async function buildSummary(issues: unknown[]): Promise<string> {
  if (issues.length === 0) {
    return 'All scanned repositories are healthy — no CI failures, exposed secrets, PR issues, or repo security gaps detected in this scan.';
  }
  try {
    const groq = getGroqClient();
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 512,
      messages: [
        { role: 'system', content: GITHUB_SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: buildGithubSummaryUserPrompt(issues) },
      ],
    });
    return res.choices[0]?.message?.content ?? 'Summary unavailable.';
  } catch (err: any) {
    console.warn('[GithubDeepScan] summary generation failed:', err.message);
    return 'Summary unavailable — the AI summarizer could not be reached, but the issues list above is complete.';
  }
}

githubDeepScanQueue.process(async () => {
  const supabase = getSupabase();

  const { data: integrations } = await supabase
    .from('integrations')
    .select('id, org_id, access_token')
    .eq('provider', 'github')
    .eq('status', 'connected');

  for (const integ of integrations ?? []) {
    if (!integ.access_token) continue;

    try {
      const scan = await runDeepScan(integ.org_id, integ.access_token);
      const summaryText = await buildSummary(scan.issuesFound);

      await supabase.from('github_hourly_reports').insert({
        org_id: integ.org_id,
        repos_scanned: scan.reposScanned,
        issues_found: scan.issuesFound,
        secrets_found: scan.secretsFound,
        ci_failures: scan.ciFailures,
        pr_issues: scan.prIssues,
        repo_health: scan.repoHealth,
        summary_text: summaryText,
      });
    } catch (err: any) {
      console.error(`[GithubDeepScan] scan failed for org ${integ.org_id}:`, err.message);
    }
  }
});

export async function registerGithubDeepScanScheduler(): Promise<void> {
  const existing = await githubDeepScanQueue.getRepeatableJobs();
  if (existing.length === 0) {
    await githubDeepScanQueue.add({}, { repeat: { cron: '0 * * * *' }, jobId: 'github-deep-scan-hourly' });
  }
}
