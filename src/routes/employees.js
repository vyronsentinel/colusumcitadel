import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { authenticate, authorize, asyncH } from '../auth/middleware.js';
import { encrypt, decrypt } from '../util/crypto.js';
import { audit } from '../services/audit.js';

const router = Router();
router.use(authenticate);

const empSchema = z.object({
  emp_no: z.string().optional(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  department_id: z.string().uuid().nullable().optional(),
  position: z.string().optional(),
  grade_id: z.string().uuid().nullable().optional(),
  branch: z.string().optional(),
  status: z.enum(['ACTIVE', 'PROBATIONARY', 'ON_LEAVE', 'RESIGNED', 'TERMINATED']).optional(),
  pay_type: z.enum(['MONTHLY', 'HOURLY']).optional(),
  basic_salary: z.number().nonnegative().optional(),
  allowance: z.number().nonnegative().optional(),
  leave_credits: z.number().nonnegative().optional(),
  sss: z.string().optional(),
  philhealth: z.string().optional(),
  pagibig: z.string().optional(),
  tin: z.string().optional(),
  bank: z.string().optional(),
});

function publicEmployee(row, includePII = false) {
  const out = {
    id: row.id, emp_no: row.emp_no, first_name: row.first_name, last_name: row.last_name,
    email: row.email, department_id: row.department_id, position: row.position,
    grade_id: row.grade_id, branch: row.branch, status: row.status, pay_type: row.pay_type,
    basic_salary: Number(row.basic_salary), hourly_rate: Number(row.hourly_rate),
    allowance: Number(row.allowance), leave_credits: Number(row.leave_credits), date_hired: row.date_hired,
  };
  if (includePII) {
    out.sss = decrypt(row.sss_enc); out.philhealth = decrypt(row.philhealth_enc);
    out.pagibig = decrypt(row.pagibig_enc); out.tin = decrypt(row.tin_enc); out.bank = decrypt(row.bank_enc);
  }
  return out;
}

// List employees (scoped to the caller's company).
router.get('/', authorize('HR_ADMIN', 'FINANCE', 'MANAGER'), asyncH(async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM employees WHERE company_id=$1 ORDER BY last_name, first_name', [req.user.companyId],
  );
  res.json(rows.map((r) => publicEmployee(r)));
}));

router.get('/:id', authorize('HR_ADMIN', 'FINANCE', 'MANAGER'), asyncH(async (req, res) => {
  const { rows } = await query('SELECT * FROM employees WHERE id=$1 AND company_id=$2', [req.params.id, req.user.companyId]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const includePII = req.user.role === 'HR_ADMIN';
  res.json(publicEmployee(rows[0], includePII));
}));

// Create / onboard — HR only.
router.post('/', authorize('HR_ADMIN'), asyncH(async (req, res) => {
  const p = empSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid payload', details: p.error.flatten() });
  const d = p.data;
  const lim = (await query('SELECT employee_limit FROM companies WHERE id=$1', [req.user.companyId])).rows[0]?.employee_limit || 0;
  if (lim) {
    const cnt = (await query("SELECT COUNT(*)::int AS n FROM employees WHERE company_id=$1 AND status<>'TERMINATED'", [req.user.companyId])).rows[0].n;
    if (cnt >= lim) return res.status(403).json({ error: `Employee limit reached (${lim}). Upgrade your plan to add more employees.` });
  }
  const basic = d.basic_salary || 0;
  const hourly = Math.round((basic / 22 / 8) * 100) / 100;
  const empNo = d.emp_no || ('EMP-' + Date.now().toString().slice(-6));
  const { rows } = await query(
    `INSERT INTO employees (company_id, emp_no, first_name, last_name, email, department_id, position,
       grade_id, branch, status, pay_type, basic_salary, hourly_rate, allowance, leave_credits, date_hired,
       sss_enc, philhealth_enc, pagibig_enc, tin_enc, bank_enc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, CURRENT_DATE, $16,$17,$18,$19,$20) RETURNING *`,
    [req.user.companyId, empNo, d.first_name, d.last_name, d.email || null, d.department_id || null, d.position || null,
      d.grade_id || null, d.branch || null, d.status || 'PROBATIONARY', d.pay_type || 'MONTHLY', basic, hourly,
      d.allowance || 0, d.leave_credits || 0,
      encrypt(d.sss), encrypt(d.philhealth), encrypt(d.pagibig), encrypt(d.tin), encrypt(d.bank)],
  );
  await audit(req, 'EMPLOYEE_ONBOARDED', empNo);
  res.status(201).json(publicEmployee(rows[0], true));
}));

// Update — HR only.
router.put('/:id', authorize('HR_ADMIN'), asyncH(async (req, res) => {
  const p = empSchema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid payload', details: p.error.flatten() });
  const d = p.data;
  const fields = [];
  const vals = [];
  let i = 1;
  const set = (col, val) => { fields.push(`${col}=$${i++}`); vals.push(val); };
  for (const col of ['first_name', 'last_name', 'email', 'department_id', 'position', 'grade_id', 'branch', 'status', 'pay_type', 'allowance', 'leave_credits']) {
    if (d[col] !== undefined) set(col, d[col] === '' ? null : d[col]);
  }
  if (d.basic_salary !== undefined) { set('basic_salary', d.basic_salary); set('hourly_rate', Math.round((d.basic_salary / 22 / 8) * 100) / 100); }
  for (const [col, key] of [['sss_enc', 'sss'], ['philhealth_enc', 'philhealth'], ['pagibig_enc', 'pagibig'], ['tin_enc', 'tin'], ['bank_enc', 'bank']]) {
    if (d[key] !== undefined) set(col, encrypt(d[key]));
  }
  if (!fields.length) return res.status(400).json({ error: 'No updatable fields' });
  vals.push(req.params.id, req.user.companyId);
  const { rows } = await query(`UPDATE employees SET ${fields.join(', ')} WHERE id=$${i++} AND company_id=$${i} RETURNING *`, vals);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'EMPLOYEE_UPDATED', rows[0].emp_no);
  res.json(publicEmployee(rows[0], true));
}));

// Offboard (soft) — HR only.
router.post('/:id/offboard', authorize('HR_ADMIN'), asyncH(async (req, res) => {
  const { rows } = await query("UPDATE employees SET status='RESIGNED' WHERE id=$1 AND company_id=$2 RETURNING emp_no", [req.params.id, req.user.companyId]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'EMPLOYEE_OFFBOARDED', rows[0].emp_no);
  res.json({ ok: true });
}));

export default router;
