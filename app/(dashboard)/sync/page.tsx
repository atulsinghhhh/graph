'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

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

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-zinc-100 text-zinc-600',
  running: 'bg-blue-50 text-blue-700',
  done: 'bg-green-50 text-green-700',
  error: 'bg-red-50 text-red-700',
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
    <div className="p-8 max-w-2xl">
      <h1 className="text-xl font-semibold text-zinc-900 mb-1">Data Sync</h1>
      <p className="text-sm text-zinc-500 mb-6">Pull data from connected integrations into the graph.</p>

      <button
        onClick={startSync}
        disabled={syncing}
        className="mb-6 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition-colors"
      >
        {syncing ? 'Syncing…' : 'Start Sync'}
      </button>

      {syncError && (
        <div className="mb-5 rounded-lg px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">
          {syncError}
        </div>
      )}

      {jobs.length > 0 && (
        <div className="flex flex-col gap-3">
          {jobs.map(job => (
            <div key={job.id} className="bg-white border border-zinc-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm text-zinc-900 capitalize">{job.provider}</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[job.status]}`}>
                  {job.status}
                </span>
              </div>

              {job.status === 'running' && (
                <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-blue-500 rounded-full animate-pulse w-2/3" />
                </div>
              )}

              {job.status === 'done' && (
                <p className="text-xs text-zinc-500">{job.items_synced} items synced</p>
              )}

              {job.status === 'error' && (
                <p className="text-xs text-red-600">{job.error_message}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {allDone && (
        <button
          onClick={() => router.push('/chat')}
          className="mt-6 rounded-lg bg-green-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-600 transition-colors"
        >
          Graph ready — Ask your first question →
        </button>
      )}
    </div>
  );
}
