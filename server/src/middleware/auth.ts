import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { resolveSession, SESSION_TTL_MS, type PublicUser } from '../services/authService.js';
import { AppError, ErrorCode } from './errors.js';

export const SESSION_COOKIE = 'tz_sid';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
      sessionToken?: string;
    }
  }
}

/** One definition of the cookie's flags, so login and logout can never disagree. */
function sessionCookieOptions() {
  return {
    signed: true as const,
    httpOnly: true as const,
    // In production the SPA and API are different origins, which requires
    // SameSite=None - and browsers only accept that alongside Secure.
    sameSite: env.isProduction ? ('none' as const) : ('lax' as const),
    secure: env.isProduction,
    path: '/',
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions(), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response): void {
  // Same flags as when it was set: a mismatch on path or sameSite leaves the
  // original cookie in place and logout silently does nothing.
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}

/**
 * Populates req.user when a valid session cookie is present.
 *
 * Deliberately non-blocking: an anonymous visitor is a first-class case here, not
 * an error. Browsing and the anonymous wishlist must keep working signed out, so
 * this attaches identity when it exists and otherwise moves on.
 */
export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.signedCookies?.[SESSION_COOKIE];

  if (typeof token !== 'string' || token.length === 0) return next();

  try {
    const user = await resolveSession(token);
    if (user) {
      req.user = user;
      req.sessionToken = token;
    }
  } catch (error) {
    // A database blip must not log everyone out mid-session; treat as anonymous
    // and let the request continue rather than failing it outright.
    logger.error({ err: error }, 'Failed to resolve session; continuing as anonymous');
  }

  next();
}

/** Guards the endpoints that genuinely require an account. */
export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    return next(new AppError(ErrorCode.VALIDATION_FAILED, 'You need to be signed in to do that.', 401));
  }
  next();
}

/**
 * Who owns the wishlist for this request.
 *
 * A signed-in user's account always wins over the device cookie, so the same
 * browser shows the account's list once logged in and the anonymous list again
 * after logging out.
 */
export function wishlistOwner(req: Request): { userId: string } | { deviceId: string } {
  return req.user ? { userId: req.user.id } : { deviceId: req.deviceId };
}
