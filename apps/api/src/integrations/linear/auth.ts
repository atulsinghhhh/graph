import axios from 'axios';

export function getLinearAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.LINEAR_CLIENT_ID!,
    redirect_uri: process.env.LINEAR_REDIRECT_URI!,
    response_type: 'code',
    scope: 'read',
    state,
  });
  return `https://linear.app/oauth/authorize?${params}`;
}

export async function exchangeLinearCode(code: string): Promise<string> {
  const res = await axios.post(
    'https://api.linear.app/oauth/token',
    new URLSearchParams({
      client_id: process.env.LINEAR_CLIENT_ID!,
      client_secret: process.env.LINEAR_CLIENT_SECRET!,
      code,
      redirect_uri: process.env.LINEAR_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  if (res.data.error) {
    throw new Error(res.data.error_description || res.data.error);
  }
  return res.data.access_token as string;
}
