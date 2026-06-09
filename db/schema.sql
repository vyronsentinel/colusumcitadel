-- ===== PayrollPro schema (PostgreSQL) =====
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  tin         TEXT,
  logo        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('HR_ADMIN','FINANCE','MANAGER','EMPLOYEE')),
  company_id    UUID REFERENCES companies(id) ON DELETE SET NULL,
  employee_id   UUID,
  totp_secret   TEXT,
  totp_enabled  BOOLEAN NOT NULL DEFAULT false,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  head       TEXT
);

CREATE TABLE IF NOT EXISTS salary_grades (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  min_amt    NUMERIC(12,2) NOT NULL,
  max_amt    NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  emp_no        TEXT NOT NULL,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  email         TEXT,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  position      TEXT,
  grade_id      UUID REFERENCES salary_grades(id) ON DELETE SET NULL,
  branch        TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PROBATIONARY','ON_LEAVE','RESIGNED','TERMINATED')),
  pay_type      TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (pay_type IN ('MONTHLY','HOURLY')),
  basic_salary  NUMERIC(12,2) NOT NULL DEFAULT 0,
  hourly_rate   NUMERIC(12,2) NOT NULL DEFAULT 0,
  allowance     NUMERIC(12,2) NOT NULL DEFAULT 0,
  leave_credits NUMERIC(6,2) NOT NULL DEFAULT 0,
  date_hired    DATE,
  -- encrypted sensitive fields (AES-256-GCM, base64)
  sss_enc       TEXT,
  philhealth_enc TEXT,
  pagibig_enc   TEXT,
  tin_enc       TEXT,
  bank_enc      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, emp_no)
);

CREATE TABLE IF NOT EXISTS loans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  amortization NUMERIC(12,2) NOT NULL,
  balance      NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  days_present  NUMERIC(5,2) NOT NULL DEFAULT 0,
  late_min      INTEGER NOT NULL DEFAULT 0,
  undertime_min INTEGER NOT NULL DEFAULT 0,
  ot_hours      NUMERIC(6,2) NOT NULL DEFAULT 0,
  night_hours   NUMERIC(6,2) NOT NULL DEFAULT 0,
  absences      NUMERIC(5,2) NOT NULL DEFAULT 0,
  leave_days    NUMERIC(5,2) NOT NULL DEFAULT 0,
  reg_holiday_days NUMERIC(5,2) NOT NULL DEFAULT 0,
  spec_holiday_days NUMERIC(5,2) NOT NULL DEFAULT 0,
  ot_approved   BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_label TEXT NOT NULL,
  period_start DATE,
  period_end   DATE,
  status       TEXT NOT NULL DEFAULT 'PREPARATION'
                 CHECK (status IN ('PREPARATION','HR_REVIEW','FINANCE_APPROVAL','APPROVED','RELEASED','REJECTED')),
  total_gross  NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_ded    NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_net    NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payslips (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  slip_no       TEXT NOT NULL UNIQUE,
  gross_pay     NUMERIC(12,2) NOT NULL,
  total_ded     NUMERIC(12,2) NOT NULL,
  net_pay       NUMERIC(12,2) NOT NULL,
  earnings      JSONB NOT NULL,
  deductions    JSONB NOT NULL,
  attendance_snapshot JSONB,
  email_status  TEXT NOT NULL DEFAULT 'PENDING' CHECK (email_status IN ('PENDING','SENT','FAILED')),
  email_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  action      TEXT NOT NULL,
  actor_id    UUID REFERENCES users(id),
  actor_role  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  date_from   DATE NOT NULL,
  date_to     DATE NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  detail      TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_payslips_run ON payslips(run_id);
CREATE INDEX IF NOT EXISTS idx_payslips_emp ON payslips(employee_id);
CREATE INDEX IF NOT EXISTS idx_runs_company ON payroll_runs(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- ===== SaaS multi-tenant: membership + branding (idempotent migration) =====
ALTER TABLE companies ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS brand_color TEXT DEFAULT '#27406e';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS email_template TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'TRIAL';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS membership_status TEXT NOT NULL DEFAULT 'TRIAL';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS membership_expires_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS employee_limit INTEGER NOT NULL DEFAULT 15;
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug) WHERE slug IS NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('HR_ADMIN','FINANCE','MANAGER','EMPLOYEE','SUPER_ADMIN'));

CREATE TABLE IF NOT EXISTS payroll_schedules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cadence      TEXT NOT NULL DEFAULT 'SEMIMONTHLY',
  day_of_month INTEGER,
  auto_email   BOOLEAN NOT NULL DEFAULT true,
  enabled      BOOLEAN NOT NULL DEFAULT false,
  last_run_at  TIMESTAMPTZ,
  next_run_on  DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedules_company ON payroll_schedules(company_id);

-- Per-company outgoing email (SMTP) settings. Each tenant sends payslips from
-- its own mailbox; password is stored encrypted (AES-256-GCM).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS smtp_host TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS smtp_port INTEGER;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS smtp_user TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS smtp_pass_enc TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS smtp_from TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS smtp_secure BOOLEAN;
