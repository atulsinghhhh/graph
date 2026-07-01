'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

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

  return (
    <div className="max-w-3xl mx-auto p-8 flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-bold text-zinc-900">Team</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage who has access to this workspace.</p>
      </div>

      <div className="bg-white border border-zinc-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">Members</h2>
        <div className="flex flex-col divide-y divide-zinc-100">
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between py-2.5">
              <div>
                <p className="text-sm text-zinc-900">{m.email ?? m.userId}</p>
                <p className="text-xs text-zinc-400 capitalize">{m.role}</p>
              </div>
              {role === 'owner' && m.role !== 'owner' && (
                <button
                  onClick={() => removeMember(m.id)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-sm text-zinc-400 py-2">No members found.</p>
          )}
        </div>
      </div>

      {canManage && (
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-900 mb-3">Invite a teammate</h2>
          <form onSubmit={sendInvite} className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900"
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as 'admin' | 'member')}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-900"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              disabled={inviting}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              {inviting ? 'Sending…' : 'Send invite'}
            </button>
          </form>

          {inviteError && <p className="text-xs text-red-600 mt-2">{inviteError}</p>}

          {inviteLink && (
            <div className="mt-3 flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
              <input
                readOnly
                value={inviteLink}
                className="flex-1 bg-transparent text-xs text-zinc-600 outline-none"
              />
              <button
                onClick={copyLink}
                className="text-xs font-medium text-zinc-900 hover:underline shrink-0"
              >
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
          )}

          {invites.length > 0 && (
            <div className="mt-5">
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Pending invites</h3>
              <div className="flex flex-col divide-y divide-zinc-100">
                {invites.map(i => (
                  <div key={i.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm text-zinc-900">{i.email}</p>
                      <p className="text-xs text-zinc-400 capitalize">{i.role}</p>
                    </div>
                    <button
                      onClick={() => revokeInvite(i.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
