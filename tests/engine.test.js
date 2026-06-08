import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePayslip, detectAnomalies } from '../src/payroll/engine.js';
import { sssEmployee, philhealthEmployee, pagibigEmployee, withholdingTaxMonthly } from '../src/payroll/tables.js';

test('SSS employee share at 25k', () => {
  assert.equal(sssEmployee(25000), 1125);
});

test('PhilHealth employee share at 25k', () => {
  assert.equal(philhealthEmployee(25000), 625);
});

test('PhilHealth respects 10k floor', () => {
  assert.equal(philhealthEmployee(8000), 250); // 10000*0.05/2
});

test('Pag-IBIG capped at 200', () => {
  assert.equal(pagibigEmployee(25000), 200);
  assert.equal(pagibigEmployee(50000), 200);
});

test('Withholding tax is zero below threshold', () => {
  assert.equal(withholdingTaxMonthly(18000), 0);
  assert.equal(withholdingTaxMonthly(20833), 0);
});

test('Withholding tax in first bracket', () => {
  assert.equal(withholdingTaxMonthly(30000), Math.round((30000 - 20833) * 0.15 * 100) / 100);
});

test('computePayslip produces non-negative net for a normal monthly employee', () => {
  const emp = { pay_type: 'MONTHLY', basic_salary: 30000, hourly_rate: 0, allowance: 2000, loans: [] };
  const att = { days_present: 11, ot_hours: 2, night_hours: 0, late_min: 0, undertime_min: 0, absences: 0, leave_days: 0, reg_holiday_days: 0, spec_holiday_days: 0 };
  const slip = computePayslip(emp, att, {});
  assert.ok(slip.netPay > 0);
  assert.ok(slip.grossPay >= slip.netPay);
  assert.ok(slip.deductions.sss > 0 && slip.deductions.philhealth > 0);
});

test('overtime increases gross pay', () => {
  const emp = { pay_type: 'MONTHLY', basic_salary: 30000, allowance: 0, loans: [] };
  const base = { days_present: 11, ot_hours: 0, night_hours: 0, late_min: 0, undertime_min: 0, absences: 0, leave_days: 0, reg_holiday_days: 0, spec_holiday_days: 0 };
  const withOt = { ...base, ot_hours: 10 };
  assert.ok(computePayslip(emp, withOt, {}).grossPay > computePayslip(emp, base, {}).grossPay);
});

test('detectAnomalies flags missing attendance and negative net', () => {
  const slips = [
    { employee_id: '1', net_pay: 15000, attendance_snapshot: { days_present: 11 } },
    { employee_id: '2', net_pay: -50, attendance_snapshot: { days_present: 0, leave_days: 0 } },
  ];
  const a = detectAnomalies(slips);
  assert.ok(a.some((x) => x.type === 'NEGATIVE_NET_PAY'));
  assert.ok(a.some((x) => x.type === 'MISSING_ATTENDANCE'));
});
