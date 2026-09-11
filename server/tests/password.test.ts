import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { RateLimiter } from '../src/lib/rateLimiter.js';

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('Correct horse battery staple', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('never stores the password itself', async () => {
    const password = 'super-secret-password';
    const hash = await hashPassword(password);
    // The whole point: a database dump must not hand over the plaintext.
    expect(hash).not.toContain(password);
  });

  it('produces a different hash every time, so equal passwords are not detectable', async () => {
    // Distinct salts mean two users with the same password get different rows -
    // otherwise the table leaks which accounts share a password.
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(a).not.toBe(b);
    await expect(verifyPassword('same-password', a)).resolves.toBe(true);
    await expect(verifyPassword('same-password', b)).resolves.toBe(true);
  });

  it('records its parameters so the cost can be raised later without locking users out', async () => {
    const hash = await hashPassword('x');
    const [algorithm, cost, blockSize, parallelism] = hash.split('$');
    expect(algorithm).toBe('scrypt');
    expect(Number(cost)).toBeGreaterThanOrEqual(16_384);
    expect(Number(blockSize)).toBe(8);
    expect(Number(parallelism)).toBe(1);
    expect(hash.split('$')).toHaveLength(6);
  });

  it('returns false rather than throwing on a corrupt stored hash', async () => {
    // A malformed row should fail the login, not 500 the endpoint.
    for (const bad of ['', 'not-a-hash', 'scrypt$1$2$3', 'bcrypt$16384$8$1$aaaa$bbbb', '$$$$$']) {
      await expect(verifyPassword('anything', bad)).resolves.toBe(false);
    }
  });

  it('handles unicode and very long passwords', async () => {
    const password = 'pässwörd-🎬-' + 'x'.repeat(50);
    const hash = await hashPassword(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
  });
});

describe('RateLimiter', () => {
  it('allows attempts up to the limit and then blocks', () => {
    const limiter = new RateLimiter(3, 60_000);

    for (let i = 0; i < 3; i += 1) {
      expect(limiter.check('user@example.com').allowed).toBe(true);
      limiter.recordFailure('user@example.com');
    }

    const blocked = limiter.check('user@example.com');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keeps budgets separate per key', () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.recordFailure('a@example.com');

    // One account being attacked must not lock everyone else out.
    expect(limiter.check('a@example.com').allowed).toBe(false);
    expect(limiter.check('b@example.com').allowed).toBe(true);
  });

  it('clears the budget on success', () => {
    const limiter = new RateLimiter(2, 60_000);
    limiter.recordFailure('user@example.com');
    limiter.recordFailure('user@example.com');
    expect(limiter.check('user@example.com').allowed).toBe(false);

    // A genuine user who mistypes then gets it right is back to full allowance.
    limiter.reset('user@example.com');
    expect(limiter.check('user@example.com').allowed).toBe(true);
  });

  it('only counts failures, so repeated successes never lock an account', () => {
    const limiter = new RateLimiter(2, 60_000);
    for (let i = 0; i < 50; i += 1) expect(limiter.check('user@example.com').allowed).toBe(true);
  });
});
