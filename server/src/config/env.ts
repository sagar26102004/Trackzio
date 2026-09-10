import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment is validated once, at boot, and the process refuses to start if it
 * is wrong. A missing TMDB token should be a startup crash with a clear message,
 * not a mystery 500 on the first user request an hour later.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  TMDB_ACCESS_TOKEN: z.string().min(1, 'TMDB_ACCESS_TOKEN is required. Get one at https://www.themoviedb.org/settings/api'),
  TMDB_BASE_URL: z.string().url().default('https://api.themoviedb.org/3'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Only Prisma migrations read this, but validating it here means a broken
  // value is caught at boot rather than halfway through a deploy.
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required (Supabase session pooler)'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),

  // Comma-separated list of exact frontend origins allowed to send credentials.
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\nInvalid environment configuration:\n${issues}\n\nCopy .env.example to server/.env and fill it in.\n`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
} as const;

export type Env = typeof env;
