import bcrypt from 'bcryptjs';
import { pool, query, migrate } from './db.js';
import { config } from './config.js';
import { encrypt } from './util/crypto.js';

const FIRST = ['Maria', 'Jose', 'Anna', 'Mark', 'Grace', 'Paolo', 'Liza', 'Ramon', 'Jenny', 'Carlo', 'Divine', 'Noel', 'Aira', 'Rico', 'Bea', 'Dexter', 'Faith', 'Edgar'];
const LAST = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Torres', 'Flores', 'Castro', 'Ramos', 'Aquino', 'Villanueva', 'Domingo', 'Salazar', 'Navarro', 'Pascual', 'Gonzales', 'Rosales'];
const POSITIONS = ['Associate', 'Senior Associate', 'Supervisor', 'Manager', 'Director'];

async function main() {
  await migrate();

  // Idempotent: skip if already seeded.
  const existing = await query('SELECT COUNT(*)::int AS n FROM companies');
  if (existing.rows[0].n > 0) {
    console.log('Seed skipped — data already present.');
    await pool.end();
    return;
  }

  const company = (await query(
    'INSERT INTO companies (name, tin, logo) VALUES ($1,$2,$3) RETURNING *',
    ['Acme Technologies Inc.', '009-123-456-000', 'A'],
  )).rows[0];

  const deptNames = ['Engineering', 'Sales', 'Human Resources', 'Finance', 'Operations', 'Support'];
  const depts = [];
  for (const n of deptNames) {
    depts.push((await query('INSERT INTO departments (company_id, name) VALUES ($1,$2) RETURNING *', [company.id, n])).rows[0]);
  }
  const grades = [];
  const gdef = [['SG-1', 18000, 28000], ['SG-2', 28000, 45000], ['SG-3', 45000, 70000], ['SG-4', 70000, 110000], ['SG-5', 110000, 200000]];
  for (const [code, mn, mx] of gdef) {
    grades.push((await query('INSERT INTO salary_grades (company_id, code, min_amt, max_amt) VALUES ($1,$2,$3,$4) RETURNING *', [company.id, code, mn, mx])).rows[0]);
  }

  const branches = ['Makati HQ', 'BGC', 'Cebu', 'Davao', 'Remote'];
  const employees = [];
  for (let i = 0; i < 18; i++) {
    const grade = grades[i % grades.length];
    const basic = Math.round((Number(grade.min_amt) + Math.random() * (Number(grade.max_amt) - Number(grade.min_amt))) / 100) * 100;
    const fn = FIRST[i]; const ln = LAST[i];
    const emp = (await query(
      `INSERT INTO employees (company_id, emp_no, first_name, last_name, email, department_id, position, grade_id, branch, status, pay_type, basic_salary, hourly_rate, allowance, leave_credits, date_hired, sss_enc, philhealth_enc, pagibig_enc, tin_enc, bank_enc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE','MONTHLY',$10,$11,$12,$13, CURRENT_DATE - ($14||' days')::interval, $15,$16,$17,$18,$19) RETURNING *`,
      [company.id, `EMP-${String(1001 + i)}`, fn, ln, `${fn.toLowerCase()}.${ln.toLowerCase()}@acme.ph`,
        depts[i % depts.length].id, POSITIONS[i % POSITIONS.length], grade.id, branches[i % branches.length],
        basic, Math.round((basic / 22 / 8) * 100) / 100, 2000, 10, String(100 + i * 13),
        encrypt(`34-${1000000 + i}-1`), encrypt(`PH-${2000000 + i}`), encrypt(`12-${3000000 + i}`), encrypt(`123-45${i}-678`), encrypt(`BDO-00${10000 + i}`)],
    )).rows[0];
    employees.push(emp);
    if (i % 4 === 0) await query('INSERT INTO loans (employee_id, type, amortization, balance) VALUES ($1,$2,$3,$4)', [emp.id, 'SSS Salary Loan', 1500, 18000]);
    await query(
      `INSERT INTO attendance (employee_id, period_start, period_end, days_present, late_min, undertime_min, ot_hours, night_hours, absences, leave_days, reg_holiday_days, spec_holiday_days, ot_approved)
       VALUES ($1, CURRENT_DATE - 15, CURRENT_DATE, $2,$3,$4,$5,$6,$7,$8,0,0,true)`,
      [emp.id, 11, (i % 3) * 10, (i % 2) * 15, (i % 5), (i % 3) * 2, 0, (i % 6 === 0 ? 1 : 0)],
    );
  }

  const pw = await bcrypt.hash(config.bootstrap.adminPassword, 10);
  await query("INSERT INTO users (email, password_hash, role, company_id) VALUES ($1,$2,'HR_ADMIN',$3)", [config.bootstrap.adminEmail, pw, company.id]);
  await query("INSERT INTO users (email, password_hash, role, company_id) VALUES ($1,$2,'FINANCE',$3)", ['finance@acme.ph', pw, company.id]);
  await query("INSERT INTO users (email, password_hash, role, company_id) VALUES ($1,$2,'MANAGER',$3)", ['manager@acme.ph', pw, company.id]);
  await query("INSERT INTO users (email, password_hash, role, company_id, employee_id) VALUES ($1,$2,'EMPLOYEE',$3,$4)", ['employee@acme.ph', pw, company.id, employees[0].id]);

  console.log(`✓ Seeded company "${company.name}" with ${employees.length} employees.`);
  console.log(`  Login: ${config.bootstrap.adminEmail} / ${config.bootstrap.adminPassword} (HR_ADMIN)`);
  console.log('  Also: finance@acme.ph, manager@acme.ph, employee@acme.ph (same password)');
  await pool.end();
}

main().catch((e) => { console.error('Seed failed:', e); process.exit(1); });
