import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { authenticate, authorize, asyncH } from '../auth/middleware.js';
import { audit } from '../services/audit.js';

const router = Router();
router.use(authenticate);

const attSchema = z.object({
  employee_id: z.string().uuid(),
  period_start: z.string(),
  period_end: z.string(),
  days_present: z.number().default(0),
  late_min: z.number().int().default(0),
  undertime_min: z.number().int().default(0),
  ot_hours: z.number().default(0),
  night_hours: z.number().default(0),
  absences: z.number().default(0),
  leave_days: z.number().default(0),
  reg_holiday_days: z.number().default(0),
  spec_holiday_days: z.number().default(0),
});

router.get('/', authorize('HR_ADMIN', 'MANAGER', 'FINANCE'), asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT a.* FROM attendance a JOIN employees e ON e.id=a.employee_id
     WHERE e.company_id=$1 ORDER BY a.period_end DESC LIMIT 1000`, [req.user.companyId],
  );
  res.json(rows);
}));

// Upsert a DTR row for a cutoff.
router.post('/', authorize('HR_ADMIN', 'MANAGER'), asyncH(async (req, res) => {
  const p = attSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Invalid payload', details: p.error.flatten() });
  const d = p.data;
  const { rows } = await query(
    `INSERT INTO attendance (employee_id, period_start, period_end, days_present, late_min, undertime_min,
        ot_hours, night_hours, absences, leave_days, reg_holiday_days, spec_holiday_days)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [d.employee_id, d.period_start, d.period_end, d.days_present, d.late_min, d.undertime_min,
      d.ot_hours, d.night_hours, d.absences, d.leave_days, d.reg_holiday_days, d.spec_holiday_days],
  );
  res.status(201).json(rows[0]);
}));

// Bulk import (e.g. from biometric CSV parsed client-side or via a worker).
router.post('/bulk', authorize('HR_ADMIN'), asyncH(async (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  let inserted = 0;
  for (const r of records) {
    const p = attSchema.safeParse(r);
    if (!p.success) continue;
    const d = p.data;
    await query(
      `INSERT INTO attendance (employee_id, period_start, period_end, days_present, late_min, undertime_min,
          ot_hours, night_hours, absences, leave_days, reg_holiday_days, spec_holiday_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [d.employee_id, d.period_start, d.period_end, d.days_present, d.late_min, d.undertime_min,
        d.ot_hours, d.night_hours, d.absences, d.leave_days, d.reg_holiday_days, d.spec_holiday_days],
    );
    inserted++;
  }
  await audit(req, 'ATTENDANCE_IMPORT', `${inserted} rows`);
  res.json({ inserted });
}));

router.post('/:id/approve-ot', authorize('HR_ADMIN', 'MANAGER'), asyncH(async (req, res) => {
  const { rows } = await query('UPDATE attendance SET ot_approved=true WHERE id=$1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'OT_APPROVED', req.params.id);
  res.json(rows[0]);
}));

export default router;
