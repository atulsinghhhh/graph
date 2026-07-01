import axios from 'axios';

const SLACK_SCOPES = 'channels:read,chat:write,channels:history';

export function getSlackAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID!,
    scope: SLACK_SCOPES,
    redirect_uri: process.env.SLACK_REDIRECT_URI!,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export interface SlackTokens {
  access_token: string;
  team_id: string;
  team_name: string;
  bot_user_id: string;
}

export async function exchangeSlackCode(code: string): Promise<SlackTokens> {
  const res = await axios.post(
    'https://slack.com/api/oauth.v2.access',
    new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: process.env.SLACK_REDIRECT_URI!,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  if (!res.data.ok) {
    throw new Error(res.data.error || 'Slack OAuth exchange failed');
  }

  return {
    access_token: res.data.access_token,
    team_id: res.data.team?.id,
    team_name: res.data.team?.name,
    bot_user_id: res.data.bot_user_id,
  };
}
