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

export default function handler(req: IncomingMessage, res: ServerResponse): void {
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
