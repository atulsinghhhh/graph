import axios from 'axios';

export async function validatePagerDutyKey(apiKey: string): Promise<boolean> {
  try {
    const res = await axios.get('https://api.pagerduty.com/services', {
      headers: {
        Authorization: `Token token=${apiKey}`,
        Accept: 'application/vnd.pagerduty+json;version=2',
      },
      params: { limit: 1 },
      timeout: 8000,
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
