# Production readiness checklist — PayrollPro

This codebase is a solid, working foundation. Before it runs **real** payroll for real people, the following must be completed. Items are grouped by risk. Do not skip the 🔴 items.

## 🔴 Compliance & accuracy (legal/financial risk)
- [ ] Have a **licensed PH accountant / payroll specialist** validate every figure in `src/payroll/tables.js` against the **current** SSS, PhilHealth, Pag-IBIG, and BIR (TRAIN) schedules. These change — wire them to a versioned, dated config and re-verify each effectivity.
- [ ] Confirm semi-monthly vs monthly contribution timing matches your company policy and agency rules.
- [ ] Implement annualized tax + **year-end alphalist (BIR 1604-C / 2316)** and monthly **1601-C** remittance exports.
- [ ] Validate 13th-month pay, final pay, and de minimis / non-taxable thresholds.
- [ ] Register data processing & appoint a DPO per the **Data Privacy Act (RA 10173)**; document retention and consent.
- [ ] Parallel-run against your current/manual payroll for at least 2–3 cycles and reconcile to the centavo.

## 🔴 Security
- [ ] Generate strong, unique `JWT_*` secrets and a real 32-byte `FIELD_ENCRYPTION_KEY`; store in a secrets manager (not `.env` in git).
- [ ] Manage the encryption key in a KMS/HSM and implement **key rotation** + re-encryption.
- [ ] Enforce TLS everywhere; set HSTS; put the API behind a WAF.
- [ ] Add account lockout / progressive backoff and CAPTCHA on auth (rate limiting is included but not sufficient alone).
- [ ] Move refresh tokens to httpOnly secure cookies or a server-side token store with revocation.
- [ ] Add automated dependency scanning (Dependabot/Snyk) and a SAST step in CI.
- [ ] Commission an independent **penetration test** before go-live.
- [ ] Encrypt database storage at rest and restrict network access to the DB.

## 🔴 Data integrity
- [ ] Add DB backups with point-in-time recovery; test restores.
- [ ] Make payroll runs immutable once RELEASED; store computed slips as the source of truth (already persisted as JSONB).
- [ ] Add optimistic locking / idempotency keys so a run can’t be built or released twice.

## 🟠 Scale & performance (10k+ employees)
- [ ] Move run-building and bulk email to a **background job queue** (BullMQ + Redis) with progress + retries.
- [ ] Batch DB writes (`COPY` / multi-row inserts) instead of per-employee inserts in the run builder.
- [ ] Add pagination to all list endpoints.
- [ ] Add read replicas / connection pooling (PgBouncer) under load.
- [ ] Load-test a 10k-employee run end to end.

## 🟠 Integrations (need real credentials/contracts — you must supply)
- [ ] SMTP / Microsoft 365 / Google Workspace for delivery (Nodemailer transport is wired; add OAuth where needed).
- [ ] Banking disbursement API (BDO/BPI/InstaPay/PESONet) — replace the CSV bank-file with the bank’s real format + secure submission.
- [ ] Biometric / attendance device sync (SDK or scheduled import).
- [ ] HRIS / accounting (e.g. QuickBooks/Xero) GL export.
- [ ] BIR/SSS/PhilHealth/Pag-IBIG e-filing where APIs exist.

## 🟢 Engineering quality
- [ ] Expand test coverage to routes (supertest) and add integration tests against a test DB.
- [ ] Add CI/CD (lint + test + build + migrate-on-deploy as a separate job).
- [ ] Centralized log aggregation, metrics, and alerting (e.g. OpenTelemetry + Grafana).
- [ ] Error tracking (Sentry).
- [ ] API documentation (OpenAPI/Swagger).
- [ ] Build the frontend SPA (the included single-file prototype demonstrates the intended UX and can call this API).

## 🟢 Operations
- [ ] Runbooks for failed payroll, failed email batches, and rollback.
- [ ] Staging environment mirroring production.
- [ ] Disaster-recovery plan with RTO/RPO targets.

---
**Bottom line:** the calculation engine, RBAC, workflow, encryption, and APIs are real and runnable today. “Ready for real life” additionally requires the compliance sign-off, security hardening, real integration credentials, and scale work above — most of which depend on your company’s accounts, contracts, and a professional review that can’t be done from code alone.
