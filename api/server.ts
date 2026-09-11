import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/dist/app.js';

/**
 * Vercel serverless entry point for the whole API.
 *
 * This was originally `api/[...path].ts`, on the assumption that Vercel's `/api`
 * directory convention expands `[...param]` into a catch-all the way Next.js does.
 * It does not - for a plain Node function it registers as a SINGLE dynamic segment.
 * The result was that `/api/movies` worked and `/api/movies/550` returned Vercel's
 * own 404 without ever invoking this function, taking every auth route, the wishlist
 * write path and the movie detail page down with it. Nothing about that reproduces
 * locally, where Express does its own routing.
 *
 * So the routing is now explicit: `vercel.json` rewrites `/api/*` here, and the
 * filename carries no bracket syntax for the platform to interpret.
 *
 * Imports the COMPILED server rather than the TypeScript source. The bundler then
 * follows a real `.js` file and never has to resolve NodeNext's `.js`-means-`.ts`
 * convention, which is a common source of "module not found" at bundle time.
 *
 * Module scope persists while a container stays warm, so the in-process cache,
 * token bucket and circuit breaker still function between requests - but only
 * per instance and only while warm. See the README for what that costs.
 */
const app = createApp() as unknown as (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Vercel's Node runtime attaches its own convenience API to req/res before invoking
 * us - `cookies`, `query` and `body` on the request, `status`/`json`/`send`/`redirect`
 * on the response - for handlers that are not a framework. Express defines every one
 * of these itself, on the request and response PROTOTYPES, and an own property
 * shadows a prototype one. Left in place, the platform's versions silently win over
 * Express's, so the code running in production is not the code that runs locally.
 *
 * `req.cookies` is the one that took the whole API down. cookie-parser's first act is
 * `if (req.cookies) return next()` (cookie-parser/index.js:45), so a pre-populated
 * `req.cookies` makes it skip its entire body - never assigning `req.secret`, never
 * populating `req.signedCookies`. Two things followed, and both did:
 *
 *   - `res.cookie(..., { signed: true })` throws `cookieParser("secret") required for
 *     signed cookies` (express/lib/response.js:754). `deviceSession` sets the signed
 *     device cookie on every request that arrives without one - so on every first
 *     request, from middleware that runs BEFORE the router. Every endpoint died with
 *     a 500 carrying our own generic INTERNAL body: `/api/health`, which touches
 *     neither the database nor TMDB, and unknown paths, which never reached the 404
 *     handler. Nothing about it reproduces locally, where there is no platform
 *     wrapper and so no `req.cookies` to trip over.
 *
 *   - `req.signedCookies` stays undefined, so even past that throw no device id and
 *     no session token could ever be read back: signing in would appear to succeed
 *     and the very next request would be anonymous again.
 *
 * `req.query` and the response helpers are deleted for consistency rather than
 * because they were failing - the platform's query parser is not the one Express is
 * configured with, and its `res.json`/`res.send` bypass Express's ETag and content
 * negotiation.
 *
 * Everything removed here is defined `configurable: true`, so `delete` is enough.
 * `req.body` is the one that must be kept instead - see below.
 */
const PLATFORM_REQUEST_HELPERS = ['cookies', 'query'] as const;
const PLATFORM_RESPONSE_HELPERS = ['status', 'json', 'send', 'redirect'] as const;

function removeOwnProperties(target: object, keys: readonly string[]): void {
  for (const key of keys) {
    if (Object.hasOwn(target, key)) {
      delete (target as Record<string, unknown>)[key];
    }
  }
}

/**
 * `req.body` is the exception: it has to be kept, not deleted.
 *
 * To expose a parsed body the runtime reads the request stream to completion before
 * the handler is called. That leaves `req.complete === true`, and body-parser's first
 * check is `if (onFinished.isFinished(req)) { next() }` (body-parser/lib/read.js:40).
 * So `express.json()` cannot re-parse the body here no matter what - it declines and
 * leaves `req.body` alone. Delete the platform's value and every request with a JSON
 * body reaches its route with `req.body` undefined, which is a 400 "value: Required"
 * on signup, login, password change and adding to the wishlist.
 *
 * The platform's value is therefore the only body available, and it is resolved eagerly
 * here rather than left as a lazy getter: the getter throws on malformed JSON, and it
 * would do so deep inside route code, where it reads as a server fault and becomes a
 * 500. Resolved here, an unparseable body simply leaves `req.body` undefined and the
 * route's own schema validation turns it into the 400 it always was.
 *
 * Guarded on the property actually being present, so that if the runtime ever stops
 * pre-reading the body, `express.json()` is left to do the job as it does locally.
 */
function resolvePlatformBody(req: IncomingMessage): void {
  if (!Object.hasOwn(req, 'body')) return;

  const request = req as IncomingMessage & { body?: unknown };
  let body: unknown;

  try {
    body = request.body;
  } catch {
    body = undefined;
  }

  Object.defineProperty(request, 'body', {
    value: body,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  removeOwnProperties(req, PLATFORM_REQUEST_HELPERS);
  removeOwnProperties(res, PLATFORM_RESPONSE_HELPERS);
  resolvePlatformBody(req);

  /**
   * The rewrite carries the original path in `__p`, because a rewrite's destination
   * is what the function may otherwise see as `req.url` - and the Express router is
   * mounted at `/api`, so it needs the real path to match anything. Restoring it
   * here means this works whether or not the platform preserves the original URL.
   */
  const url = req.url ?? '/';
  const queryAt = url.indexOf('?');

  if (queryAt !== -1) {
    const params = new URLSearchParams(url.slice(queryAt + 1));
    const original = params.get('__p');
    if (original) {
      params.delete('__p');
      const rest = params.toString();
      req.url = `/api/${original}${rest ? `?${rest}` : ''}`;
    }
  }

  app(req, res);
}
