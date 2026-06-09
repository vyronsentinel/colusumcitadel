import nodemailer from 'nodemailer';
import { config } from '../config.js';

// Resolve effective SMTP settings. A client's own SMTP config takes priority;
// otherwise we fall back to the platform-wide relay (e.g. Brevo) set via env.
// Returns null when nothing is configured at all, so callers can report it
// instead of silently dropping mail.
//
// `smtp.fromName` lets a client brand the sender (their company name) even when
// sending through the shared platform relay: we keep the verified platform
// address but swap the display name to the client's.
function resolveSmtp(smtp) {
  const ownHost = smtp && smtp.host;
  const host = ownHost || config.smtp.host;
  if (!host) return null;
  const port = Number((ownHost && smtp.port) || config.smtp.port || 587);
  const user = (ownHost && smtp.user) || config.smtp.user || '';
  const pass = (ownHost && smtp.pass != null && smtp.pass !== '') ? smtp.pass : config.smtp.pass;
  const secure = (ownHost && smtp.secure != null) ? !!smtp.secure : port === 465;
  let from;
  if (ownHost) {
    from = smtp.from || smtp.user || config.smtp.from;
  } else {
    // Shared platform relay: keep the verified global address, show client's name.
    const globalFrom = config.smtp.from || user;
    const name = smtp && smtp.fromName;
    if (name) {
      const m = String(globalFrom).match(/<([^>]+)>/);
      const email = m ? m[1] : globalFrom;
      from = name + ' <' + email + '>';
    } else {
      from = globalFrom;
    }
  }
  return { host, port, user, pass, secure, from };
}

// Reuse a transport per unique connection so bulk sends pool connections.
const cache = new Map();
function transportFor(r) {
  const key = `${r.host}:${r.port}:${r.user}:${r.secure}:${r.pass || ''}`;
  if (cache.has(key)) return cache.get(key);
  const t = nodemailer.createTransport({
    host: r.host,
    port: r.port,
    secure: r.secure,
    auth: r.user ? { user: r.user, pass: r.pass } : undefined,
  });
  cache.set(key, t);
  return t;
}

/**
 * Send a payslip email with a PDF attachment.
 * @param {object} args
 * @param {object} [args.smtp] - Mail settings { host?, port?, user?, pass?, from?, secure?, fromName? }.
 *   When host is omitted, the platform relay is used with fromName as the display name.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function sendPayslipEmail({ to, name, period, net, pdfBuffer, slipNo, template, smtp }) {
  const r = resolveSmtp(smtp);
  if (!r) return { ok: false, error: 'Email sending is not configured. Add your SMTP settings in Settings \u2192 Email, or set the platform relay.' };
  const body = (template || 'Hi {name},\n\nPlease find attached your payslip for {period}. Net pay: {net}.\n\nRegards,\nHR')
    .replaceAll('{name}', name)
    .replaceAll('{period}', period)
    .replaceAll('{net}', net);
  try {
    await transportFor(r).sendMail({
      from: r.from,
      to,
      subject: `Payslip ${slipNo} \u2014 ${period}`,
      text: body,
      attachments: pdfBuffer ? [{ filename: `${slipNo}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }] : [],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Send a simple test email to verify mail settings (own SMTP or platform relay).
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function sendTestEmail({ to, smtp, companyName }) {
  const r = resolveSmtp(smtp);
  if (!r) return { ok: false, error: 'Email sending is not configured yet.' };
  try {
    await transportFor(r).sendMail({
      from: r.from,
      to,
      subject: `Test email \u2014 ${companyName || 'Payroll'}`,
      text: 'This is a test message confirming your payroll email settings are working. If you received this, payslips will send successfully.',
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
