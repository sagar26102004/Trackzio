import { createApp } from './app.js';
import { sweepExpiredEntries } from './cache/index.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { sweepExpiredSessions } from './services/authService.js';
import { disconnectPrisma, prisma } from './lib/prisma.js';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

async function main() {
  // Fail fast and loudly if the database is unreachable, rather than starting up
  // and returning 500s to the first user who tries to open their wishlist.
  await prisma.$queryRaw`SELECT 1`;
  logger.info('Database connection established');

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  // The cache table would otherwise accumulate a row for every filter combination
  // anyone has ever tried. unref() so this timer never holds the process open.
  const sweeper = setInterval(() => {
    void sweepExpiredEntries();
    void sweepExpiredSessions();
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  /**
   * Graceful shutdown: stop accepting new connections, let in-flight requests
   * finish, then close the database pool. Without this, a deploy cuts active
   * requests mid-flight and can leave Postgres connections dangling.
   */
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    clearInterval(sweeper);

    const forced = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 10_000);
    forced.unref();

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectPrisma();
    clearTimeout(forced);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start the server');
  process.exit(1);
});
