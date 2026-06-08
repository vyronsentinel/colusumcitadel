import { verifyAccess } from './jwt.js';

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

// Wrap async handlers so rejections hit the error middleware.
export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
