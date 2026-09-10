# Trackzio — Movie Discovery

A movie discovery app: browse what's popular, filter by genre/year/rating, search, open a film for details, and keep a wishlist that survives closing the browser.

React + Vite on the front, Node/Express + Prisma/Postgres on the back, TMDB as the upstream data source. The backend is an abstraction layer over TMDB, not a proxy — the client never sees a TMDB field name, URL, or error.

---

## Quick start

**Prerequisites:** Node 20+, Docker (for Postgres), and a free TMDB API token.

```bash
# 1. Get a TMDB token: themoviedb.org → Settings → API → Developer
#    Copy the "API Read Access Token" (the long eyJ... JWT).

# 2. Configure
cp .env.example server/.env      # then paste your token into TMDB_ACCESS_TOKEN
cp .env.example web/.env         # only VITE_API_BASE_URL is read here

# 3. Install, start the database, migrate
npm install
docker compose up -d
npm run db:migrate

# 4. Run both apps
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000 (`/api/health` reports cache stats and circuit state)

**Note on the database port:** the container publishes Postgres on **5433**, not 5432, so it cannot collide with a Postgres already installed on the host. If you'd rather use 5432, change it in `docker-compose.yml` and `server/.env` together.

**Tests:** `npm test` (39 tests; no database or network required — the suite stubs `fetch` and degrades to the in-memory cache tier).

---

## Architecture

```
Browser ──▶ React SPA ──▶ Express API ──▶ [ L1: in-process LRU ]
                              │            [ L2: Postgres cache ]
                              │                    │ miss
                              │                    ▼
                              │              TMDB  (timeout, jittered retry,
                              │                     token bucket, circuit breaker)
                              └──────────▶ Postgres (wishlist, devices)
```

```
server/src/
  config/env.ts        zod-validated env; the process refuses to boot if it's wrong
  tmdb/client.ts       the only code that talks to TMDB: timeout, retry, breaker
  tmdb/schemas.ts      tolerant zod schemas for upstream payloads
  tmdb/mapper.ts       TMDB shapes → our domain shapes
  cache/index.ts       L1+L2, single-flight, stale-while-revalidate, stale-if-error
  services/            business logic: discover/search unification, negative caching
  routes/              HTTP surface, query validation, cache headers
  middleware/          error envelope, anonymous device session
web/src/
  lib/                 apiClient, queryClient, URL-state + debounce hooks
  features/movies/     query hooks, MovieCard, FilterBar
  features/wishlist/   optimistic mutations
  pages/               Browse, MovieDetail, Wishlist
  components/ui/       Poster, loading/empty/error/stale states
```

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/movies?q&genres&year&minRating&sort&page` | Browse **and** search, one endpoint |
| `GET /api/movies/:id` | Full detail (credits, trailer, similar) |
| `GET /api/genres` | Genre list, cached 24h |
| `GET /api/wishlist` · `POST /api/wishlist` · `DELETE /api/wishlist/:movieId` | Wishlist CRUD |
| `GET /api/wishlist/ids` | Lightweight membership set for the grid |
| `GET /api/health` | Cache hit rate, circuit state, uptime |

Lists return `{ items, page, totalPages, totalResults, hasMore, stale?, notice? }`.
Errors return `{ error: { code, message, requestId } }` where `code` is a stable machine string (`UPSTREAM_UNAVAILABLE`, `RATE_LIMITED`, `NOT_FOUND`, `VALIDATION_FAILED`, `INTERNAL`) — never a leaked upstream message.

---

## Technical decisions

### The backend owns the data shape, not TMDB

Every response is translated in `tmdb/mapper.ts` into types defined in `domain/types.ts`: camelCase, absolute image URLs at three widths, genre names resolved from ids, and explicit nulls. The client has no knowledge of `poster_path`, of `image.tmdb.org`, or of genre ids. Swapping to a different upstream provider would mean rewriting one folder and touching zero frontend code.

Two smaller judgements live in the mapper and are worth calling out because they're product decisions, not technical ones:

- **`vote_average: 0` with `vote_count: 0` becomes `null`, not `0.0`.** TMDB uses 0 for both "rated zero" and "nobody has voted". A `0.0` badge is a lie about the film; the UI shows "NR".
- **`budget: 0` / `revenue: 0` become `null`.** Same reasoning — rendering "$0" presents missing data as a fact.

### One endpoint over two incompatible upstreams

`/discover/movie` supports genre, sort, year and rating filters. `/search/movie` supports **none** of them. Exposing that as two client-facing endpoints with two different capability sets would push TMDB's limitation into the UI.

Instead `GET /api/movies` picks the upstream based on whether `q` is present, and when searching, applies genre/rating filtering and sorting itself over the returned page. The response carries a `notice` explaining that filters apply per-page. This is the most interesting trade in the project and it is a genuine compromise — see *Known limitations*.

### Caching: two tiers, single-flight, and stale serving

`cache/index.ts` exposes one function, `getOrLoad(key, policy, loader)`:

