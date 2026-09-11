import { createHash, randomBytes } from 'node:crypto';
import { logger } from '../lib/logger.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import { AppError, ErrorCode } from '../middleware/errors.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

function toPublicUser(user: { id: string; name: string; email: string; createdAt: Date }): PublicUser {
  // Whitelist, not blacklist. Returning the row and deleting passwordHash would
  // leak any sensitive column added later; this way new columns are private by
  // default and have to be opted in.
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt.toISOString() };
}

/** Emails are matched case-insensitively, so they are normalised on the way in. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The cookie carries a raw 256-bit token; the database stores only its SHA-256.
 * Plain SHA-256 (not scrypt) is correct here: the token is already high-entropy
 * random, so there is nothing to brute-force and no need to slow verification down.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });

  return { token, expiresAt };
}

/** Resolves a raw cookie token to its user, or null. Expired rows are cleaned up. */
export async function resolveSession(token: string): Promise<PublicUser | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return toPublicUser(session.user);
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/**
 * Moves this device's anonymous wishlist into the account.
 *
 * Without this, saving a few films and then registering would silently lose them -
 * the worst possible first impression of an account system. Items the user already
 * has are dropped rather than duplicated, and the operation is a no-op for a device
 * with an empty list.
 */
export async function claimDeviceWishlist(deviceId: string, userId: string): Promise<number> {
  const [deviceItems, existing] = await Promise.all([
    prisma.wishlistItem.findMany({ where: { deviceId } }),
    prisma.wishlistItem.findMany({ where: { userId }, select: { movieId: true } }),
  ]);

  if (deviceItems.length === 0) return 0;

  const alreadySaved = new Set(existing.map((item) => item.movieId));
  const toClaim = deviceItems.filter((item) => !alreadySaved.has(item.movieId));
  const duplicateIds = deviceItems.filter((item) => alreadySaved.has(item.movieId)).map((item) => item.id);

  // One transaction: the user should never observe a half-migrated list.
  await prisma.$transaction([
    ...toClaim.map((item) =>
      prisma.wishlistItem.update({
        where: { id: item.id },
        // Ownership moves rather than being copied - deviceId is cleared so the row
        // has exactly one owner and cannot show up in both lists.
        data: { userId, deviceId: null },
      }),
    ),
    prisma.wishlistItem.deleteMany({ where: { id: { in: duplicateIds } } }),
  ]);

  if (toClaim.length > 0) logger.info({ userId, claimed: toClaim.length }, 'Claimed anonymous wishlist');
  return toClaim.length;
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
  deviceId: string;
}): Promise<PublicUser> {
  const email = normaliseEmail(input.email);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'An account with that email already exists.', 409);
  }

  const user = await prisma.user.create({
    data: { name: input.name.trim(), email, passwordHash: await hashPassword(input.password) },
  });

  await claimDeviceWishlist(input.deviceId, user.id);

  return toPublicUser(user);
}

export async function authenticate(input: {
  email: string;
  password: string;
  deviceId: string;
}): Promise<PublicUser> {
  const email = normaliseEmail(input.email);
  const user = await prisma.user.findUnique({ where: { email } });

  /**
   * Deliberately identical failure for "no such email" and "wrong password".
   * Distinguishing them turns the login form into an account-enumeration oracle:
   * an attacker could confirm which emails are registered before targeting them.
   *
   * The dummy hash on the missing-user path matters too - without it the request
   * returns measurably faster for an unknown email, leaking the same fact through
   * timing instead of wording.
   */
  if (!user) {
    await verifyPassword(input.password, DUMMY_HASH);
    throw invalidCredentials();
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw invalidCredentials();
  }

  await claimDeviceWishlist(input.deviceId, user.id);

  return toPublicUser(user);
}

function invalidCredentials(): AppError {
  return new AppError(ErrorCode.VALIDATION_FAILED, 'Incorrect email or password.', 401);
}

/**
 * A real scrypt hash of a random value, computed once at startup, so the
 * missing-user path does the same work as the found-user path.
 */
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

export async function changePassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  keepSessionToken: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) throw AppError.notFound('Account not found.');

  // Requiring the current password is what stops someone who walks up to an
  // unlocked laptop from taking the account over permanently.
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Your current password is incorrect.', 401);
  }

  if (input.currentPassword === input.newPassword) {
    throw AppError.validation('Your new password must be different from your current one.');
  }

  const passwordHash = await hashPassword(input.newPassword);
  const keepTokenHash = createHash('sha256').update(input.keepSessionToken).digest('hex');

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    // Changing a password is how a user responds to "someone else has my password".
    // If other sessions survived it, the change would achieve nothing - so every
    // session except the one making the request is revoked.
    prisma.session.deleteMany({ where: { userId: user.id, tokenHash: { not: keepTokenHash } } }),
  ]);

  logger.info({ userId: user.id }, 'Password changed; other sessions revoked');
}

/** Housekeeping: expired sessions are dead weight and should not accumulate. */
export async function sweepExpiredSessions(): Promise<number> {
  try {
    const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if (count > 0) logger.info({ count }, 'Swept expired sessions');
    return count;
  } catch (error) {
    logger.error({ err: error }, 'Session sweep failed');
    return 0;
  }
}
