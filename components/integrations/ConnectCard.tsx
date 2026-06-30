'use client';

import { useState } from 'react';
import api from '@/lib/api';

interface Props {
  provider: 'github' | 'jira' | 'datadog';
  connected: boolean;
  lastSyncedAt: string | null;
}

const META = {
  github: { label: 'GitHub', desc: 'Repos, PRs, Deployments, Engineers', color: 'bg-zinc-900' },
  jira: { label: 'Jira', desc: 'Bugs, Incidents, Assignees', color: 'bg-blue-600' },
  datadog: { label: 'Datadog', desc: 'Monitors, Alerts', color: 'bg-purple-600' },
};

export default function ConnectCard({ provider, connected, lastSyncedAt }: Props) {
  const meta = META[provider];
  const [loading, setLoading] = useState(false);
  const [oauthError, setOauthError] = useState('');
  const [ddKey, setDdKey] = useState('');
  const [ddAppKey, setDdAppKey] = useState('');
  const [ddSite, setDdSite] = useState('datadoghq.com');
  const [ddError, setDdError] = useState('');

  async function connectOAuth() {
    setLoading(true);
    setOauthError('');
    try {
      const { data } = await api.get(`/api/integrations/${provider}/connect`);
      window.location.href = data.url;
    } catch (err: any) {
      setOauthError(err.response?.data?.error ?? 'Failed to start OAuth. Is the API running?');
      setLoading(false);
    }
  }

  async function connectDatadog(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setDdError('');
    try {
      await api.post('/api/integrations/datadog/connect', {
        apiKey: ddKey,
        appKey: ddAppKey,
        site: ddSite,
      });
      window.location.reload();
    } catch (err: any) {
      setDdError(err.response?.data?.error ?? 'Connection failed');
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${meta.color}`} />
            <span className="font-semibold text-zinc-900">{meta.label}</span>
          </div>
          <p className="text-sm text-zinc-500">{meta.desc}</p>
        </div>
        {connected && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            Connected
          </span>
        )}
      </div>

      {lastSyncedAt && (
        <p className="text-xs text-zinc-400">
          Last synced {new Date(lastSyncedAt).toLocaleString()}
        </p>
      )}

      {provider === 'datadog' && !connected ? (
        <form onSubmit={connectDatadog} className="flex flex-col gap-2">
          <input
            required value={ddKey} onChange={e => setDdKey(e.target.value)}
            placeholder="API Key (DD-API-KEY)"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900"
          />
          <input
            required value={ddAppKey} onChange={e => setDdAppKey(e.target.value)}
            placeholder="Application Key"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900"
          />
          <input
            value={ddSite} onChange={e => setDdSite(e.target.value)}
            placeholder="Site (e.g. datadoghq.com)"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900"
          />
          {ddError && <p className="text-xs text-red-600">{ddError}</p>}
          <button
            type="submit" disabled={loading}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Connecting…' : 'Connect Datadog'}
          </button>
        </form>
      ) : !connected ? (
        <>
          {oauthError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {oauthError}
            </p>
          )}
          <button
            onClick={connectOAuth} disabled={loading}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Redirecting…' : `Connect ${meta.label}`}
          </button>
        </>
      ) : null}
    </div>
  );
}
