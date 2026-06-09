import { Router } from 'express';
import { query } from '../db.js';
import { authenticate, authorize, asyncH } from '../auth/middleware.js';
import { membershipState } from '../services/membership.js';
import { audit } from '../services/audit.js';

const router = Router();
router.use(authenticate);

// Current company profile + branding + membership (any authenticated company user).
// Not membership-gated so a locked tenant can still see its status / renew screen.
router.get('/', asyncH(async (req, res) => {
  if (!req.user.companyId) return res.json({ company: null, membership: { active: false, status: 'NONE' } });
  const c = (await query('SELECT * FROM companies WHERE id=$1', [req.user.companyId])).rows[0];
  if (!c) return res.status(404).json({ error: 'Company not found' });
  const empCount = (await query("SELECT COUNT(*)::int AS n FROM employees WHERE company_id=$1 AND status<>'TERMINATED'", [c.id])).rows[0].n;
  res.json({
    company: {
      id: c.id, name: c.name, tin: c.tin, address: c.address, logo: c.logo,
      brand_color: c.brand_color || '#27406e', sender_name: c.sender_name,
      email_template: c.email_template, plan: c.plan, employee_limit: c.employee_limit,
      contact_name: c.contact_name, contact_phone: c.contact_phone,
    },
    membership: membershipState(c),
    usage: { employees: empCount, employeeLimit: c.employee_limit },
  });
}));

// Update company profile / branding — HR admin only.
router.put('/', authorize('HR_ADMIN'), asyncH(async (req, res) => {
  const allowed = ['name', 'tin', 'address', 'brand_color', 'sender_name', 'email_template', 'contact_name', 'contact_phone'];
  const fields = []; const vals = []; let i = 1;
  for (const k of allowed) {
    if (req.body[k] !== undefined) { fields.push(`${k}=$${i++}`); vals.push(req.body[k] === '' ? null : req.body[k]); }
  }
  if (!fields.length) return res.status(400).json({ error: 'No updatable fields' });
  vals.push(req.user.companyId);
  const c = (await query(`UPDATE companies SET ${fields.join(', ')} WHERE id=$${i} RETURNING *`, vals)).rows[0];
  await audit(req, 'COMPANY_UPDATED', c.name);
  res.json({ ok: true, company: { id: c.id, name: c.name, brand_color: c.brand_color } });
}));

// Upload / replace company logo (base64 data URL) — HR admin only.
router.post('/logo', authorize('HR_ADMIN'), asyncH(async (req, res) => {
  const { logo } = req.body || {};
  if (!logo || typeof logo !== 'string' || !/^data:image\/(png|jpe?g|svg\+xml);base64,/.test(logo)) {
    return res.status(400).json({ error: 'Provide a PNG, JPG, or SVG image.' });
  }
  if (logo.length > 700000) return res.status(413).json({ error: 'Logo too large (max ~500KB).' });
  await query('UPDATE companies SET logo=$1 WHERE id=$2', [logo, req.user.companyId]);
  await audit(req, 'COMPANY_LOGO_UPDATED', 'logo');
  res.json({ ok: true });
}));

// ---- Payroll schedule config (one row per company) — HR admin ----
router.get('/schedule', authorize('HR_ADMIN'), asyncH(async (req, res) => {
  const s = (await query('SELECT * FROM payroll_schedules WHERE company_id=$1 LIMIT 1', [req.user.companyId])).rows[0] || null;
  res.json(s);
}));
router.put('/schedule', authorize('HR_ADMIN'), asyncH(async (req, res) => {
  const { cadence = 'SEMIMONTHLY', day_of_month = null, auto_email = true, enabled = false } = req.body || {};
  const existing = (await query('SELECT id FROM payroll_schedules WHERE company_id=$1 LIMIT 1', [req.user.companyId])).rows[0];
  let row;
  if (existing) {
    row = (await query('UPDATE payroll_schedules SET cadence=$1, day_of_month=$2, auto_email=$3, enabled=$4 WHERE id=$5 RETURNING *',
      [cadence, day_of_month, auto_email, enabled, existing.id])).rows[0];
  } else {
    row = (await query('INSERT INTO payroll_schedules (company_id, cadence, day_of_month, auto_email, enabled) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.companyId, cadence, day_of_month, auto_email, enabled])).rows[0];
  }
  await audit(req, 'PAYROLL_SCHEDULE_UPDATED', `${cadence} enabled=${enabled}`);
  res.json(row);
}));

export default router;
