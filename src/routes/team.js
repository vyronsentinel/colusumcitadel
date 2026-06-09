import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { authenticate, authorize, asyncH } from '../auth/middleware.js';
import { audit } from '../services/audit.js';

// Team / login management for a company. HR_ADMIN only.
// These are SYSTEM LOGINS (who can sign in and approve payroll) — distinct
// from `employees`, which are payroll records. A company that just signed up
// has only the owner (HR_ADMIN); to release payroll they must add a FINANCE
// login here.
const router = Router();
router.use(authenticate);
router.use(authorize('HR_ADMIN'));

const ASSIGNABLE_ROLES = ['HR_ADMIN', 'FINANCE', 'MANAGER', 'EMPLOYEE'];

function publicUser(u) {
  return {
    id: u.id, email: u.email, role: u.role, is_active: u.is_active,
    totp_enabled: u.totp_enabled, employee_id: u.employee_id, created_at: u.created_at,
  };
}

// List all logins in the caller's company.
router.get('/', asyncH(async (req, res) => {
  const { rows } = await query(
    'SELECT id, email, role, is_active, totp_enabled, employee_id, created_at FROM users WHERE company_id=$1 ORDER BY created_at',
    [req.user.companyId],
  );
  res.json(rows.map(publicUser));
}));

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['HR_ADMIN', 'FINANCE', 'MANAGER', 'EMPLOYEE']),
  employee_id: z.string().uuid().nullable().optional(),
});

// Create a new login within the company.
router.post('/', asyncH(async (req, res) => {
  const p = createSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid payload', details: p.error.flatten() });
  const { email, password, role, employee_id } = p.data;
  const dupe = (await query('SELECT 1 FROM users WHERE email=$1', [email])).rows[0];
  if (dupe) return res.status(409).json({ error: 'That email is already registered.' });
  const hash = await bcrypt.hash(password, 10);
  const user = (await query(
    'INSERT INTO users (email, password_hash, role, company_id, employee_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [email, hash, role, req.user.companyId, employee_id || null],
  )).rows[0];
  await audit(req, 'TEAM_USER_CREATED', `${email} (${role})`);
  res.status(201).json(publicUser(user));
}));

const updateSchema = z.object({
  role: z.enum(['HR_ADMIN', 'FINANCE', 'MANAGER', 'EMPLOYEE']).optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

// Update a login: change role, activate/deactivate, or reset password.
router.put('/:id', asyncH(async (req, res) => {
  const p = updateSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid payload', details: p.error.flatten() });
  const target = (await query('SELECT * FROM users WHERE id=$1 AND company_id=$2', [req.params.id, req.user.companyId])).rows[0];
  if (!target) return res.status(404).json({ error: 'User not found' });
  // Guard: do not let an admin lock themselves out or demote their own account.
  if (target.id === req.user.sub && (p.data.is_active === false || (p.data.role && p.data.role !== 'HR_ADMIN'))) {
    return res.status(400).json({ error: 'You cannot deactivate or demote your own account.' });
  }
  const sets = []; const vals = []; let i = 1;
  if (p.data.role !== undefined) { sets.push(`role=$${i++}`); vals.push(p.data.role); }
  if (p.data.is_active !== undefined) { sets.push(`is_active=$${i++}`); vals.push(p.data.is_active); }
  if (p.data.password !== undefined) { sets.push(`password_hash=$${i++}`); vals.push(await bcrypt.hash(p.data.password, 10)); }
  if (!sets.length) return res.status(400).json({ error: 'No updatable fields' });
  vals.push(req.params.id, req.user.companyId);
  const updated = (await query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${i++} AND company_id=$${i} RETURNING *`, vals)).rows[0];
  await audit(req, 'TEAM_USER_UPDATED', `${updated.email} (${updated.role}, active=${updated.is_active})`);
  res.json(publicUser(updated));
}));

export default router;
