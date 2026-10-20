import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { errorHandler } from './middleware/errors';
import accountRoutes from './routes/accounts';
import userRoutes from './routes/users';
import planRoutes from './routes/plans';
import consumeRoutes from './routes/consume';
import usageRoutes from './routes/usage';

export function createApp(): express.Application {
  const app = express();

  // Security and performance middleware
  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API routes
  app.use('/api/accounts', accountRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/plans', planRoutes);
  app.use('/api/consume', consumeRoutes);
  app.use('/api/usage', usageRoutes);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
