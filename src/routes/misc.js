import { Router } from 'express';
import { query } from '../db.js';
import { authenticate, authorize, asyncH } from '../auth/middleware.js';
import { audit } from '../services/audit.js';

const router = Router();
router.use(authenticate);

// ---- Dashboard ----
router.get('/dashboard', authorize('HR_ADMIN', 'FINANCE', 'MANAGER'), asyncH(async (req, res) => {
  const cid = req.user.companyId;
  const [emp, runs, pending, lastRun] = await Promise.all([
    query("SELECT COUNT(*)::int AS n FROM employees WHERE company_id=$1 AND status IN ('ACTIVE','PROBATIONARY')", [cid]),
    query('SELECT COUNT(*)::int AS n FROM payroll_runs WHERE company_id=$1', [cid]),
    query("SELECT COUNT(*)::int AS n FROM payroll_runs WHERE company_id=$1 AND status IN ('HR_REVIEW','FINANCE_APPROVAL','APPROVED')", [cid]),
    query('SELECT * FROM payroll_runs WHERE company_id=$1 ORDER BY created_at DESC LIMIT 1', [cid]),
  ]);
  let emailStatus = { SENT: 0, FAILED: 0, PENDING: 0 };
  if (lastRun.rows[0]) {
    const es = (await query("SELECT email_status, COUNT(*)::int AS n FROM payslips WHERE run_id=$1 GROUP BY email_status", [lastRun.rows[0].id])).rows;
    for (const r of es) emailStatus[r.email_status] = r.n;
  }
  res.json({
    totalEmployees: emp.rows[0].n,
    totalRuns: runs.rows[0].n,
    pendingApprovals: pending.rows[0].n,
    lastRun: lastRun.rows[0] || null,
    emailStatus,
  });
}));

// ---- Departments ----
router.get('/departments', authorize('HR_ADMIN', 'FINANCE', 'MANAGER'), asyncH(async (req, res) => {
  res.json((await query('SELECT * FROM departments WHERE company_id=$1 ORDER BY name', [req.user.companyId])).rows);
}));
router.post('/departments', authorize('HR_ADMIN'), asyncH(async (req, res) => {
  const { name, head } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const { rows } = await query('INSERT INTO departments (company_id, name, head) VALUES ($1,$2,$3) RETURNING *', [req.user.companyId, name, head || null]);
  await audit(req, 'DEPARTMENT_CREATED', name);
  res.status(201).json(rows[0]);
}));

// ---- Leave requests (self-service + approval) ----
router.get('/leave', asyncH(async (req, res) => {
  if (req.user.role === 'EMPLOYEE') {
    return res.json((await query('SELECT * FROM leave_requests WHERE employee_id=$1 ORDER BY created_at DESC', [req.user.employeeId])).rows);
  }
  res.json((await query(
    `SELECT l.* FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE e.company_id=$1 ORDER BY l.created_at DESC`, [req.user.companyId],
  )).rows);
}));
router.post('/leave', asyncH(async (req, res) => {
  const { type, date_from, date_to, reason } = req.body || {};
  if (!type || !date_from || !date_to) return res.status(400).json({ error: 'type, date_from, date_to required' });
  const empId = req.user.employeeId;
  if (!empId) return res.status(400).json({ error: 'No employee profile linked to user' });
  const { rows } = await query('INSERT INTO leave_requests (employee_id, type, date_from, date_to, reason) VALUES ($1,$2,$3,$4,$5) RETURNING *', [empId, type, date_from, date_to, reason || null]);
  await audit(req, 'LEAVE_REQUESTED', type);
  res.status(201).json(rows[0]);
}));
router.post('/leave/:id/decide', authorize('HR_ADMIN', 'MANAGER'), asyncH(async (req, res) => {
  const status = req.body?.status === 'APPROVED' ? 'APPROVED' : 'REJECTED';
  const { rows } = await query('UPDATE leave_requests SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'LEAVE_' + status, req.params.id);
  res.json(rows[0]);
}));

// ---- Audit log (HR/Finance read) ----
router.get('/audit', authorize('HR_ADMIN', 'FINANCE'), asyncH(async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 200);
  res.json((await query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1', [limit])).rows);
}));

export default router;
