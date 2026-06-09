import { verifyAccess } from './jwt.js';
import { query } from '../db.js';
import { membershipState } from '../services/membership.js';

// Verify bearer token and attach req.user = { sub, role, companyId, employeeId }
export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    req.user = verifyAccess(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Restrict a route to one or more roles.
export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden — requires role: ${roles.join(', ')}` });
    }
    return next();
  };
}

// Gate operational routes behind an active company membership.
// Super admins bypass. Responds 402 when the tenant's membership is inactive.
export function requireActiveMembership(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  if (req.user.role === 'SUPER_ADMIN') return next();
  if (!req.user.companyId) return res.status(402).json({ error: 'No active company membership.', locked: true });
  query('SELECT membership_status, membership_expires_at FROM companies WHERE id=$1', [req.user.companyId])
    .then(({ rows }) => {
      const st = membershipState(rows[0]);
      if (!st.active) return res.status(402).json({ error: st.reason, membership: st.status, locked: true });
      return next();
    })
    .catch(next);
}

// Restrict to the platform owner (super admin).
export function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Super admin only' });
  return next();
}

// Wrap async handlers so rejections hit the error middleware.
export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