- **L1** — in-process LRU, bounded at 1,000 entries. Microsecond hits.
- **L2** — Postgres `cache_entries`. Survives restarts and deploys, shared across instances, and is what makes stale serving possible.
- **Single-flight** — a map of in-flight promises keyed by cache key. Fifty simultaneous requests for the same page produce **one** upstream call. This is the direct answer to "the same information is requested repeatedly", and it's also what protects TMDB when a user hammers the filter bar.
- **stale-while-revalidate** — past the TTL but inside the SWR window, the expired entry is served *immediately* and refreshed in the background. The user waits on nothing.
- **stale-if-error** — expired rows are kept, never deleted on expiry. When TMDB is slow, down, or rate-limiting, we serve slightly-old data flagged `stale: true` and the UI shows a quiet "showing saved results" bar. **Degraded beats broken.**

TTLs: genres 24h, browse/search 5min (+10min SWR), detail 12h, 404s 60s.

The 404 TTL is **negative caching**: without it, anything hitting `/api/movies/999999999` repeatedly would pass straight through to TMDB every time.

L2 writes are deliberately not awaited — a user's response shouldn't wait on a cache write, and a failed write is a performance problem, never a correctness one. An hourly sweep deletes rows too old to serve even as a fallback, so the table can't grow unbounded from every filter combination anyone ever tried.

### Surviving a bad upstream

`tmdb/client.ts` is the only code that calls TMDB, so all of this lives in one place:

- **6s per-attempt timeout** via `AbortController`, inside a **12s total budget**. Without the budget, three timeouts plus backoff would make a user wait ~20s before seeing an error.
- **Retry only what's retryable** — 429, 5xx, network, timeout. Never a 404 (the answer won't change) or a 401 (retrying just hammers them with bad credentials).
- **Full-jitter exponential backoff**, honouring `Retry-After`. The jitter matters: with fixed backoff, every client that failed at the same moment retries at the same moment.
- **Token bucket at 30 req/s**, under TMDB's documented ~40–50/s ceiling. Discovering a rate limit by being rejected costs a round trip and a retry; self-throttling is strictly better. A smooth bucket rather than a fixed window, because a fixed window lets 30 requests fire in the first 10ms of every second — exactly the burst shape that trips limiters.
- **Circuit breaker**, 5 consecutive failures → open 30s → half-open probe. Without one, a TMDB outage means every request spends its full timeout waiting on a host we already know is down, and that queues up until our own API falls over.

### Tolerating bad data

TMDB genuinely returns movies with a null overview, no poster, an empty-string release date, or a missing rating. `tmdb/schemas.ts` uses `preprocess`-based helpers so:

- a missing **optional** field degrades to `null`, never throws
- a missing **required** field (`id`, `title`) makes the record unusable, so it's dropped
- one malformed movie out of twenty **does not fail the page** — `parseTolerantArray` keeps the survivors and reports the drop count, which gets logged so upstream drift is visible

### Wishlist: identity and what we store

Identity is an **anonymous signed httpOnly cookie** carrying an opaque device id. The brief asks for a wishlist that survives closing and reopening the app but never asks for accounts, so this gives persistence with no signup friction. Signed, so a client can't hand us someone else's id; httpOnly, so page scripts can't read it. **No database write happens on read** — a `Device` row is created lazily on the first wishlist write, otherwise any crawler could fill the table.

On **what to store versus fetch**: we own wishlist membership and a *display snapshot* (title, poster path, year, rating). We do not mirror the movie catalogue — TMDB owns that and it changes constantly.

The snapshot is the interesting call. It means the wishlist page renders from **one indexed query with zero upstream calls** — instant, and it still works while TMDB is down. The cost is that a snapshot can go stale; it's refreshed whenever the movie is re-added or its detail page is opened. We store the bare poster *path*, not a full URL, because the image size bucket is a presentation decision — storing `w342` in the database would mean a data migration every time the UI wanted a different resolution.

`@@unique([deviceId, movieId])` plus `upsert` makes adding idempotent, so double-clicking the heart can't create two rows. Deleting something already gone returns 204 — the user's intent is satisfied either way.

If TMDB is unreachable when a movie is added, we **still save it** with a placeholder title and backfill the snapshot later. Being unable to reach a third party shouldn't stop someone bookmarking something.

### Frontend

