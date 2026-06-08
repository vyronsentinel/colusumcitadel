import 'dotenv/config';

function req(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  databaseUrl: req('DATABASE_URL', 'postgres://payroll:payroll@localhost:5432/payrollpro'),
  jwt: {
    accessSecret: req('JWT_ACCESS_SECRET', 'dev-access-secret'),
    refreshSecret: req('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },
  fieldEncryptionKey: req('FIELD_ENCRYPTION_KEY', '0'.repeat(64)),
  totpIssuer: process.env.TOTP_ISSUER || 'PayrollPro',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'PayrollPro HR <hr@example.com>',
  },
  corsOrigin: process.env.CORS_ORIGIN || '*',
  bootstrap: {
    adminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@acme.ph',
    adminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe!2024',
  },
  isProd: (process.env.NODE_ENV || 'development') === 'production',
};
