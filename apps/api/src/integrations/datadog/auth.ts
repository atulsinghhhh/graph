import axios from 'axios';

export async function validateDatadogKeys(
  apiKey: string,
  appKey: string,
  site: string
): Promise<boolean> {
  try {
    const res = await axios.get(`https://api.${site}/api/v1/validate`, {
      headers: {
        'DD-API-KEY': apiKey,
        'DD-APPLICATION-KEY': appKey,
      },
      timeout: 8000,
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
