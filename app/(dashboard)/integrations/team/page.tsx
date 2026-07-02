'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import api from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface Member {
  id: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  email: string | null;
  createdAt: string;
}

interface Invite {
  id: string;
  email: string;
  role: 'admin' | 'member';
  status: string;
  created_at: string;
  expires_at: string;
}

export default function TeamPage() {
  const [role, setRole] = useState<'owner' | 'admin' | 'member' | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviteLink, setInviteLink] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [copied, setCopied] = useState(false);

  const canManage = role === 'owner' || role === 'admin';

  async function loadAll() {
    const [meRes, membersRes] = await Promise.all([
      api.get('/api/organizations/me'),
      api.get('/api/organizations/members'),
    ]);
    setRole(meRes.data.role);
    setMembers(membersRes.data);

    if (meRes.data.role === 'owner' || meRes.data.role === 'admin') {
      const invitesRes = await api.get('/api/organizations/invites');
      setInvites(invitesRes.data);
    }
  }

  useEffect(() => {
    loadAll().catch(() => {});
  }, []);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError('');
    setInviteLink('');
    setCopied(false);
    try {
      const { data } = await api.post('/api/organizations/invite', {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInviteLink(data.inviteLink);
      setInviteEmail('');
      await loadAll();
    } catch (err: any) {
      setInviteError(err?.response?.data?.error ?? 'Failed to create invite');
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvite(id: string) {
    await api.post(`/api/organizations/invite/${id}/revoke`);
    setInvites(prev => prev.filter(i => i.id !== id));
  }

  async function removeMember(id: string) {
    await api.delete(`/api/organizations/members/${id}`);
    setMembers(prev => prev.filter(m => m.id !== id));
  }

  function copyLink() {
    navigator.clipboard.writeText(inviteLink).then(() => setCopied(true));
  }

  function initialFor(m: Member) {
    return (m.email ?? m.userId).charAt(0).toUpperCase();
  }

  return (
    <div className="p-8 max-w-4xl flex flex-col gap-6">
      <PageHeader title="Team" description="Manage who has access to this workspace." />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Members</CardTitle>
        </CardHeader>
        <CardContent className="pb-5">
          <div className="flex flex-col divide-y divide-border">
            {members.map(m => (
              <div key={m.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="size-8">
                    <AvatarFallback>{initialFor(m)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{m.email ?? m.userId}</p>
                    <p className="text-xs text-muted-foreground capitalize">{m.role}</p>
                  </div>
                </div>
                {role === 'owner' && m.role !== 'owner' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeMember(m.id)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
            {members.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">No members found.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Invite a teammate</CardTitle>
          </CardHeader>
          <CardContent className="pb-5">
            <form onSubmit={sendInvite} className="flex flex-col sm:flex-row gap-2">
              <Input
                type="email"
                required
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="flex-1"
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as 'admin' | 'member')}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <Button type="submit" disabled={inviting}>
                {inviting ? 'Sending…' : 'Send invite'}
              </Button>
            </form>

            {inviteError && <p className="text-xs text-destructive mt-2">{inviteError}</p>}

            {inviteLink && (
              <div className="mt-3 flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2">
                <input
                  readOnly
                  value={inviteLink}
                  className="flex-1 bg-transparent text-xs text-muted-foreground outline-none"
                />
                <Button variant="ghost" size="sm" onClick={copyLink} className="shrink-0 gap-1.5">
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? 'Copied!' : 'Copy link'}
                </Button>
              </div>
            )}

            {invites.length > 0 && (
              <div className="mt-5">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pending invites</h3>
                <div className="flex flex-col divide-y divide-border">
                  {invites.map(i => (
                    <div key={i.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="text-sm text-foreground">{i.email}</p>
                        <p className="text-xs text-muted-foreground capitalize">{i.role}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => revokeInvite(i.id)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        Revoke
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
