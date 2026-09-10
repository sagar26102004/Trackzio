import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';

/**
 * Stable, machine-readable error codes. The client switches on these; it never
 * parses an error message, and it never sees a message TMDB wrote.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  UPSTREAM_INVALID_RESPONSE: 'UPSTREAM_INVALID_RESPONSE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCodeValue;
  readonly retryAfterSeconds?: number;
  override readonly cause?: unknown;

  constructor(
    code: ErrorCodeValue,
    message: string,
    status: number,
    options: { retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  static notFound(message = 'The requested resource was not found.') {
    return new AppError(ErrorCode.NOT_FOUND, message, 404);
  }

  static validation(message: string) {
    return new AppError(ErrorCode.VALIDATION_FAILED, message, 400);
  }

  static upstreamUnavailable(message = 'The movie service is temporarily unavailable. Please try again shortly.', cause?: unknown) {
    return new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, message, 503, { cause });
  }

  static rateLimited(retryAfterSeconds?: number) {
    return new AppError(ErrorCode.RATE_LIMITED, 'Too many requests right now. Please slow down and try again.', 429, {
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    });
  }

  static upstreamInvalid(message = 'The movie service returned data we could not read.', cause?: unknown) {
    return new AppError(ErrorCode.UPSTREAM_INVALID_RESPONSE, message, 502, { cause });
  }
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound('No route matches this URL.'));
}

/**
 * The single place an error becomes an HTTP response. Express 5 forwards rejected
 * async handlers here automatically, so route code can just throw.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = (req as Request & { id?: string }).id ?? 'unknown';

  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    const detail = err.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ');
    appError = AppError.validation(detail);
  } else {
    appError = new AppError(ErrorCode.INTERNAL, 'Something went wrong on our side.', 500, { cause: err });
  }

  // 5xx is our fault and gets a full stack; 4xx is expected traffic and stays quiet.
  if (appError.status >= 500) {
    logger.error({ err: appError.cause ?? appError, code: appError.code, requestId, path: req.originalUrl }, appError.message);
  } else {
    logger.debug({ code: appError.code, requestId, path: req.originalUrl }, appError.message);
  }

  if (appError.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(appError.retryAfterSeconds));
  }

  res.status(appError.status).json({
    error: { code: appError.code, message: appError.message, requestId },
  });
}
