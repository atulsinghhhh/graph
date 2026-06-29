import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../config/postgres';

export interface AuthedRequest extends Request {
  user?: { id: string; orgId: string };
}

export async function authMiddleware(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  // Development fallback: accept x-org-id header when no Bearer token is present
  if (!authHeader && req.headers['x-org-id']) {
    req.user = { id: 'dev', orgId: req.headers['x-org-id'] as string };
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

    let { data: membership } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .single();

    // Auto-provision an org on first login so no manual DB setup is needed
    if (!membership) {
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

      membership = { org_id: orgId };
    }

    req.user = { id: user.id, orgId: membership.org_id };
    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
