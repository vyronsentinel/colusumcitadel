import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter;
function getTransport() {
  if (transporter) return transporter;
  if (config.smtp.host) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  } else {
    // Dev fallback: stream transport prints emails to stdout instead of sending.
    transporter = nodemailer.createTransport({ streamTransport: true, newline: 'unix', buffer: true });
  }
  return transporter;
}

/**
 * Send a payslip email with a PDF attachment.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function sendPayslipEmail({ to, name, period, net, pdfBuffer, slipNo, template }) {
  const body = (template || 'Hi {name},\n\nPlease find attached your payslip for {period}. Net pay: {net}.\n\nRegards,\nHR')
    .replaceAll('{name}', name)
    .replaceAll('{period}', period)
    .replaceAll('{net}', net);
  try {
    await getTransport().sendMail({
      from: config.smtp.from,
      to,
      subject: `Payslip ${slipNo} — ${period}`,
      text: body,
      attachments: pdfBuffer ? [{ filename: `${slipNo}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }] : [],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
