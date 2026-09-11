import { Router } from 'express';
import { z } from 'zod';
import { RateLimiter } from '../lib/rateLimiter.js';
import { clearSessionCookie, requireUser, setSessionCookie } from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';
import {
  authenticate,
  changePassword,
  createSession,
  destroySession,
  normaliseEmail,
  registerUser,
} from '../services/authService.js';

export const authRouter = Router();

/**
 * Password rules, kept to the one that actually matters: length.
 *
 * Composition rules ("must contain a symbol") push people towards `Passw0rd!` -
 * predictable to a cracker, hard for a human. Length is the property that makes a
 * password expensive to guess, so that is what we require. 72 is an upper bound to
 * stop a megabyte of text being fed into the hash as a cheap DoS.
 */
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.');

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80),
  email: emailSchema,
  password: passwordSchema,
});

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Password is required.') });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: passwordSchema,
});

// Two budgets, because they protect against different things. Per-email stops one
// account being ground down; per-IP stops one attacker spraying many accounts.
const loginLimiterByEmail = new RateLimiter(8, 15 * 60 * 1000);
const loginLimiterByIp = new RateLimiter(40, 15 * 60 * 1000);
const signupLimiterByIp = new RateLimiter(10, 60 * 60 * 1000);

function clientIp(req: { ip?: string }): string {
  return req.ip ?? 'unknown';
}

authRouter.post('/auth/signup', async (req, res) => {
  const ip = clientIp(req);
  const ipCheck = signupLimiterByIp.check(ip);
  if (!ipCheck.allowed) throw AppError.rateLimited(ipCheck.retryAfterSeconds);

  const input = signupSchema.parse(req.body);

  try {
    const user = await registerUser({ ...input, deviceId: req.deviceId });
    const { token } = await createSession(user.id);
    setSessionCookie(res, token);

    res.setHeader('Cache-Control', 'private, no-store');
    res.status(201).json({ user });
  } catch (error) {
    signupLimiterByIp.recordFailure(ip);
    throw error;
  }
});

authRouter.post('/auth/login', async (req, res) => {
  const ip = clientIp(req);
  const input = loginSchema.parse(req.body);
  const emailKey = normaliseEmail(input.email);

  const emailCheck = loginLimiterByEmail.check(emailKey);
  const ipCheck = loginLimiterByIp.check(ip);
  if (!emailCheck.allowed) throw AppError.rateLimited(emailCheck.retryAfterSeconds);
  if (!ipCheck.allowed) throw AppError.rateLimited(ipCheck.retryAfterSeconds);

  try {
    const user = await authenticate({ ...input, deviceId: req.deviceId });

    // Only successes clear the budget, so a genuine user who mistypes a few times
    // is back to full allowance the moment they get it right.
    loginLimiterByEmail.reset(emailKey);

    const { token } = await createSession(user.id);
    setSessionCookie(res, token);

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ user });
  } catch (error) {
    loginLimiterByEmail.recordFailure(emailKey);
    loginLimiterByIp.recordFailure(ip);
    throw error;
  }
});

authRouter.post('/auth/logout', async (req, res) => {
  if (req.sessionToken) await destroySession(req.sessionToken);

  // Cleared regardless, so a stale or already-revoked token cannot leave the
  // browser stuck in a half-logged-in state it cannot escape.
  clearSessionCookie(res);

  res.setHeader('Cache-Control', 'private, no-store');
  res.status(204).end();
});

/** Who am I? Returns 200 with a null user when signed out - not an error. */
authRouter.get('/auth/me', (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ user: req.user ?? null });
});

authRouter.patch('/auth/password', requireUser, async (req, res) => {
  const input = changePasswordSchema.parse(req.body);

  await changePassword({
    userId: req.user!.id,
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    // This session survives; every other one is revoked.
    keepSessionToken: req.sessionToken!,
  });

  res.setHeader('Cache-Control', 'private, no-store');
  res.status(204).end();
});
