import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { signAccess, signRefresh, verifyRefresh } from '../auth/jwt.js';
import { authenticate, asyncH } from '../auth/middleware.js';
import { generateSecret, otpauthUrl, verifyToken } from '../auth/twofa.js';
import { audit } from '../services/audit.js';
import { config } from '../config.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().optional(),
});

router.post('/login', asyncH(async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Invalid payload', details: parse.error.flatten() });
  const { email, password, totp } = parse.data;

  const { rows } = await query('SELECT * FROM users WHERE email=$1 AND is_active=true', [email]);
  const user = rows[0];
  // Constant-ish work factor even on missing user to reduce enumeration.
  const ok = user ? await bcrypt.compare(password, user.password_hash) : await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvaliduO');
  if (!user || !ok) {
    await audit(req, 'LOGIN_FAILED', email);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.totp_enabled) {
    if (!totp) return res.status(401).json({ error: '2FA required', need2fa: true });
    if (!verifyToken(totp, user.totp_secret)) {
      await audit(req, 'LOGIN_2FA_FAILED', email);
      return res.status(401).json({ error: 'Invalid 2FA code' });
    }
  }

  const claims = { sub: user.id, role: user.role, companyId: user.company_id, employeeId: user.employee_id };
  await audit(req, 'LOGIN_SUCCESS', email);
  res.json({
    accessToken: signAccess(claims),
    refreshToken: signRefresh({ sub: user.id }),
    user: { id: user.id, email: user.email, role: user.role, companyId: user.company_id, totpEnabled: user.totp_enabled },
  });
}));

// Public self-serve company signup: creates a company (TRIAL) + its first HR admin.
const signupSchema = z.object({
  company_name: z.string().min(2),
  admin_email: z.string().email(),
  password: z.string().min(8),
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
  tin: z.string().optional(),
});
router.post('/signup', asyncH(async (req, res) => {
  const parse = signupSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'Invalid payload', details: parse.error.flatten() });
  const d = parse.data;
  const dupe = (await query('SELECT 1 FROM users WHERE email=$1', [d.admin_email])).rows[0];
  if (dupe) return res.status(409).json({ error: 'That email is already registered.' });
  const slug = d.company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) + '-' + Math.random().toString(36).slice(2, 6);
  const company = (await query(
    `INSERT INTO companies (name, tin, slug, contact_name, contact_phone, plan, membership_status, membership_expires_at, employee_limit, brand_color)
     VALUES ($1,$2,$3,$4,$5,'TRIAL','TRIAL', now() + ($6||' days')::interval, $7, '#27406e') RETURNING *`,
    [d.company_name, d.tin || null, slug, d.contact_name || null, d.contact_phone || null, String(config.saas.trialDays), config.saas.trialEmployeeLimit],
  )).rows[0];
  const pw = await bcrypt.hash(d.password, 10);
  const user = (await query(
    "INSERT INTO users (email, password_hash, role, company_id) VALUES ($1,$2,'HR_ADMIN',$3) RETURNING *",
    [d.admin_email, pw, company.id],
  )).rows[0];
  for (const n of ['Management', 'Operations']) {
    await query('INSERT INTO departments (company_id, name) VALUES ($1,$2)', [company.id, n]);
  }
  await audit(req, 'COMPANY_SIGNUP', `${d.company_name} <${d.admin_email}>`);
  const claims = { sub: user.id, role: user.role, companyId: company.id, employeeId: null };
  res.status(201).json({
    accessToken: signAccess(claims),
    refreshToken: signRefresh({ sub: user.id }),
    user: { id: user.id, email: user.email, role: user.role, companyId: company.id, totpEnabled: false },
    trialDays: config.saas.trialDays,
  });
}));

router.post('/refresh', asyncH(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'Missing refreshToken' });
  try {
    const { sub } = verifyRefresh(refreshToken);
    const { rows } = await query('SELECT * FROM users WHERE id=$1 AND is_active=true', [sub]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });
    const claims = { sub: user.id, role: user.role, companyId: user.company_id, employeeId: user.employee_id };
    res.json({ accessToken: signAccess(claims) });
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
}));

router.get('/me', authenticate, asyncH(async (req, res) => {
  const { rows } = await query('SELECT id, email, role, company_id, employee_id, totp_enabled FROM users WHERE id=$1', [req.user.sub]);
  res.json(rows[0] || null);
}));

// Begin 2FA enrollment — returns otpauth URL for an authenticator app.
router.post('/2fa/setup', authenticate, asyncH(async (req, res) => {
  const secret = generateSecret();
  await query('UPDATE users SET totp_secret=$1 WHERE id=$2', [secret, req.user.sub]);
  const { rows } = await query('SELECT email FROM users WHERE id=$1', [req.user.sub]);
  res.json({ secret, otpauthUrl: otpauthUrl(rows[0].email, secret) });
}));

// Confirm 2FA with a valid code to enable it.
router.post('/2fa/enable', authenticate, asyncH(async (req, res) => {
  const { rows } = await query('SELECT totp_secret FROM users WHERE id=$1', [req.user.sub]);
  const secret = rows[0]?.totp_secret;
  if (!secret) return res.status(400).json({ error: 'Run /2fa/setup first' });
  if (!verifyToken(req.body?.totp, secret)) return res.status(400).json({ error: 'Invalid code' });
  await query('UPDATE users SET totp_enabled=true WHERE id=$1', [req.user.sub]);
  await audit(req, '2FA_ENABLED', req.user.sub);
  res.json({ enabled: true });
}));

export default router;
