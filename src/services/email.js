import nodemailer from 'nodemailer';
import { config } from '../config.js';

// Resolve effective SMTP settings: a per-company config takes priority, falling
// back to the platform-wide env config. Returns null when nothing is configured
// (so callers can report "not configured" instead of silently dropping mail).
function resolveSmtp(smtp) {
  const host = (smtp && smtp.host) || config.smtp.host;
  if (!host) return null;
  const port = Number((smtp && smtp.port) || config.smtp.port || 587);
  const user = (smtp && smtp.user) || config.smtp.user || '';
  const pass = (smtp && smtp.pass != null && smtp.pass !== '') ? smtp.pass : config.smtp.pass;
  const secure = (smtp && smtp.secure != null) ? !!smtp.secure : port === 465;
  const from = (smtp && smtp.from) || (smtp && smtp.user) || config.smtp.from;
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
 * @param {object} [args.smtp] - Per-company SMTP settings { host, port, user, pass, from, secure }.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function sendPayslipEmail({ to, name, period, net, pdfBuffer, slipNo, template, smtp }) {
  const r = resolveSmtp(smtp);
  if (!r) return { ok: false, error: 'Email sending is not configured. Add your SMTP settings in Settings \u2192 Email.' };
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
 * Send a simple test email to verify a company's SMTP settings.
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
