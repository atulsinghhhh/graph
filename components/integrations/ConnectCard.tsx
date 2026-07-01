'use client';

import { useState } from 'react';
import {
  GitBranch, Kanban, Activity, MessageCircle, BellRing, CircleDot,
  CheckCircle2, Loader2, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export type Provider = 'github' | 'jira' | 'datadog' | 'slack' | 'pagerduty' | 'linear';
export type ConnectionStatus = 'not_connected' | 'connecting' | 'connected' | 'error' | 'disconnected';

interface Props {
  provider: Provider;
  status: ConnectionStatus;
  lastSyncedAt: string | null;
  syncCounts: Record<string, number>;
  onChanged: () => void;
}

const META: Record<Provider, {
  label: string;
  desc: string;
  accent: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  auth: 'oauth' | 'apikey';
}> = {
  github: { label: 'GitHub', desc: 'Repos, pull requests, deployments, and CI/CD workflows', accent: '#1a1a18', icon: GitBranch, auth: 'oauth' },
  jira: { label: 'Jira', desc: 'Bugs, incidents, sprints, and issue tracking', accent: '#0052CC', icon: Kanban, auth: 'oauth' },
  datadog: { label: 'Datadog', desc: 'Alerts, monitors, metrics, and infrastructure events', accent: '#632CA6', icon: Activity, auth: 'apikey' },
  slack: { label: 'Slack', desc: 'Team messages, incident channels, and alert notifications', accent: '#4A154B', icon: MessageCircle, auth: 'oauth' },
  pagerduty: { label: 'PagerDuty', desc: 'On-call schedules, escalation policies, and incident response', accent: '#06AC38', icon: BellRing, auth: 'apikey' },
  linear: { label: 'Linear', desc: 'Issues, projects, cycles, and engineering roadmap', accent: '#5E6AD2', icon: CircleDot, auth: 'oauth' },
};

function formatSyncCounts(provider: Provider, counts: Record<string, number>): string | null {
  const parts: string[] = [];
  switch (provider) {
    case 'github':
      if (counts.repos != null) parts.push(`${counts.repos} repos`);
      if (counts.prs != null) parts.push(`${counts.prs} PRs`);
      if (counts.deployments != null) parts.push(`${counts.deployments} deployments`);
      break;
    case 'jira':
      if (counts.projects != null) parts.push(`${counts.projects} projects`);
      if (counts.issues != null) parts.push(`${counts.issues} issues synced`);
      break;
    case 'datadog':
      if (counts.monitors != null) parts.push(`${counts.monitors} monitors`);
      if (counts.alerts != null) parts.push(`${counts.alerts} alerts in last 30 days`);
      break;
    case 'slack':
      if (counts.channels != null) parts.push(`${counts.channels} channels monitored`);
      parts.push('Alerts enabled');
      break;
    case 'pagerduty':
      if (counts.services != null) parts.push(`${counts.services} services`);
      if (counts.onCallSchedules != null) parts.push(`${counts.onCallSchedules} on-call schedules`);
      break;
    case 'linear':
      if (counts.issues != null) parts.push(`${counts.issues} issues`);
      break;
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export default function ConnectCard({ provider, status, lastSyncedAt, syncCounts, onChanged }: Props) {
  const meta = META[provider];
  const Icon = meta.icon;
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [oauthError, setOauthError] = useState('');

  const [ddKey, setDdKey] = useState('');
  const [ddAppKey, setDdAppKey] = useState('');
  const [ddSite, setDdSite] = useState('datadoghq.com');
  const [ddError, setDdError] = useState('');

  const [pdKey, setPdKey] = useState('');
  const [pdError, setPdError] = useState('');

  const effectiveStatus: ConnectionStatus = connecting ? 'connecting' : status;
  const isConnected = effectiveStatus === 'connected';

  async function connectOAuth() {
    setConnecting(true);
    setOauthError('');
    try {
      const { data } = await api.get(`/api/integrations/${provider}/connect`);
      if (!data.url) throw new Error('No OAuth URL returned from server');
      window.location.assign(data.url);
    } catch (err: any) {
      setOauthError(err.response?.data?.error ?? 'Failed to start OAuth. Is the API running?');
      setConnecting(false);
    }
  }

  async function connectDatadog(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setDdError('');
    try {
      await api.post('/api/integrations/datadog/connect', { apiKey: ddKey, appKey: ddAppKey, site: ddSite });
      toast.success('Datadog connected. Starting first sync…');
      onChanged();
    } catch (err: any) {
      setDdError(err.response?.data?.error ?? 'Invalid API key. Check your Datadog account settings.');
    } finally {
      setConnecting(false);
    }
  }

  async function connectPagerDuty(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setPdError('');
    try {
      await api.post('/api/integrations/pagerduty/connect', { apiKey: pdKey });
      toast.success('PagerDuty connected. Starting first sync…');
      onChanged();
    } catch (err: any) {
      setPdError(err.response?.data?.error ?? 'Invalid API key. Check your PagerDuty account settings.');
    } finally {
      setConnecting(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      await api.post('/api/sync/start');
      toast.success(`Syncing ${meta.label}…`);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Sync failed to start');
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    try {
      await api.post(`/api/integrations/${provider}/disconnect`);
      toast.success(`${meta.label} disconnected`);
      onChanged();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to disconnect');
    }
  }

  const syncedLine = isConnected ? formatSyncCounts(provider, syncCounts) : null;

  return (
    <Card
      className="border-l-4 overflow-hidden"
      style={{
        borderLeftColor:
          effectiveStatus === 'error' ? 'var(--destructive)'
          : effectiveStatus === 'connecting' ? 'var(--warning)'
          : isConnected ? meta.accent
          : 'var(--border)',
      }}
    >
      <CardContent className="py-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="flex items-center justify-center size-9 rounded-lg shrink-0"
              style={{ backgroundColor: `${meta.accent}1a` }}
            >
              <Icon className="size-4" style={{ color: meta.accent }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-[16px] text-foreground">{meta.label}</span>
                {provider === 'github' && (
                  <Badge variant="warning" className="text-[10px] px-1.5 py-0">Hourly</Badge>
                )}
              </div>
              <p className="text-[13px] text-muted-foreground mt-0.5">{meta.desc}</p>
            </div>
          </div>

          {effectiveStatus === 'connected' && (
            <Badge variant="success" className="gap-1 shrink-0">
              <CheckCircle2 className="size-3" />
              Connected
            </Badge>
          )}
          {effectiveStatus === 'connecting' && (
            <Badge variant="warning" className="gap-1 shrink-0">
              <Loader2 className="size-3 animate-spin" />
              Connecting
            </Badge>
          )}
          {effectiveStatus === 'error' && (
            <Badge variant="destructive" className="gap-1 shrink-0">
              <AlertTriangle className="size-3" />
              Error
            </Badge>
          )}
          {(effectiveStatus === 'not_connected' || effectiveStatus === 'disconnected') && (
            <Badge variant="secondary" className="shrink-0">Not connected</Badge>
          )}
        </div>

        {isConnected && lastSyncedAt && (
          <p className="text-xs text-muted-foreground -mt-2">
            Last synced {new Date(lastSyncedAt).toLocaleString()}
          </p>
        )}
        {isConnected && syncedLine && (
          <p className="text-xs text-muted-foreground -mt-2">{syncedLine}</p>
        )}
        {effectiveStatus === 'error' && (
          <p className="text-xs text-destructive -mt-2">
            Connection needs attention — try reconnecting.
          </p>
        )}
        {provider === 'slack' && isConnected && (
          <p className="text-xs text-muted-foreground -mt-2">Incident alerts sent to #incidents channel</p>
        )}
        {provider === 'pagerduty' && (
          <p className="text-xs text-muted-foreground -mt-2">
            We read PagerDuty data. We never page anyone on your behalf.
          </p>
        )}

        {isConnected ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={syncNow} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        ) : provider === 'datadog' ? (
          <form onSubmit={connectDatadog} className="flex flex-col gap-2">
            <Input required value={ddKey} onChange={e => setDdKey(e.target.value)} placeholder="API Key (DD-API-KEY)" />
            <Input required value={ddAppKey} onChange={e => setDdAppKey(e.target.value)} placeholder="Application Key" />
            <Input value={ddSite} onChange={e => setDdSite(e.target.value)} placeholder="Site (e.g. datadoghq.com)" />
            {ddError && <p className="text-xs text-destructive">{ddError}</p>}
            <Button type="submit" disabled={connecting} className="w-full">
              {connecting ? 'Validating…' : 'Connect Datadog'}
            </Button>
          </form>
        ) : provider === 'pagerduty' ? (
          <form onSubmit={connectPagerDuty} className="flex flex-col gap-2">
            <Input required type="password" value={pdKey} onChange={e => setPdKey(e.target.value)} placeholder="PagerDuty API key" />
            {pdError && <p className="text-xs text-destructive">{pdError}</p>}
            <Button type="submit" disabled={connecting} className="w-full">
              {connecting ? 'Validating…' : 'Connect PagerDuty'}
            </Button>
          </form>
        ) : (
          <>
            {oauthError && (
              <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                {oauthError}
              </p>
            )}
            <Button onClick={connectOAuth} disabled={connecting} variant={effectiveStatus === 'error' ? 'default' : 'outline'} className="w-full">
              {connecting ? 'Redirecting…' : effectiveStatus === 'error' ? `Reconnect ${meta.label}` : `Connect ${meta.label}`}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
