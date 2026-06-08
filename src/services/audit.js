import { query } from '../db.js';

export async function audit(req, action, detail) {
  try {
    await query(
      'INSERT INTO audit_log (actor_id, actor_role, action, detail, ip) VALUES ($1,$2,$3,$4,$5)',
      [req?.user?.sub || null, req?.user?.role || null, action, detail || null, req?.ip || null],
    );
  } catch (e) {
    // Audit must never break the request path; log and continue.
    console.error('[audit] failed:', e.message);
  }
}
