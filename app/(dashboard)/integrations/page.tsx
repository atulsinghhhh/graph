'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';
import ConnectCard, { type Provider, type ConnectionStatus } from '@/components/integrations/ConnectCard';
import api from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const PROVIDERS: Provider[] = ['github', 'jira', 'datadog', 'slack', 'pagerduty', 'linear'];

interface StatusEntry {
  status: ConnectionStatus;
  connected: boolean;
  lastSyncedAt: string | null;
  syncCounts: Record<string, number>;
}

type Status = Record<Provider, StatusEntry>;

export default function IntegrationsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);

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
      toast.success(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected. Starting first sync…`);
      fetchStatus();
    }
    if (error) {
      toast.error(`Connection failed: ${error.replace(/_/g, ' ')}`);
    }
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
    <div className="p-8 max-w-4xl flex flex-col gap-6">
      <PageHeader
        title="Integrations"
        description="Connect your tools once. Your whole team shares the connection."
        actions={
          <Badge variant="outline" className="text-sm px-3 py-1">
            Connected: {connectedCount}/6
          </Badge>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PROVIDERS.map(p => (
          <ConnectCard
            key={p}
            provider={p}
            status={status?.[p]?.status ?? 'not_connected'}
            lastSyncedAt={status?.[p]?.lastSyncedAt ?? null}
            syncCounts={status?.[p]?.syncCounts ?? {}}
            onChanged={fetchStatus}
          />
        ))}
      </div>

      {connectedCount >= 2 && (
        <Button onClick={() => router.push('/sync')} className="self-start">
          Start sync
          <ArrowRight />
        </Button>
      )}
    </div>
  );
}
