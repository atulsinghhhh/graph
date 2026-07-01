'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import ConnectCard from '@/components/integrations/ConnectCard';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [banner, setBanner] = useState('');

  function fetchStatus() {
    api.get('/api/integrations/status')
      .then(r => setStatus(r.data))
      .catch(() => {});
  }

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) {
      setBanner(`${connected} connected successfully`);
      fetchStatus(); // refresh status immediately so badge shows
    }
    if (error) setBanner(`Error: ${error.replace(/_/g, ' ')}`);
    if (connected || error) {
      window.history.replaceState({}, '', '/integrations');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, []);

  const connectedCount = status
    ? Object.values(status).filter(s => s.connected).length
    : 0;

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-xl font-semibold text-foreground mb-1">Integrations</h1>
      <p className="text-sm text-muted-foreground mb-6">Connect your tools to build the incident graph.</p>

      {banner && (
        <div className={cn(
          'mb-5 rounded-md px-4 py-3 text-sm border',
          banner.startsWith('Error')
            ? 'bg-destructive/10 text-destructive border-destructive/20'
            : 'bg-success/10 text-success border-success/20'
        )}>
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
        <Button onClick={() => router.push('/sync')} className="mt-6">
          Start sync
          <ArrowRight />
        </Button>
      )}
    </div>
  );
}
