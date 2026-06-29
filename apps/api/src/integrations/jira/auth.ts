import axios from 'axios';
import { getSupabase } from '../../config/postgres';

export function getJiraAuthUrl(state: string): string {
  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: process.env.JIRA_CLIENT_ID!,
    scope: 'read:jira-work read:jira-user offline_access',
    redirect_uri: process.env.JIRA_REDIRECT_URI!,
    state,
    response_type: 'code',
    prompt: 'consent',
  });
  return `https://auth.atlassian.com/authorize?${params}`;
}

export async function exchangeJiraCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const res = await axios.post('https://auth.atlassian.com/oauth/token', {
    grant_type: 'authorization_code',
    client_id: process.env.JIRA_CLIENT_ID,
    client_secret: process.env.JIRA_CLIENT_SECRET,
    code,
    redirect_uri: process.env.JIRA_REDIRECT_URI,
  });
  return res.data;
}

export async function refreshJiraToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const res = await axios.post('https://auth.atlassian.com/oauth/token', {
    grant_type: 'refresh_token',
    client_id: process.env.JIRA_CLIENT_ID,
    client_secret: process.env.JIRA_CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  return res.data;
}

export async function getValidJiraToken(integration: {
  id: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
}): Promise<string> {
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  const expiresSOon = expiresAt - Date.now() < FIVE_MINUTES_MS;

  if (!expiresSOon) {
    return integration.access_token;
  }

  if (!integration.refresh_token) {
    throw new Error('Jira token expired and no refresh_token available — reconnect Jira');
  }

  const tokens = await refreshJiraToken(integration.refresh_token);

  const supabase = getSupabase();
  await supabase
    .from('integrations')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    })
    .eq('id', integration.id);

  return tokens.access_token;
}

export async function getAccessibleSites(accessToken: string): Promise<
  Array<{ id: string; name: string; url: string }>
> {
  const res = await axios.get(
    'https://api.atlassian.com/oauth/token/accessible-resources',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return res.data;
}
