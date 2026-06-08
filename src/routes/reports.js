import { Router } from 'express';
import { query } from '../db.js';
import { authenticate, authorize, asyncH } from '../auth/middleware.js';

const router = Router();
router.use(authenticate);

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

// Payroll summary for a run.
router.get('/run/:runId/summary', authorize('HR_ADMIN', 'FINANCE', 'MANAGER'), asyncH(async (req, res) => {
  const run = (await query('SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2', [req.params.runId, req.user.companyId])).rows[0];
  if (!run) return res.status(404).json({ error: 'Not found' });
  const byDept = (await query(
    `SELECT COALESCE(d.name,'Unassigned') AS department, COUNT(*) AS headcount,
            SUM(p.gross_pay) AS gross, SUM(p.total_ded) AS deductions, SUM(p.net_pay) AS net
     FROM payslips p JOIN employees e ON e.id=p.employee_id
     LEFT JOIN departments d ON d.id=e.department_id
     WHERE p.run_id=$1 GROUP BY d.name ORDER BY net DESC`, [run.id],
  )).rows;
  res.json({ run, byDepartment: byDept });
}));

// Government remittance report (SSS / PhilHealth / Pag-IBIG / tax) for a run.
router.get('/run/:runId/government', authorize('HR_ADMIN', 'FINANCE'), asyncH(async (req, res) => {
  const rows = (await query(
    `SELECT e.emp_no, e.first_name, e.last_name,
        (p.deductions->>'sss')::numeric AS sss,
        (p.deductions->>'philhealth')::numeric AS philhealth,
        (p.deductions->>'pagibig')::numeric AS pagibig,
        (p.deductions->>'withholdingTax')::numeric AS tax
     FROM payslips p JOIN employees e ON e.id=p.employee_id WHERE p.run_id=$1 ORDER BY e.last_name`, [req.params.runId],
  )).rows;
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="government-remittance.csv"');
    return res.send(toCsv(rows));
  }
  const totals = rows.reduce((t, r) => ({
    sss: t.sss + Number(r.sss || 0), philhealth: t.philhealth + Number(r.philhealth || 0),
    pagibig: t.pagibig + Number(r.pagibig || 0), tax: t.tax + Number(r.tax || 0),
  }), { sss: 0, philhealth: 0, pagibig: 0, tax: 0 });
  res.json({ rows, totals });
}));

// Bank disbursement file for bulk salary transfer.
router.get('/run/:runId/bank-file', authorize('FINANCE'), asyncH(async (req, res) => {
  const run = (await query("SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2 AND status='RELEASED'", [req.params.runId, req.user.companyId])).rows[0];
  if (!run) return res.status(409).json({ error: 'Run not found or not released' });
  const rows = (await query(
    `SELECT e.emp_no, e.first_name||' '||e.last_name AS payee, p.net_pay AS amount
     FROM payslips p JOIN employees e ON e.id=p.employee_id WHERE p.run_id=$1`, [run.id],
  )).rows;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bank-disbursement.csv"');
  res.send(toCsv(rows));
}));

// Payroll cost analysis across runs.
router.get('/cost-analysis', authorize('HR_ADMIN', 'FINANCE'), asyncH(async (req, res) => {
  const rows = (await query(
    `SELECT period_label, total_gross, total_ded, total_net, created_at
     FROM payroll_runs WHERE company_id=$1 AND status='RELEASED' ORDER BY created_at`, [req.user.companyId],
  )).rows;
  res.json(rows);
}));

export default router;
