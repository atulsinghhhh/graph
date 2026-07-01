import { Response, NextFunction } from 'express';
import { AuthedRequest, OrgRole } from './auth';

export function requireRole(...allowed: OrgRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const role = req.user?.role;
    if (!role || !allowed.includes(role)) {
      res.status(403).json({ error: 'forbidden', message: 'You do not have permission to perform this action.' });
      return;
    }
    next();
  };
}
