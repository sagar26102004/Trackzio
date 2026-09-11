import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing with scrypt.
 *
 * scrypt rather than bcrypt because it ships in Node's standard library - no native
 * module, so nothing to compile on Windows and one less dependency to keep patched.
 * It is also memory-hard, which makes GPU cracking meaningfully more expensive than
 * bcrypt at comparable settings.
 *
 * The parameters are stored alongside the hash rather than hardcoded at the
 * comparison site. That means these values can be raised later as hardware improves
 * and old hashes still verify - without it, changing the cost would lock every
 * existing user out of their account.
 */
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SCRYPT_COST = 16_384; // N - CPU/memory cost. 2^14.
const SCRYPT_BLOCK_SIZE = 8; // r
const SCRYPT_PARALLELISM = 1; // p

/** Format: scrypt$N$r$p$<salt base64url>$<hash base64url> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return [
    'scrypt',
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELISM,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed stored value: a corrupt row
 * should fail the login, not 500 the endpoint.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, , , , saltPart, hashPart] = parts;
  if (!saltPart || !hashPart) return false;

  try {
    const salt = Buffer.from(saltPart, 'base64url');
    const expected = Buffer.from(hashPart, 'base64url');
    const derived = await scrypt(password, salt, expected.length);

    // Length check first: timingSafeEqual throws on a length mismatch, and comparing
    // lengths leaks nothing an attacker cannot already see in the stored format.
    if (derived.length !== expected.length) return false;

    // Constant-time. A plain === would return faster on an early-mismatching
    // password, which over many attempts leaks the hash a byte at a time.
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
