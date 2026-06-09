import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { authenticate, authorize, asyncH } from '../auth/middleware.js';
import { detectAnomalies } from '../payroll/engine.js';
import { buildRun } from '../services/payrollRun.js';
import { decrypt } from '../util/crypto.js';
import { audit } from '../services/audit.js';

const router = Router();
router.use(authenticate);

// Workflow state machine — maps current status to the role that may advance it.
const TRANSITIONS = {
  PREPARATION: { next: 'HR_REVIEW', role: 'HR_ADMIN', action: 'SUBMIT_FOR_REVIEW' },
  HR_REVIEW: { next: 'FINANCE_APPROVAL', role: 'HR_ADMIN', action: 'HR_APPROVE' },
  FINANCE_APPROVAL: { next: 'APPROVED', role: 'FINANCE', action: 'FINANCE_APPROVE' },
  APPROVED: { next: 'RELEASED', role: 'FINANCE', action: 'RELEASE' },
};

router.get('/', authorize('HR_ADMIN', 'FINANCE', 'MANAGER'), asyncH(async (req, res) => {
  const { rows } = await query('SELECT * FROM payroll_runs WHERE company_id=$1 ORDER BY created_at DESC', [req.user.companyId]);
  res.json(rows);
}));

router.get('/:id', authorize('HR_ADMIN', 'FINANCE', 'MANAGER'), asyncH(async (req, res) => {
  const run = (await query('SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2', [req.params.id, req.user.companyId])).rows[0];
  if (!run) return res.status(404).json({ error: 'Not found' });
  const slips = (await query('SELECT * FROM payslips WHERE run_id=$1', [run.id])).rows;
  const approvals = (await query('SELECT * FROM approvals WHERE run_id=$1 ORDER BY created_at', [run.id])).rows;
  res.json({ run, slips, approvals });
}));

// Build a run: compute payslips for all active employees in the company.
const buildSchema = z.object({
  period_label: z.string(),
  period_start: z.string().optional(),
  period_end: z.string().optional(),
});
router.post('/', authorize('HR_ADMIN'), asyncH(async (req, res) => {
  const p = buildSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid payload', details: p.error.flatten() });
  const { period_label, period_start, period_end } = p.data;

  const result = await buildRun({ companyId: req.user.companyId, period_label, period_start, period_end, createdBy: req.user.sub });

  await audit(req, 'PAYROLL_RUN_CREATED', `${period_label} (${result.count} employees)`);
  res.status(201).json(result);
}));

// AI pre-release validation.
router.get('/:id/validate', authorize('HR_ADMIN', 'FINANCE'), asyncH(async (req, res) => {
  const slips = (await query(
    `SELECT p.*, e.bank_enc FROM payslips p JOIN employees e ON e.id=p.employee_id WHERE p.run_id=$1`, [req.params.id],
  )).rows.map((s) => ({ ...s, bank: decrypt(s.bank_enc), attendance_snapshot: s.attendance_snapshot }));
  const anomalies = detectAnomalies(slips);
  res.json({ anomalies, passed: anomalies.filter((a) => a.severity === 'critical').length === 0 });
}));

// Advance the approval workflow.
router.post('/:id/advance', authorize('HR_ADMIN', 'FINANCE'), asyncH(async (req, res) => {
  const run = (await query('SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2', [req.params.id, req.user.companyId])).rows[0];
  if (!run) return res.status(404).json({ error: 'Not found' });
  const t = TRANSITIONS[run.status];
  if (!t) return res.status(409).json({ error: `Run is ${run.status}; no further transition` });
  if (req.user.role !== t.role) return res.status(403).json({ error: `Stage ${run.status} requires role ${t.role}` });

  const released = t.next === 'RELEASED';
  await query('UPDATE payroll_runs SET status=$1' + (released ? ', released_at=now()' : '') + ' WHERE id=$2', [t.next, run.id]);
  await query('INSERT INTO approvals (run_id, stage, action, actor_id, actor_role) VALUES ($1,$2,$3,$4,$5)',
    [run.id, run.status, t.action, req.user.sub, req.user.role]);
  await audit(req, 'PAYROLL_' + t.action, run.period_label);
  res.json({ status: t.next });
}));

router.post('/:id/reject', authorize('HR_ADMIN', 'FINANCE'), asyncH(async (req, res) => {
  const run = (await query('SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2', [req.params.id, req.user.companyId])).rows[0];
  if (!run) return res.status(404).json({ error: 'Not found' });
  await query("UPDATE payroll_runs SET status='REJECTED' WHERE id=$1", [run.id]);
  await query('INSERT INTO approvals (run_id, stage, action, actor_id, actor_role) VALUES ($1,$2,$3,$4,$5)',
    [run.id, run.status, 'REJECTED', req.user.sub, req.user.role]);
  await audit(req, 'PAYROLL_REJECTED', `${run.period_label}: ${req.body?.reason || ''}`);
  res.json({ status: 'REJECTED' });
}));

// Scheduled / automated run trigger: builds a draft run for the current period.
// Intended to be called by the in-app schedule or an external cron (the approval
// workflow still applies; emailing happens after release).
router.post('/auto', authorize('HR_ADMIN'), asyncH(async (req, res) => {
  const label = req.body?.period_label || ('Auto · ' + new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }));
  const result = await buildRun({ companyId: req.user.companyId, period_label: label, createdBy: req.user.sub });
  await audit(req, 'PAYROLL_AUTO_RUN', `${label} (${result.count} employees)`);
  res.status(201).json(result);
}));

export default router;
