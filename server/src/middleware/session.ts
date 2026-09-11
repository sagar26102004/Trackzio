import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { baseCookieOptions } from '../lib/cookies.js';

export const DEVICE_COOKIE = 'tz_did';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      deviceId: string;
    }
  }
}

/**
 * Anonymous identity for the wishlist.
 *
 * The brief wants a wishlist that survives closing and reopening the app, but never
 * asks for accounts. A signed httpOnly cookie carrying an opaque device id gives us
 * exactly that with no signup friction, and - crucially - keeps the wishlist in
 * Postgres rather than localStorage, so it is real server-side persistence.
 *
 * Signed, so a client cannot hand us an arbitrary device id and read someone else's
 * list. httpOnly, so page scripts cannot read or exfiltrate it.
 *
 * Deliberately NO database write here. Creating a Device row for every request that
 * arrives without a cookie would let any crawler fill the table. The row is created
 * lazily on the first wishlist write instead.
 */
export function deviceSession(req: Request, res: Response, next: NextFunction): void {
  const existing = req.signedCookies?.[DEVICE_COOKIE];

  if (typeof existing === 'string' && existing.length > 0) {
    req.deviceId = existing;
    return next();
  }

  const deviceId = randomUUID();
  req.deviceId = deviceId;

  res.cookie(DEVICE_COOKIE, deviceId, { ...baseCookieOptions(), maxAge: ONE_YEAR_MS });

  next();
}
