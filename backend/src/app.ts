import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './env';
import authRoutes from './routes/auth';
import grantRoutes from './routes/grants';
import applicationRoutes from './routes/applications';
import uploadRoutes from './routes/uploads';
import reviewRoutes from './routes/reviews';
import notificationRoutes from './routes/notifications';
import userRoutes from './routes/users';
import statsRoutes from './routes/stats';
import { errorHandler, notFoundHandler } from './middleware/error';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.allowedOrigins.includes(origin) || !env.isProduction) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  if (!env.isProduction) app.use(morgan('dev'));

  app.get('/health', (_req, res) => res.json({ ok: true, env: env.nodeEnv, time: new Date().toISOString() }));

  app.use('/auth', authRoutes);
  app.use('/grants', grantRoutes);
  app.use('/applications', applicationRoutes);
  app.use('/uploads', uploadRoutes);
  app.use('/reviews', reviewRoutes);
  app.use('/notifications', notificationRoutes);
  app.use('/users', userRoutes);
  app.use('/stats', statsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
