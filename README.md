# PayrollPro — Philippine Payroll Management System (Backend + API)

A production-oriented full-stack foundation for PH payroll: Node.js + Express + PostgreSQL, JWT auth with role-based access control and TOTP 2FA, AES-256-GCM field-level encryption for PII, a unit-tested payroll engine (SSS / PhilHealth / Pag-IBIG / BIR withholding), an approval workflow, PDF payslips, and bulk email.

> ⚠️ **Read `PRODUCTION-CHECKLIST.md` before running real payroll.** This is a deployable foundation, not a certified payroll product. Statutory tables, security, and integrations must be validated by qualified professionals.

## Stack

- **Runtime:** Node.js ≥ 20 (ESM)
- **API:** Express 4, Helmet, CORS, rate limiting, Pino logging
- **DB:** PostgreSQL 16 (via `pg`), SQL migrations
- **Auth:** JWT access/refresh, bcrypt password hashing, otplib TOTP 2FA, RBAC
- **Payroll:** pure-function engine in `src/payroll/` (fully unit-tested)
- **Docs:** PDF payslips via PDFKit, email via Nodemailer (SMTP)

## Quick start (Docker — recommended)

```bash
cp .env.example .env          # then edit secrets
docker compose up --build
# API on http://localhost:4000  (migrates + seeds automatically)
```

## Quick start (local)

```bash
npm install
cp .env.example .env          # point DATABASE_URL at your Postgres
npm run migrate
npm run seed
npm start
```

## Test

```bash
npm test                      # runs the payroll engine unit tests
```

## Seeded logins (change immediately)

| Role      | Email              | Password       |
|-----------|--------------------|----------------|
| HR Admin  | admin@acme.ph      | ChangeMe!2024  |
| Finance   | finance@acme.ph    | ChangeMe!2024  |
| Manager   | manager@acme.ph    | ChangeMe!2024  |
| Employee  | employee@acme.ph   | ChangeMe!2024  |

## API overview

All routes (except `/health` and `/api/auth/*`) require `Authorization: Bearer <accessToken>`.

### Auth
- `POST /api/auth/login` → `{ accessToken, refreshToken, user }` (send `totp` when 2FA enabled)
- `POST /api/auth/refresh`
- `GET  /api/auth/me`
- `POST /api/auth/2fa/setup` → `{ otpauthUrl }` then `POST /api/auth/2fa/enable`

### Employees (HR for writes)
- `GET/POST /api/employees`, `GET/PUT /api/employees/:id`, `POST /api/employees/:id/offboard`

### Attendance
- `GET/POST /api/attendance`, `POST /api/attendance/bulk`, `POST /api/attendance/:id/approve-ot`

### Payroll workflow
- `POST /api/payroll` (build run), `GET /api/payroll`, `GET /api/payroll/:id`
- `GET  /api/payroll/:id/validate` (AI anomaly checks)
- `POST /api/payroll/:id/advance` (Preparation → HR Review → Finance → Approved → Released)
- `POST /api/payroll/:id/reject`

### Payslips
- `GET  /api/payslips/mine` (self-service)
- `GET  /api/payslips/:id/pdf`
- `POST /api/payslips/run/:runId/email`, `POST /api/payslips/run/:runId/resend-failed`

### Reports
- `GET /api/reports/run/:runId/summary`
- `GET /api/reports/run/:runId/government?format=csv`
- `GET /api/reports/run/:runId/bank-file`
- `GET /api/reports/cost-analysis`

### Dashboard / misc
- `GET /api/dashboard`, departments, leave requests, `GET /api/audit`

## Example: log in and build a payroll run

```bash
TOKEN=$(curl -s localhost:4000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@acme.ph","password":"ChangeMe!2024"}' | jq -r .accessToken)

curl -s localhost:4000/api/payroll -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"period_label":"Jun 1-15 2026"}'
```

## Architecture notes

- **Engine is pure & tested** so calculations can be audited independently of the DB.
- **PII encrypted at rest** (TIN, bank, gov't IDs) with AES-256-GCM; keys come from env, never committed.
- **RBAC + audit log** on every sensitive action.
- **Workflow is a state machine** with role-gated transitions and an approval trail.
- For 10k+ employees, move bulk email + run building to a **job queue** (e.g. BullMQ/Redis) — see the production checklist.

See `PRODUCTION-CHECKLIST.md` for the full go-live requirements (compliance, security, scaling, integrations).
