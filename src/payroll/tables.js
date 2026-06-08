// ============================================================
// Philippine statutory contribution & tax tables.
//
// ⚠️  These schedules change periodically (SSS, PhilHealth, Pag-IBIG, BIR).
//    Always validate against the latest official issuances and have a
//    licensed PH payroll specialist / accountant sign off before running
//    real payroll. Versioned here so they can be audited and updated.
// ============================================================

export const TABLE_VERSION = '2024.1';

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// SSS 2024: total 14% of MSC; employee share 4.5%. MSC range 4,000–30,000 (step 500).
export function sssEmployee(monthly) {
  let msc = Math.min(30000, Math.max(4000, Math.round(monthly / 500) * 500));
  if (monthly < 4250) msc = 4000;
  return round2(msc * 0.045);
}
export function sssEmployer(monthly) {
  let msc = Math.min(30000, Math.max(4000, Math.round(monthly / 500) * 500));
  if (monthly < 4250) msc = 4000;
  return round2(msc * 0.095); // excludes EC; add EC separately if required
}

// PhilHealth 2024: 5% premium split 50/50; floor 10,000, ceiling 100,000.
export function philhealthEmployee(monthly) {
  const base = Math.min(100000, Math.max(10000, monthly));
  return round2((base * 0.05) / 2);
}
export const philhealthEmployer = philhealthEmployee;

// Pag-IBIG: 1% if MSC <= 1500 else 2%; salary credit capped at 10,000 (max ₱200 EE).
export function pagibigEmployee(monthly) {
  const credit = Math.min(10000, monthly);
  const rate = monthly <= 1500 ? 0.01 : 0.02;
  return round2(credit * rate);
}
export const pagibigEmployer = pagibigEmployee;

// BIR TRAIN monthly withholding tax (effective 2023 onward).
export function withholdingTaxMonthly(taxable) {
  const t = Math.max(0, taxable);
  if (t <= 20833) return 0;
  if (t <= 33332) return round2((t - 20833) * 0.15);
  if (t <= 66666) return round2(1875 + (t - 33333) * 0.2);
  if (t <= 166666) return round2(8541.8 + (t - 66667) * 0.25);
  if (t <= 666666) return round2(33541.8 + (t - 166667) * 0.3);
  return round2(183541.8 + (t - 666667) * 0.35);
}

export { round2 };
