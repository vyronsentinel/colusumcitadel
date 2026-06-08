// ============================================================
// Payroll computation engine (semi-monthly cutoff).
// Pure functions — no DB access — so they are unit-testable.
// ============================================================
import {
  sssEmployee, philhealthEmployee, pagibigEmployee, withholdingTaxMonthly, round2,
} from './tables.js';

const WORK_DAYS_PER_MONTH = 22;
const HOURS_PER_DAY = 8;
const OT_MULTIPLIER = 1.25;
const NIGHT_DIFF_RATE = 0.10;
const SPECIAL_HOLIDAY_PREMIUM = 0.30;

/**
 * @param {object} emp   employee record { pay_type, basic_salary, hourly_rate, allowance, loans:[{type,amortization}] }
 * @param {object} att   attendance { days_present, late_min, undertime_min, ot_hours, night_hours, absences, leave_days, reg_holiday_days, spec_holiday_days }
 * @param {object} extras { commission, bonus, incentive, salary_advance, company_deduction }
 * @returns full payslip computation
 */
export function computePayslip(emp, att, extras = {}) {
  const monthlyBasic = Number(emp.basic_salary) || 0;
  const semiBasic = round2(monthlyBasic / 2);
  const dailyRate = round2(monthlyBasic / WORK_DAYS_PER_MONTH);
  const hourly = emp.pay_type === 'HOURLY'
    ? Number(emp.hourly_rate) || round2(dailyRate / HOURS_PER_DAY)
    : round2(dailyRate / HOURS_PER_DAY);

  const a = {
    days_present: Number(att.days_present) || 0,
    late_min: Number(att.late_min) || 0,
    undertime_min: Number(att.undertime_min) || 0,
    ot_hours: Number(att.ot_hours) || 0,
    night_hours: Number(att.night_hours) || 0,
    absences: Number(att.absences) || 0,
    leave_days: Number(att.leave_days) || 0,
    reg_holiday_days: Number(att.reg_holiday_days) || 0,
    spec_holiday_days: Number(att.spec_holiday_days) || 0,
  };

  const earnings = {};
  earnings.basicPay = emp.pay_type === 'HOURLY'
    ? round2(a.days_present * HOURS_PER_DAY * hourly)
    : round2(semiBasic - a.absences * dailyRate);
  earnings.overtime = round2(a.ot_hours * hourly * OT_MULTIPLIER);
  earnings.nightDiff = round2(a.night_hours * hourly * NIGHT_DIFF_RATE);
  earnings.regHolidayPay = round2(a.reg_holiday_days * dailyRate * 1.0);
  earnings.specHolidayPay = round2(a.spec_holiday_days * dailyRate * SPECIAL_HOLIDAY_PREMIUM);
  earnings.leavePay = round2(a.leave_days * dailyRate);
  earnings.commission = round2(extras.commission || 0);
  earnings.bonus = round2(extras.bonus || 0);
  earnings.incentive = round2(extras.incentive || 0);
  earnings.allowance = round2(Number(emp.allowance) || 0); // non-taxable de minimis

  const taxableEarnings = round2(
    earnings.basicPay + earnings.overtime + earnings.nightDiff + earnings.regHolidayPay +
    earnings.specHolidayPay + earnings.leavePay + earnings.commission + earnings.bonus + earnings.incentive,
  );
  const grossPay = round2(taxableEarnings + earnings.allowance);

  // Statutory contributions are monthly; charge half per semi-monthly cutoff.
  const sssM = sssEmployee(monthlyBasic);
  const phM = philhealthEmployee(monthlyBasic);
  const piM = pagibigEmployee(monthlyBasic);

  const deductions = {};
  deductions.sss = round2(sssM / 2);
  deductions.philhealth = round2(phM / 2);
  deductions.pagibig = round2(piM / 2);
  deductions.tardiness = round2((a.late_min / 60) * hourly + (a.undertime_min / 60) * hourly);

  const monthlyTaxable = round2(taxableEarnings * 2 - (sssM + phM + piM));
  deductions.withholdingTax = round2(withholdingTaxMonthly(monthlyTaxable) / 2);

  const loanLines = (emp.loans || []).map((ln) => ({
    type: ln.type,
    amount: round2((Number(ln.amortization) || 0) / 2),
  }));
  deductions.loans = round2(loanLines.reduce((s, l) => s + l.amount, 0));
  deductions.salaryAdvance = round2(extras.salary_advance || 0);
  deductions.companyDeduction = round2(extras.company_deduction || 0);

  const totalDeductions = round2(
    deductions.sss + deductions.philhealth + deductions.pagibig + deductions.tardiness +
    deductions.withholdingTax + deductions.loans + deductions.salaryAdvance + deductions.companyDeduction,
  );
  const netPay = round2(grossPay - totalDeductions);

  return {
    earnings, deductions, loanLines, taxableEarnings, grossPay, totalDeductions, netPay,
    rates: { dailyRate, hourly, monthlyBasic },
  };
}

// Anomaly detection used in pre-release AI validation.
export function detectAnomalies(slips) {
  const out = [];
  const nets = slips.map((s) => s.net_pay ?? s.netPay);
  const mean = nets.reduce((a, b) => a + Number(b), 0) / (nets.length || 1);
  const sd = Math.sqrt(nets.reduce((a, b) => a + (Number(b) - mean) ** 2, 0) / (nets.length || 1));
  const seenBank = {};
  for (const s of slips) {
    const net = Number(s.net_pay ?? s.netPay);
    if (sd > 0 && Math.abs(net - mean) > 2.4 * sd) {
      out.push({ type: 'OUTLIER_NET_PAY', severity: 'warning', employeeId: s.employee_id, message: `Net ${net} deviates >2.4σ from mean ${mean.toFixed(2)}` });
    }
    if (net < 0) out.push({ type: 'NEGATIVE_NET_PAY', severity: 'critical', employeeId: s.employee_id, message: 'Deductions exceed gross' });
    const att = s.attendance_snapshot || s.attendance || {};
    if ((att.ot_hours || 0) > 5) out.push({ type: 'EXCESSIVE_OVERTIME', severity: 'warning', employeeId: s.employee_id, message: `${att.ot_hours} OT hours` });
    if ((att.days_present || 0) === 0 && (att.leave_days || 0) === 0) out.push({ type: 'MISSING_ATTENDANCE', severity: 'critical', employeeId: s.employee_id, message: 'No DTR records' });
    if (s.bank) {
      if (seenBank[s.bank]) out.push({ type: 'DUPLICATE_PAYMENT', severity: 'critical', employeeId: s.employee_id, message: `Shares bank account with ${seenBank[s.bank]}` });
      else seenBank[s.bank] = s.employee_id;
    }
  }
  return out;
}
