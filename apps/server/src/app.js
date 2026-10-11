import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createPublicRouter } from './routes/public.js';
import { createAuthRouter } from './routes/auth.js';
import { createNgoRouter } from './routes/ngo.js';
import { createProviderRouter } from './routes/provider.js';
import { createAdminRouter } from './routes/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp({ db, clock, jwtSecret, wsManager }) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Attach serverNow to every request
  app.use((req, res, next) => {
    req.serverNow = clock.now();
    next();
  });

  // API Routers
  const publicRouter = createPublicRouter({ db, clock, wsManager });
  const authRouter = createAuthRouter({ db, clock, jwtSecret });
  const ngoRouter = createNgoRouter({ db, clock, jwtSecret, wsManager });
  const providerRouter = createProviderRouter({ db, clock, jwtSecret, wsManager });
  const adminRouter = createAdminRouter({ db, clock, jwtSecret, wsManager });

  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/ngo', ngoRouter);
  app.use('/api/provider', providerRouter);
  app.use('/api/admin', adminRouter);

  // Exact Section 7 root paths: /api/health, /api/inbound/message, /api/trips/:id/*, /api/route-offers/:id/*
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/inbound/message') {
      return publicRouter(req, res, next);
    }
    if (req.path.startsWith('/trips') || req.path.startsWith('/route-offers')) {
      return ngoRouter(req, res, next);
    }
    next();
  });

  // Static web app serving
  const webDistPath = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
        return next();
      }
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  }

  // 404 handler for API routes
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'API endpoint not found' },
      serverNow: req.serverNow
    });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('[Unhandled Error]:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected error occurred' },
      serverNow: req.serverNow || clock.now()
    });
  });

  return app;
}
