import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import employeeRoutes from './routes/employees.js';
import attendanceRoutes from './routes/attendance.js';
import payrollRoutes from './routes/payroll.js';
import payslipRoutes from './routes/payslips.js';
import reportRoutes from './routes/reports.js';
import miscRoutes from './routes/misc.js';
import companyRoutes from './routes/company.js';
import adminRoutes from './routes/admin.js';
import { authenticate, requireActiveMembership } from './auth/middleware.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','), credentials: true }));
  app.use(express.json({ limit: '5mb' }));
  app.use(pinoHttp({ level: config.isProd ? 'info' : 'warn' }));
  app.set('trust proxy', 1);

  // Global rate limit; auth endpoints get a stricter limiter.
  app.use('/api/', rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

  app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

  // Public auth (login/signup/refresh) + account + owner console: NOT membership-gated.
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/company', companyRoutes);
  app.use('/api/admin', adminRoutes);

  // Operational routes — require an active company membership.
  const gate = [authenticate, requireActiveMembership];
  app.use('/api/employees', gate, employeeRoutes);
  app.use('/api/attendance', gate, attendanceRoutes);
  app.use('/api/payroll', gate, payrollRoutes);
  app.use('/api/payslips', gate, payslipRoutes);
  app.use('/api/reports', gate, reportRoutes);
  app.use('/api', gate, miscRoutes);

  // 404
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    req.log?.error(err);
    const status = err.status || 500;
    res.status(status).json({ error: config.isProd && status === 500 ? 'Internal server error' : err.message });
  });

  return app;
}
