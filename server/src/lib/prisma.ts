import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * One PrismaClient for the process. Creating a client per request exhausts the
 * connection pool almost immediately; `tsx watch` also re-imports modules on every
 * save, so in development we stash the instance on globalThis to avoid leaking a
 * new pool on each reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!env.isProduction) globalForPrisma.prisma = prisma;

export async function disconnectPrisma(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch (error) {
    logger.error({ err: error }, 'Failed to disconnect Prisma cleanly');
  }
}
