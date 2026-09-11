import type { CookieOptions } from 'express';
import { env } from '../config/env.js';

/**
 * One definition of how our cookies are flagged, shared by the device cookie and
 * the session cookie. They had drifted into two copies, and a mismatch between the
 * flags used to SET a cookie and those used to CLEAR it is a real bug class: the
 * browser treats them as different cookies and logout silently does nothing.
 *
 * SameSite deserves the explanation:
 *
 *   lax  (default)  correct when the SPA and API share an origin - which is what
 *                   serving the API as a function under /api gives us in
 *                   production, and what localhost gives us in development. The
 *                   cookie is first-party, so Safari, Brave and Firefox all keep it.
 *
 *   none            only if the API is deployed on a genuinely different site from
 *                   the frontend. Browsers require Secure alongside it, and Safari
 *                   and Brave block such cookies outright - meaning login appears
 *                   to succeed and the user is immediately signed out again.
 *
 * The default is deliberately the safe one. Choosing `none` is opting into a known
 * broken experience for a chunk of users, so it has to be done explicitly.
 */
export function baseCookieOptions(): CookieOptions {
  return {
    signed: true,
    httpOnly: true,
    sameSite: env.COOKIE_SAMESITE,
    // SameSite=None is invalid without Secure, so force it on in that case even if
    // someone misconfigures the environment.
    secure: env.isProduction || env.COOKIE_SAMESITE === 'none',
    path: '/',
  };
}
