import { createApp } from '../server/dist/app.js';

/**
 * Vercel serverless entry point.
 *
 * A catch-all route rather than a rewrite to a single `/api` function: with
 * `[...path]`, Vercel hands the function the original URL (`/api/movies?...`),
 * which is what the Express router mounted at `/api` expects. Rewriting instead
 * would rewrite the path out from under it.
 *
 * An Express app is already a `(req, res)` function, so it can be the default
 * export directly - no adapter needed.
 *
 * Imports the COMPILED server rather than the TypeScript source. The bundler then
 * follows a real `.js` file and never has to resolve NodeNext's `.js`-means-`.ts`
 * convention, which is a common source of "module not found" at bundle time.
 *
 * Module scope persists while a container stays warm, so the in-process cache,
 * token bucket and circuit breaker still function between requests - but only
 * per instance and only while warm. See the README for what that costs.
 */
const app = createApp();

export default app;
