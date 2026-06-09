import { Router } from 'express';
import { query } from '../db.js';
import { authenticate, authorize, asyncH } from '../auth/middleware.js';
import { renderPayslipPdf } from '../services/pdf.js';
import { sendPayslipEmail } from '../services/email.js';
import { decrypt } from '../util/crypto.js';
import { audit } from '../services/audit.js';

const router = Router();
router.use(authenticate);

// Build mail settings for a company. Always carries the company's display name
// so that even on the shared platform relay, payslips show the client's brand.
// Includes the client's own SMTP credentials only when they configured them.
function companySmtp(c) {
  const o = { fromName: (c && (c.sender_name || c.name)) || null };
  if (c && c.smtp_host) {
    o.host = c.smtp_host; o.port = c.smtp_port; o.user = c.smtp_user;
    o.from = c.smtp_from; o.secure = c.smtp_secure; o.pass = decrypt(c.smtp_pass_enc);
  }
  return o;
}

async function loadSlipContext(slipId, companyId) {
  const slip = (await query(
    `SELECT p.*, e.first_name, e.last_name, e.emp_no, e.email, e.position, e.branch, e.company_id, d.name AS department
     FROM payslips p JOIN employees e ON e.id=p.employee_id
     LEFT JOIN departments d ON d.id=e.department_id WHERE p.id=$1`, [slipId],
  )).rows[0];
  if (!slip || slip.company_id !== companyId) return null;
  const company = (await query('SELECT * FROM companies WHERE id=$1', [slip.company_id])).rows[0];
  return { slip, company };
}

// Employee self-service: own payslips only.
router.get('/mine', asyncH(async (req, res) => {
  if (!req.user.employeeId) return res.json([]);
  const { rows } = await query(
    `SELECT p.id, p.slip_no, p.gross_pay, p.net_pay, p.total_ded, p.email_status, r.period_label, r.status AS run_status
     FROM payslips p JOIN payroll_runs r ON r.id=p.run_id
     WHERE p.employee_id=$1 AND r.status='RELEASED' ORDER BY r.created_at DESC`, [req.user.employeeId],
  );
  res.json(rows);
}));

// Download a payslip PDF. Employees may only fetch their own.
router.get('/:id/pdf', asyncH(async (req, res) => {
  const ctx = await loadSlipContext(req.params.id, req.user.companyId);
  if (!ctx) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'EMPLOYEE' && ctx.slip.employee_id !== req.user.employeeId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const period = (await query('SELECT period_label FROM payroll_runs WHERE id=$1', [ctx.slip.run_id])).rows[0]?.period_label || '';
  const pdf = await renderPayslipPdf({
    company: ctx.company,
    employee: ctx.slip,
    slip: ctx.slip,
    period,
  });
  await audit(req, 'PAYSLIP_DOWNLOADED', ctx.slip.slip_no);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${ctx.slip.slip_no}.pdf"`);
  res.send(pdf);
}));

// Bulk email payslips for a run — HR only, run must be RELEASED.
router.post('/run/:runId/email', authorize('HR_ADMIN'), asyncH(async (req, res) => {
  const run = (await query('SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2', [req.params.runId, req.user.companyId])).rows[0];
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (run.status !== 'RELEASED') return res.status(409).json({ error: 'Run must be RELEASED before emailing' });
  const company = (await query('SELECT * FROM companies WHERE id=$1', [run.company_id])).rows[0];
  const slips = (await query(
    `SELECT p.*, e.first_name, e.last_name, e.email, e.position, e.branch FROM payslips p
     JOIN employees e ON e.id=p.employee_id WHERE p.run_id=$1`, [run.id],
  )).rows;

  let sent = 0; let failed = 0;
  for (const slip of slips) {
    if (!slip.email) { failed++; await query("UPDATE payslips SET email_status='FAILED' WHERE id=$1", [slip.id]); continue; }
    const pdf = await renderPayslipPdf({ company, employee: slip, slip, period: run.period_label });
    const r = await sendPayslipEmail({
      to: slip.email, name: `${slip.first_name} ${slip.last_name}`, period: run.period_label,
      net: Number(slip.net_pay).toLocaleString('en-PH', { minimumFractionDigits: 2 }),
      pdfBuffer: pdf, slipNo: slip.slip_no, template: req.body?.template || company.email_template,
      smtp: companySmtp(company),
    });
    if (r.ok) { sent++; await query("UPDATE payslips SET email_status='SENT', email_at=now() WHERE id=$1", [slip.id]); }
    else { failed++; await query("UPDATE payslips SET email_status='FAILED' WHERE id=$1", [slip.id]); }
  }
  await audit(req, 'PAYSLIPS_EMAILED', `${run.period_label}: ${sent} sent, ${failed} failed`);
  res.json({ sent, failed, total: slips.length });
}));

// Resend only failed payslips.
router.post('/run/:runId/resend-failed', authorize('HR_ADMIN'), asyncH(async (req, res) => {
  const run = (await query('SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2', [req.params.runId, req.user.companyId])).rows[0];
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const company = (await query('SELECT * FROM companies WHERE id=$1', [run.company_id])).rows[0];
  const slips = (await query(
    `SELECT p.*, e.first_name, e.last_name, e.email FROM payslips p JOIN employees e ON e.id=p.employee_id
     WHERE p.run_id=$1 AND p.email_status='FAILED'`, [run.id],
  )).rows;
  let sent = 0; let failed = 0;
  for (const slip of slips) {
    if (!slip.email) { failed++; continue; }
    const pdf = await renderPayslipPdf({ company, employee: slip, slip, period: run.period_label });
    const r = await sendPayslipEmail({ to: slip.email, name: `${slip.first_name} ${slip.last_name}`, period: run.period_label, net: String(slip.net_pay), pdfBuffer: pdf, slipNo: slip.slip_no, template: company.email_template, smtp: companySmtp(company) });
    if (r.ok) { sent++; await query("UPDATE payslips SET email_status='SENT', email_at=now() WHERE id=$1", [slip.id]); }
    else failed++;
  }
  await audit(req, 'PAYSLIPS_RESENT', `${sent} resent`);
  res.json({ sent, failed });
}));

export default router;
