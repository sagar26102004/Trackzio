import type { IncomingMessage, ServerResponse } from 'node:http';
import { sweepExpiredEntries } from '../server/dist/cache/index.js';
import { sweepExpiredSessions } from '../server/dist/services/authService.js';

/**
 * Housekeeping, triggered by Vercel Cron (see vercel.json).
 *
 * On a long-lived server this ran on a setInterval. Serverless has no process to
 * hold a timer, so the schedule moves outside the application. Without it the
 * cache table grows a row for every filter combination anyone ever tried, and
 * expired sessions accumulate forever.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Vercel signs cron invocations with this header. Checking it stops anyone from
  // hitting the endpoint directly and forcing repeated table scans.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  const [cacheEntries, sessions] = await Promise.all([sweepExpiredEntries(), sweepExpiredSessions()]);

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ swept: { cacheEntries, sessions } }));
}
