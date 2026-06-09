import { tx } from '../db.js';
import { computePayslip } from '../payroll/engine.js';

// Build a payroll run (draft) for a company: computes payslips for all paid employees
// using each employee's latest attendance record. Shared by the manual and scheduled paths.
export async function buildRun({ companyId, period_label, period_start = null, period_end = null, createdBy = null }) {
  return tx(async (c) => {
    const run = (await c.query(
      `INSERT INTO payroll_runs (company_id, period_label, period_start, period_end, status, created_by)
       VALUES ($1,$2,$3,$4,'PREPARATION',$5) RETURNING *`,
      [companyId, period_label, period_start, period_end, createdBy],
    )).rows[0];

    const emps = (await c.query("SELECT * FROM employees WHERE company_id=$1 AND status IN ('ACTIVE','PROBATIONARY','ON_LEAVE')", [companyId])).rows;
    let tGross = 0; let tDed = 0; let tNet = 0; let seq = 0;
    for (const emp of emps) {
      const att = (await c.query('SELECT * FROM attendance WHERE employee_id=$1 ORDER BY period_end DESC LIMIT 1', [emp.id])).rows[0] || { days_present: 11 };
      const loans = (await c.query('SELECT * FROM loans WHERE employee_id=$1', [emp.id])).rows;
      const slip = computePayslip({ ...emp, loans }, att, {});
      const slipNo = `PS-${new Date().getFullYear()}-${String(run.id).slice(0, 4)}-${String(++seq).padStart(4, '0')}`;
      await c.query(
        `INSERT INTO payslips (run_id, employee_id, slip_no, gross_pay, total_ded, net_pay, earnings, deductions, attendance_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [run.id, emp.id, slipNo, slip.grossPay, slip.totalDeductions, slip.netPay,
          JSON.stringify(slip.earnings), JSON.stringify(slip.deductions), JSON.stringify(att)],
      );
      tGross += slip.grossPay; tDed += slip.totalDeductions; tNet += slip.netPay;
    }
    await c.query('UPDATE payroll_runs SET total_gross=$1, total_ded=$2, total_net=$3 WHERE id=$4',
      [tGross.toFixed(2), tDed.toFixed(2), tNet.toFixed(2), run.id]);
    return { run, count: emps.length };
  });
}
