'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ConnectCard from '@/components/integrations/ConnectCard';
import api from '@/lib/api';

interface IntegrationStatus {
  connected: boolean;
  lastSyncedAt: string | null;
}

interface Status {
  github: IntegrationStatus;
  jira: IntegrationStatus;
  datadog: IntegrationStatus;
}

export default function IntegrationsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [banner, setBanner] = useState('');

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) setBanner(`${connected} connected successfully`);
    if (error) setBanner(`Error: ${error.replace(/_/g, ' ')}`);
  }, [searchParams]);

  useEffect(() => {
    api.get('/api/integrations/status')
      .then(r => setStatus(r.data))
      .catch(() => {});
  }, []);

  const connectedCount = status
    ? Object.values(status).filter(s => s.connected).length
    : 0;

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-xl font-semibold text-zinc-900 mb-1">Integrations</h1>
      <p className="text-sm text-zinc-500 mb-6">Connect your tools to build the incident graph.</p>

      {banner && (
        <div className={`mb-5 rounded-lg px-4 py-3 text-sm ${
          banner.startsWith('Error')
            ? 'bg-red-50 text-red-700 border border-red-200'
            : 'bg-green-50 text-green-700 border border-green-200'
        }`}>
          {banner}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {(['github', 'jira', 'datadog'] as const).map(p => (
          <ConnectCard
            key={p}
            provider={p}
            connected={status?.[p]?.connected ?? false}
            lastSyncedAt={status?.[p]?.lastSyncedAt ?? null}
          />
        ))}
      </div>

      {connectedCount >= 2 && (
        <button
          onClick={() => router.push('/sync')}
          className="mt-6 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 transition-colors"
        >
          Start sync →
        </button>
      )}
    </div>
  );
}
