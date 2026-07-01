import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../config/postgres';

export type OrgRole = 'owner' | 'admin' | 'member';

export interface AuthedRequest extends Request {
  user?: { id: string; orgId: string; role?: OrgRole };
}

// Validates the caller (Bearer token or dev x-org-id bypass) without resolving
// org membership. Used by routes that must work for a user who has no org yet
// (GET /api/organizations/me, POST /api/organizations, invite/accept).
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader && req.headers['x-org-id']) {
    req.user = { id: 'dev', orgId: req.headers['x-org-id'] as string, role: 'owner' };
    next();
    return;
  }

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const supabase = getSupabase();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    req.user = { id: user.id, orgId: '' };
    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function authMiddleware(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  // Development fallback: accept x-org-id header when no Bearer token is present
  if (!authHeader && req.headers['x-org-id']) {
    req.user = { id: 'dev', orgId: req.headers['x-org-id'] as string, role: 'owner' };
    next();
    return;
  }

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const supabase = getSupabase();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const { data: memberships } = await supabase
      .from('org_members')
      .select('org_id, role')
      .eq('user_id', user.id)
      .limit(1);

    let membership = memberships?.[0] ?? null;

    if (!membership) {
      // Before auto-provisioning a solo org, check whether this email has a
      // pending invite to an existing org — if so, they must join via /join,
      // not get silently enrolled into a brand new org of their own.
      if (user.email) {
        const { data: invites } = await supabase
          .from('org_invites')
          .select('token, role, org_id, organizations(name)')
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString())
          .ilike('email', user.email)
          .limit(1);

        const pendingInvite = invites?.[0] ?? null;
        if (pendingInvite) {
          res.status(403).json({
            error: 'pending_invite',
            token: pendingInvite.token,
            role: pendingInvite.role,
            orgName: (pendingInvite as any).organizations?.name ?? null,
          });
          return;
        }
      }

      // Auto-provision an org on first login so no manual DB setup is needed
      const orgId = uuidv4();
      const domain = user.email?.split('@')[1] ?? 'myorg';
      const orgName = domain;
      // slug must be unique — use domain + short random suffix
      const slug = domain.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + orgId.slice(0, 6);

      const { error: orgErr } = await supabase
        .from('organizations')
        .insert({ id: orgId, name: orgName, slug });

      if (orgErr) {
        console.error('Auto-provision org failed:', orgErr.message);
        res.status(500).json({ error: 'Failed to create organisation: ' + orgErr.message });
        return;
      }

      const { error: memberErr } = await supabase
        .from('org_members')
        .insert({ org_id: orgId, user_id: user.id, role: 'owner' });

      if (memberErr) {
        console.error('Auto-provision member failed:', memberErr.message);
        res.status(500).json({ error: 'Failed to create membership: ' + memberErr.message });
        return;
      }

      membership = { org_id: orgId, role: 'owner' };
    }

    req.user = { id: user.id, orgId: membership.org_id, role: membership.role as OrgRole };
    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
