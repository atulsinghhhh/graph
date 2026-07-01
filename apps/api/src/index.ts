import './setup'; // must be first — loads .env before any module reads process.env
import express from 'express';
import cors from 'cors';
import { initNeo4j, closeNeo4j } from './config/neo4j';
import { initPostgres } from './config/postgres';
import { initRedis, closeRedis } from './config/redis';
import { applyNeo4jSchema } from './graph/schema';
import integrationsRouter from './routes/integrations';
import syncRouter from './routes/sync';
import incidentsRouter from './routes/incidents';
import chatRouter from './routes/chat';
import graphRouter from './routes/graph';
import secretsRouter from './routes/secrets';
import insightsRouter from './routes/insights';
import organizationsRouter from './routes/organizations';
import './workers/github.worker';
import './workers/jira.worker';
import './workers/datadog.worker';
import './workers/scheduler';
import { registerScheduler } from './workers/scheduler';

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());

// Service connection statuses — populated on startup
const serviceStatus: Record<string, string> = {
  neo4j: 'starting',
  postgres: 'starting',
  redis: 'starting',
};

app.use('/api/integrations', integrationsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/incidents', incidentsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/graph', graphRouter);
app.use('/api/secrets', secretsRouter);
app.use('/api/insights', insightsRouter);
app.use('/api/organizations', organizationsRouter);

app.get('/health', (_req, res) => {
  const allOk = Object.values(serviceStatus).every(s => s === 'connected' || s === 'not_configured');
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    services: serviceStatus,
  });
});

async function start() {
  const port = process.env.PORT || 3001;

  // Connect to all services in parallel; capture status for /health
  const [neo4j, postgres, redis] = await Promise.all([
    initNeo4j(),
    initPostgres(),
    initRedis(),
  ]);

  serviceStatus.neo4j = neo4j;
  serviceStatus.postgres = postgres;
  serviceStatus.redis = redis;

  if (serviceStatus.neo4j === 'connected') {
    await applyNeo4jSchema();
  }

  // Ensure the dev org exists so x-org-id bypass works end-to-end
  if (process.env.NODE_ENV !== 'production' && serviceStatus.postgres === 'connected') {
    try {
      const { getSupabase } = await import('./config/postgres');
      const sb = getSupabase();
      await sb.from('organizations').upsert(
        { id: '00000000-0000-0000-0000-000000000001', name: 'Dev Org', slug: 'dev-org' },
        { onConflict: 'id' }
      );
    } catch {
      // non-fatal — only needed in dev
    }
  }

  if (serviceStatus.redis === 'connected') {
    try {
      await registerScheduler();
    } catch (err: any) {
      console.error('Failed to register sync scheduler:', err.message);
    }
  }

  app.listen(port, () => {
    console.log(`API running on http://localhost:${port}`);
    console.log('Service status:', serviceStatus);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await Promise.all([closeNeo4j(), closeRedis()]);
  process.exit(0);
});

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

export default app;