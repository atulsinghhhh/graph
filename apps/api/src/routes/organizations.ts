import { Router, Response } from 'express';
import crypto from 'crypto';
import { getSupabase } from '../config/postgres';
import { authMiddleware, requireAuth, AuthedRequest } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

const router = Router();

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'org';
}

// ── Me ────────────────────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const supabase = getSupabase();
    const userId = req.user!.id;

    if (userId === 'dev') {
      const orgId = req.user!.orgId;
      const [{ data: org }, { count: memberCount }] = await Promise.all([
        supabase.from('organizations').select('name').eq('id', orgId).single(),
        supabase.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
      ]);
      res.json({
        hasOrg: true,
        orgId,
        orgName: org?.name ?? null,
        role: 'owner',
        memberCount: memberCount ?? 1,
        isSolo: (memberCount ?? 1) <= 1,
        pendingInvite: null,
      });
      return;
    }

    const { data: { user } } = await supabase.auth.getUser(
      (req.headers.authorization as string).slice(7)
    );
    if (!user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const { data: memberships } = await supabase
      .from('org_members')
      .select('org_id, role')
      .eq('user_id', user.id)
      .limit(1);
    const membership = memberships?.[0] ?? null;

    if (!membership) {
      let pendingInvite: { token: string; role: string; orgName: string | null } | null = null;
      if (user.email) {
        const { data: invites } = await supabase
          .from('org_invites')
          .select('token, role, organizations(name)')
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString())
          .ilike('email', user.email)
          .limit(1);
        const invite = invites?.[0] as any;
        if (invite) {
          pendingInvite = { token: invite.token, role: invite.role, orgName: invite.organizations?.name ?? null };
        }
      }
      res.json({ hasOrg: false, orgId: null, orgName: null, role: null, memberCount: 0, isSolo: true, pendingInvite });
      return;
    }

    const [{ data: org }, { count: memberCount }] = await Promise.all([
      supabase.from('organizations').select('name').eq('id', membership.org_id).single(),
      supabase.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', membership.org_id),
    ]);

    res.json({
      hasOrg: true,
      orgId: membership.org_id,
      orgName: org?.name ?? null,
      role: membership.role,
      memberCount: memberCount ?? 1,
      isSolo: (memberCount ?? 1) <= 1,
      pendingInvite: null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Create ────────────────────────────────────────────────────────────────────

router.post('/', requireAuth, async (req: AuthedRequest, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  try {
    const supabase = getSupabase();
    const userId = req.user!.id;

    const { data: existing } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', userId)
      .limit(1);

    if (existing && existing.length > 0) {
      res.status(409).json({ error: 'You already belong to an organisation', orgId: existing[0].org_id });
      return;
    }

    const slug = `${slugify(name)}-${crypto.randomBytes(3).toString('hex')}`;

    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({ name: name.trim(), slug })
      .select('id, name')
      .single();

    if (orgErr || !org) {
      res.status(500).json({ error: orgErr?.message ?? 'Failed to create organisation' });
      return;
    }

    const { error: memberErr } = await supabase
      .from('org_members')
      .insert({ org_id: org.id, user_id: userId, role: 'owner' });

    if (memberErr) {
      await supabase.from('organizations').delete().eq('id', org.id);
      res.status(500).json({ error: memberErr.message });
      return;
    }

    res.status(201).json({ orgId: org.id, orgName: org.name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Invites ───────────────────────────────────────────────────────────────────

router.post('/invite', authMiddleware as any, requireRole('owner', 'admin'), async (req: AuthedRequest, res: Response) => {
  const { email, role } = req.body as { email?: string; role?: string };
  if (!email?.trim()) {
    res.status(400).json({ error: 'email is required' });
    return;
  }
  if (role !== 'admin' && role !== 'member') {
    res.status(400).json({ error: "role must be 'admin' or 'member'" });
    return;
  }

  try {
    const supabase = getSupabase();
    const orgId = req.user!.orgId;
    const token = crypto.randomBytes(32).toString('hex');

    const { error } = await supabase.from('org_invites').insert({
      org_id: orgId,
      email: email.trim(),
      role,
      token,
      invited_by: req.user!.id,
    });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    // TODO: send this link via a transactional email provider once one is configured.
    // For now the owner/admin shares it manually from the /integrations/team page.
    res.status(201).json({ inviteLink: `${frontendUrl}/join?token=${token}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/invites', authMiddleware as any, requireRole('owner', 'admin'), async (req: AuthedRequest, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('org_invites')
      .select('id, email, role, status, created_at, expires_at')
      .eq('org_id', req.user!.orgId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    res.json(data ?? []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/invite/:id/revoke', authMiddleware as any, requireRole('owner', 'admin'), async (req: AuthedRequest, res: Response) => {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('org_invites')
      .update({ status: 'revoked' })
      .eq('id', req.params.id)
      .eq('org_id', req.user!.orgId);

    if (error) throw new Error(error.message);
    res.json({ revoked: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/invite/accept', requireAuth, async (req: AuthedRequest, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token) {
    res.status(400).json({ error: 'token is required' });
    return;
  }

  try {
    const supabase = getSupabase();
    const userId = req.user!.id;

    const { data: { user } } = await supabase.auth.getUser(
      (req.headers.authorization as string).slice(7)
    );
    if (!user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const { data: invite } = await supabase
      .from('org_invites')
      .select('id, org_id, email, role, status, expires_at')
      .eq('token', token)
      .single();

    if (!invite) {
      res.status(404).json({ error: 'invalid_invite', message: 'This invite is invalid or has already been used.' });
      return;
    }
    if (invite.status === 'revoked') {
      res.status(410).json({ error: 'revoked_invite', message: 'This invite has been revoked.' });
      return;
    }
    if (invite.status === 'accepted') {
      res.status(410).json({ error: 'already_accepted', message: 'This invite has already been used.' });
      return;
    }
    if (new Date(invite.expires_at) < new Date()) {
      res.status(410).json({ error: 'expired_invite', message: 'This invite has expired.' });
      return;
    }
    if (invite.email.toLowerCase() !== (user.email ?? '').toLowerCase()) {
      res.status(403).json({ error: 'email_mismatch', message: 'This invite is for a different email address.' });
      return;
    }

    const { error: memberErr } = await supabase
      .from('org_members')
      .upsert({ org_id: invite.org_id, user_id: userId, role: invite.role }, { onConflict: 'org_id,user_id' });

    if (memberErr) {
      res.status(500).json({ error: memberErr.message });
      return;
    }

    await supabase.from('org_invites').update({ status: 'accepted' }).eq('id', invite.id);

    res.json({ orgId: invite.org_id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Members ───────────────────────────────────────────────────────────────────

router.get('/members', authMiddleware as any, async (req: AuthedRequest, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data: members, error } = await supabase
      .from('org_members')
      .select('id, user_id, role, created_at')
      .eq('org_id', req.user!.orgId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);

    const enriched = await Promise.all(
      (members ?? []).map(async m => {
        let email: string | null = null;
        try {
          const { data } = await supabase.auth.admin.getUserById(m.user_id);
          email = data.user?.email ?? null;
        } catch {
          // non-fatal
        }
        return { id: m.id, userId: m.user_id, role: m.role, createdAt: m.created_at, email };
      })
    );

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/members/:id', authMiddleware as any, requireRole('owner'), async (req: AuthedRequest, res: Response) => {
  try {
    const supabase = getSupabase();
    const orgId = req.user!.orgId;

    const { data: member } = await supabase
      .from('org_members')
      .select('user_id')
      .eq('id', req.params.id)
      .eq('org_id', orgId)
      .single();

    if (!member) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }
    if (member.user_id === req.user!.id) {
      res.status(400).json({ error: 'You cannot remove yourself.' });
      return;
    }

    const { error } = await supabase.from('org_members').delete().eq('id', req.params.id).eq('org_id', orgId);
    if (error) throw new Error(error.message);

    res.json({ removed: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
