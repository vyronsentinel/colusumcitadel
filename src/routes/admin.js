import { Router } from 'express';
import { query } from '../db.js';
import { authenticate, requireSuperAdmin, asyncH } from '../auth/middleware.js';
import { membershipState } from '../services/membership.js';
import { audit } from '../services/audit.js';

const router = Router();
router.use(authenticate, requireSuperAdmin);

// Platform metrics for the owner console.
router.get('/metrics', asyncH(async (req, res) => {
  const companies = (await query('SELECT COUNT(*)::int AS n FROM companies')).rows[0].n;
  const active = (await query("SELECT COUNT(*)::int AS n FROM companies WHERE membership_status IN ('ACTIVE','TRIAL') AND (membership_expires_at IS NULL OR membership_expires_at > now())")).rows[0].n;
  const employees = (await query('SELECT COUNT(*)::int AS n FROM employees')).rows[0].n;
  res.json({ companies, active, employees });
}));

// List all client companies with usage + membership.
router.get('/companies', asyncH(async (req, res) => {
  const rows = (await query(`
    SELECT c.*,
      (SELECT COUNT(*)::int FROM employees e WHERE e.company_id=c.id) AS employee_count,
      (SELECT COUNT(*)::int FROM users u WHERE u.company_id=c.id) AS user_count
    FROM companies c ORDER BY c.created_at DESC`)).rows;
  res.json(rows.map((c) => ({
    id: c.id, name: c.name, slug: c.slug, plan: c.plan,
    membership_status: c.membership_status, membership_expires_at: c.membership_expires_at,
    employee_limit: c.employee_limit, employee_count: c.employee_count, user_count: c.user_count,
    contact_name: c.contact_name, contact_phone: c.contact_phone, created_at: c.created_at,
    membership: membershipState(c),
  })));
}));

// Activate / renew a membership — manual activation after the client pays you.
router.post('/companies/:id/activate', asyncH(async (req, res) => {
  const months = Number(req.body?.months || 1);
  const plan = req.body?.plan || 'BUSINESS';
  const employee_limit = Number(req.body?.employee_limit || 50);
  const c = (await query(
    `UPDATE companies SET membership_status='ACTIVE', plan=$1, employee_limit=$2,
       membership_expires_at = GREATEST(COALESCE(membership_expires_at, now()), now()) + ($3||' months')::interval
     WHERE id=$4 RETURNING *`,
    [plan, employee_limit, String(months), req.params.id])).rows[0];
  if (!c) return res.status(404).json({ error: 'Company not found' });
  await audit(req, 'MEMBERSHIP_ACTIVATED', `${c.name} +${months}mo ${plan} (limit ${employee_limit})`);
  res.json({ ok: true, membership: membershipState(c), expires: c.membership_expires_at });
}));

// Suspend a membership immediately.
router.post('/companies/:id/suspend', asyncH(async (req, res) => {
  const c = (await query("UPDATE companies SET membership_status='SUSPENDED' WHERE id=$1 RETURNING *", [req.params.id])).rows[0];
  if (!c) return res.status(404).json({ error: 'Company not found' });
  await audit(req, 'MEMBERSHIP_SUSPENDED', c.name);
  res.json({ ok: true });
}));

// Start / extend a trial.
router.post('/companies/:id/trial', asyncH(async (req, res) => {
  const days = Number(req.body?.days || 14);
  const c = (await query(
    `UPDATE companies SET membership_status='TRIAL', membership_expires_at = now() + ($1||' days')::interval WHERE id=$2 RETURNING *`,
    [String(days), req.params.id])).rows[0];
  if (!c) return res.status(404).json({ error: 'Company not found' });
  await audit(req, 'MEMBERSHIP_TRIAL', `${c.name} ${days}d`);
  res.json({ ok: true, expires: c.membership_expires_at });
}));

// Adjust employee limit.
router.post('/companies/:id/limit', asyncH(async (req, res) => {
  const lim = Number(req.body?.employee_limit || 50);
  await query('UPDATE companies SET employee_limit=$1 WHERE id=$2', [lim, req.params.id]);
  await audit(req, 'MEMBERSHIP_LIMIT', `limit=${lim}`);
  res.json({ ok: true, employee_limit: lim });
}));

export default router;
