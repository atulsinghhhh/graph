import axios from 'axios';

export function getGitHubAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: process.env.GITHUB_REDIRECT_URI!,
    scope: 'repo read:org read:user',
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeGitHubCode(code: string): Promise<string> {
  const res = await axios.post(
    'https://github.com/login/oauth/access_token',
    {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.GITHUB_REDIRECT_URI,
    },
    { headers: { Accept: 'application/json' } }
  );

  if (res.data.error) {
    throw new Error(res.data.error_description || res.data.error);
  }
  return res.data.access_token as string;
}

export async function getGitHubUser(accessToken: string): Promise<{
  id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
}> {
  const res = await axios.get('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    },
  });
  return res.data;
}
