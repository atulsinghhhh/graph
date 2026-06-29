import Redis from 'ioredis';

let redis: Redis | null = null;

export async function initRedis(): Promise<'connected' | 'not_configured' | string> {
  const url = process.env.REDIS_URL;
  if (!url) return 'not_configured';

  return new Promise(resolve => {
    let settled = false;

    const client = new Redis(url, {
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      connectTimeout: 4000,
      lazyConnect: true,
      retryStrategy: () => null, // no auto-reconnect
    });

    // Capture errors before 'ready' fires — prevents unhandled rejection
    client.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        client.disconnect();
        const msg = err.message || 'ECONNREFUSED';
        resolve(`error: ${msg}`);
      }
    });

    client.on('ready', () => {
      if (!settled) {
        settled = true;
        redis = client;
        console.log('Redis connected');
        resolve('connected');
      }
    });

    client.connect().catch(() => {
      // errors are handled via the 'error' event above
    });
  });
}

export function getRedis(): Redis {
  if (!redis) throw new Error('Redis not initialized');
  return redis;
}

export async function closeRedis(): Promise<void> {
  await redis?.quit();
}
