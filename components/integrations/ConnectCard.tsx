'use client';

import { useState } from 'react';
import { GitBranch, CheckCircle2 } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Props {
  provider: 'github' | 'jira' | 'datadog';
  connected: boolean;
  lastSyncedAt: string | null;
}

const META = {
  github: { label: 'GitHub', desc: 'Repos, PRs, Deployments, Engineers', dot: 'bg-foreground' },
  jira: { label: 'Jira', desc: 'Bugs, Incidents, Assignees', dot: 'bg-blue-500' },
  datadog: { label: 'Datadog', desc: 'Monitors, Alerts', dot: 'bg-purple-500' },
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
      if (!data.url) throw new Error('No OAuth URL returned from server');
      // Full page navigation to provider OAuth — browser will return via callback
      window.location.assign(data.url);
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
    <Card>
      <CardContent className="py-5 flex flex-col gap-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${meta.dot}`} />
              <span className="font-semibold text-foreground">{meta.label}</span>
            </div>
            <p className="text-sm text-muted-foreground">{meta.desc}</p>
          </div>
          {connected && (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3" />
              Connected
            </Badge>
          )}
        </div>

        {lastSyncedAt && (
          <p className="text-xs text-muted-foreground">
            Last synced {new Date(lastSyncedAt).toLocaleString()}
          </p>
        )}

        {provider === 'datadog' && !connected ? (
          <form onSubmit={connectDatadog} className="flex flex-col gap-2">
            <Input
              required value={ddKey} onChange={e => setDdKey(e.target.value)}
              placeholder="API Key (DD-API-KEY)"
            />
            <Input
              required value={ddAppKey} onChange={e => setDdAppKey(e.target.value)}
              placeholder="Application Key"
            />
            <Input
              value={ddSite} onChange={e => setDdSite(e.target.value)}
              placeholder="Site (e.g. datadoghq.com)"
            />
            {ddError && <p className="text-xs text-destructive">{ddError}</p>}
            <Button type="submit" disabled={loading}>
              {loading ? 'Connecting…' : 'Connect Datadog'}
            </Button>
          </form>
        ) : !connected ? (
          <>
            {oauthError && (
              <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                {oauthError}
              </p>
            )}
            <Button onClick={connectOAuth} disabled={loading}>
              {provider === 'github' && <GitBranch />}
              {loading ? 'Redirecting…' : `Connect ${meta.label}`}
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