- **The URL is the source of truth** for browse state (`/?q=&genres=&sort=&year=&minRating=`). The back button restores the exact grid the user came from, every filtered view is shareable, and a refresh doesn't dump you back to page one. React Query keys its cache off the same values, so returning to a previous combination is instant and costs no request.
- **Rapid input** is handled in two halves: a 350ms debounce so nine keystrokes don't fire nine requests, and abort-signal cancellation so a slow earlier response can't land after a faster later one and overwrite the grid. `keepPreviousData` dims the old results instead of collapsing to a spinner, so the scroll position never jumps.
- **Large result sets** use `useInfiniteQuery` with an IntersectionObserver sentinel that pre-fetches 600px early, plus an explicit "Load more" button — keyboard and screen-reader users never trigger an intersection by scrolling.
- **Posters** are the messiest real-world case, handled in one component: a fixed 2:3 box with `object-cover` (so TMDB's occasional 4:3 artwork is cropped, never stretched, and never changes row height), a `srcset` across three widths, `loading="lazy"` beyond the first row, a shimmer placeholder at the exact final dimensions so nothing reflows, and a typographic fallback tile when there's no poster at all.
- **Long titles** get `line-clamp-2` plus `min-w-0` on flex children, so they can't widen a grid column or spill into the next card.
- **Responsive** rests mainly on one rule: `grid-template-columns: repeat(auto-fill, minmax(clamp(8.5rem, 22vw, 11rem), 1fr))`. Columns are sized by available space rather than by breakpoint, so the grid adapts to viewport widths nobody thought to test. Below `md` the filter chips move into a bottom-sheet drawer, since a wall of genre chips would otherwise eat most of a phone screen before any posters appear.
- **Optimistic wishlist toggles** with rollback. The heart must feel instant; waiting on a round trip before the icon fills makes the whole app feel sluggish. Both cached shapes (the id set driving the grid, the entry list driving the wishlist page) are updated together, or the two views disagree until the next refetch.
- **A single committed dark theme**, not a toggle. Posters are dense, saturated images and read far better on a dark, low-chroma ground — it's why every streaming service converged there. A toggle would double the design and test surface for no product gain.

---

## Assumptions

- **Anonymous, single-device users.** No login was asked for, so the wishlist belongs to a browser, not a person.
- **English (`en-US`) content.** TMDB is multilingual; localisation wasn't in scope, so the language is a constant in one place rather than a user setting.
- **Adult content excluded** (`include_adult=false`) — a safe default for an unauthenticated product with no age gate.
- **Selecting multiple genres means AND, not OR.** Adding a filter should narrow results; an OR that widens as you add chips reads as broken.
- **A vote-count floor of 300 applies when sorting by rating.** Otherwise TMDB happily puts a film with one 10/10 vote above *The Godfather*, and "Highest rated" looks broken rather than curated.
- Movie data is public and non-sensitive, so list responses are cacheable by shared caches; wishlist responses are `private, no-store`.

## Known limitations

- **Search filters apply per-page.** Because `/search/movie` supports no filters, genre/rating filtering happens over the 20 results TMDB returned for that page. So a filtered search page can come back partly empty, and `totalResults` counts pre-filter matches. The alternative — fetching up to 500 pages per keystroke to filter the full set — is far worse. A local index of search results would fix it properly.
- **TMDB caps pagination at 500 pages**, so a query with 40,000 matches only exposes 10,000. We clamp and surface a `notice` asking the user to narrow their filters.
- **No virtualization.** The DOM grows with each loaded page; after ~15 pages the grid gets heavy. `@tanstack/react-virtual` is the fix, deliberately deferred because it complicates the responsive auto-fill grid.
- **Wishlist doesn't follow a user across devices** and is lost if cookies are cleared. That's the direct cost of choosing no-login.
- **Wishlist snapshots can go stale** until the movie is viewed or re-added.
- **The cache is per-instance for L1.** Scaling to several backend instances means each keeps its own L1 while sharing L2 — correct, but with a lower hit rate than a shared Redis would give.
- **`revenue.desc` sorting degrades to popularity on the search path**, because list payloads don't carry revenue.
- **Prisma CLI carries a transitive advisory** (`deepmerge-ts`, stack exhaustion during config parsing). It's a dev-time CLI path not reachable from the running server, and the only fix is a breaking upgrade to Prisma 8, so it's pinned at 6.19.3 knowingly.

## What I'd improve with more time

1. **A local search index.** Periodically ingest popular titles into Postgres with a trigram/full-text index. That removes the search/discover asymmetry entirely — real filtering and sorting across the whole result set — and cuts upstream calls dramatically.
2. **Redis as a shared L2** (or in front of it), so L1 hit rates hold up across multiple instances and the cache survives a database restart independently.
3. **Grid virtualization** for very deep scrolls.
4. **Accounts, optionally.** Keep anonymous browsing, but let a user claim their device's wishlist with an email so it follows them across devices.
5. **Observability**: request tracing with proper span timings around the TMDB call, and cache hit rate as a real metric rather than a counter on `/api/health`.
6. **E2E tests** (Playwright) for the flows that unit tests can't cover — debounced search, infinite scroll, optimistic rollback on a failed toggle.
7. **Wishlist snapshot refresh job** rather than lazy backfill.

---

## AI use

AI (Claude) was used substantially, as encouraged by the brief:

- Researching the current TMDB API surface — rate-limiting behaviour, `/discover` parameters, the 500-page ceiling, `append_to_response` — rather than relying on memory or stale blog posts.
- Generating boilerplate: project scaffolding, config files, and the repetitive parts of components and tests.
- Reviewing edge cases and drafting this README.

The architecture and the decisions behind it are mine and are documented above with their reasoning: the two-tier cache with single-flight and stale-if-error, absorbing the search/discover asymmetry inside one endpoint, the denormalized wishlist snapshot and what it trades away, the anonymous device-cookie identity model, URL-as-state on the client, and the product judgements about null ratings and AND-vs-OR genre filtering.
