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
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

  app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/employees', employeeRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/payroll', payrollRoutes);
  app.use('/api/payslips', payslipRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api', miscRoutes);

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
