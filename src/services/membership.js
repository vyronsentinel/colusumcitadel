// Compute a company's membership state from its stored status + expiry.
// Returns { active, status, reason, daysLeft, expiresAt }.
export function membershipState(company) {
  if (!company) return { active: false, status: 'NONE', reason: 'No membership found for this account.', daysLeft: null };
  const status = company.membership_status || 'TRIAL';
  const exp = company.membership_expires_at ? new Date(company.membership_expires_at) : null;
  const expired = exp ? exp.getTime() < Date.now() : false;
  const daysLeft = exp ? Math.ceil((exp.getTime() - Date.now()) / 86400000) : null;
  if (status === 'SUSPENDED') {
    return { active: false, status, reason: 'Your membership is suspended. Please contact your provider to reactivate.', daysLeft, expiresAt: exp };
  }
  if (status === 'EXPIRED' || expired) {
    return { active: false, status: 'EXPIRED', reason: 'Your membership has expired. Renew to regain access.', daysLeft, expiresAt: exp };
  }
  if (status === 'TRIAL' || status === 'ACTIVE') {
    return { active: true, status, reason: null, daysLeft, expiresAt: exp };
  }
  return { active: false, status, reason: 'Your membership is inactive.', daysLeft, expiresAt: exp };
}
