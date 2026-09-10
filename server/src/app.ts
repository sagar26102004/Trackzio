import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { cacheMetrics } from './cache/index.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { deviceSession } from './middleware/session.js';
import { moviesRouter } from './routes/movies.js';
import { wishlistRouter } from './routes/wishlist.js';
import { tmdbBreakerState } from './tmdb/client.js';

export function createApp() {
  const app = express();

  // We sit behind Render's proxy in production; without this, `secure` cookies are
  // never set because Express thinks the connection is plain HTTP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      // Successful requests are noise at info level; failures are what we want.
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'debug';
      },
    }),
  );

  app.use(
    cors({
      // An explicit allowlist rather than reflecting any Origin: `credentials: true`
      // plus a wildcard origin is exactly the combination browsers reject, and
      // reflecting arbitrary origins would let any site read a user's wishlist.
      origin: env.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      exposedHeaders: ['X-Cache'],
    }),
  );

  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser(env.SESSION_SECRET));
  app.use(deviceSession);

  /**
   * Health endpoint that reports something worth knowing. A bare `{ok:true}` tells
   * you the process is up but not whether it can actually serve anything, so this
   * surfaces the breaker state and cache effectiveness too.
   */
  app.get('/api/health', (_req, res) => {
    const breaker = tmdbBreakerState();
    res.json({
      status: breaker === 'open' ? 'degraded' : 'ok',
      upstream: { circuit: breaker },
      cache: cacheMetrics(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.use('/api', moviesRouter);
  app.use('/api', wishlistRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
