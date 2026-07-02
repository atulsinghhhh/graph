'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, ArrowRight } from 'lucide-react';
import api from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface SyncJob {
  id: string;
  provider: string;
  status: 'pending' | 'running' | 'done' | 'error';
  items_synced: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

const STATUS_VARIANT: Record<string, 'secondary' | 'success' | 'destructive' | 'default'> = {
  pending: 'secondary',
  running: 'default',
  done: 'success',
  error: 'destructive',
};

export default function SyncPage() {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [syncError, setSyncError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function fetchStatus() {
    try {
      const { data } = await api.get<SyncJob[]>('/api/sync/status');
      setJobs(data);
      const active = data.filter(j => j.status === 'pending' || j.status === 'running');
      const done = data.length > 0 && active.length === 0;
      if (done) {
        setSyncing(false);
        setAllDone(data.every(j => j.status === 'done'));
        stopPolling();
      }
    } catch {}
  }

  async function startSync() {
    setSyncing(true);
    setAllDone(false);
    setSyncError('');
    try {
      await api.post('/api/sync/start');
      pollRef.current = setInterval(fetchStatus, 2000);
    } catch (err: any) {
      setSyncError(err.response?.data?.error ?? 'Sync failed. Is the API running?');
      setSyncing(false);
    }
  }

  useEffect(() => {
    fetchStatus();
    return stopPolling;
  }, []);

  return (
    <div className="p-8 max-w-4xl flex flex-col gap-6">
      <PageHeader
        title="Data Sync"
        description="Pull data from connected integrations into the graph."
        actions={
          <Button onClick={startSync} disabled={syncing}>
            <RefreshCw className={cn('size-4', syncing && 'animate-spin')} />
            {syncing ? 'Syncing…' : 'Start Sync'}
          </Button>
        }
      />

      {syncError && (
        <div className="rounded-lg px-4 py-3 text-sm bg-destructive/10 text-destructive border border-destructive/30">
          {syncError}
        </div>
      )}

      {jobs.length > 0 ? (
        <div className="flex flex-col gap-3">
          {jobs.map(job => (
            <Card key={job.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm text-foreground capitalize">{job.provider}</span>
                  <Badge variant={STATUS_VARIANT[job.status] ?? 'secondary'} className="capitalize">
                    {job.status}
                  </Badge>
                </div>

                {job.status === 'running' && (
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-2">
                    <div className="h-full bg-primary rounded-full animate-pulse w-2/3" />
                  </div>
                )}

                {job.status === 'done' && (
                  <p className="text-xs text-muted-foreground">{job.items_synced} items synced</p>
                )}

                {job.status === 'error' && (
                  <p className="text-xs text-destructive">{job.error_message}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 border border-dashed border-border rounded-xl text-muted-foreground text-sm">
          <p>No sync jobs yet. Hit “Start Sync” to pull data from your connected tools.</p>
        </div>
      )}

      {allDone && (
        <Button onClick={() => router.push('/chat')} variant="default" className="self-start bg-success text-white hover:bg-success/90">
          Graph ready — ask your first question
          <ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  );
}
