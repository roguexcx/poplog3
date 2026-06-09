# POPLOG Trakt Canonical Engine Migration Report

Date: 2026-06-06

## Implemented now

- Centralized `src/server/source-engine/engine.ts` on Trakt only.
- Added canonical DB persistence in `src/server/source-engine/canonical-store.ts`.
- Search now uses Trakt, normalizes relevant results, persists local canonical rows, and returns `poplogId` identities instead of temporary candidates.
- Details resolve through local canonical DB first and use Trakt for missing/incomplete data.
- Trakt details include `extended=full,images,translations`, ratings/votes, aliases, images, people, videos, related titles, seasons and episodes for series.
- Removed public/debug routes for TMDB, TVDB/Balloonerismm probes, OMDb, Watchmode and MovieOfTheNight.
- Removed the admin TMDB feed toggle route.
- Home hero/detail enrichment no longer calls Balloonerismm.
- Discover and Trending use Trakt paths and persistent cache/hydration.
- Series canonical metadata, season list resolution and episode hydration were reduced to Trakt-only paths.
- Trakt client is locked to `https://api.trakt.tv`, sends required headers, deduplicates in-flight calls, respects `Retry-After`, and handles controlled statuses `401`, `403`, `404`, `410`, `412`, `422`, `429`, `500`, `502`, `503`, `504`, `520`, `521`, `522`.
- `next.config.ts` no longer allowlists TMDB, TVDB or Balloonerismm image hosts.

## Database changes

- Added fields to `poplog3_titles`: `trakt_id`, `imdb_id`, `slug`, `source_payload`, `cache_status`, `source`, `source_version`, `last_fetched_at`, `expires_at`.
- Added indexes/uniques for `trakt_id + media_type`, `imdb_id + media_type`, `slug + media_type`, `media_type + expires_at`, and `cache_status`.
- Added `poplog_refresh_queue` for lightweight DB-backed refresh scheduling and future workers.
- Migration applied locally: `00000000000005_trakt_canonical_engine`.

## Validation

- `npx prisma migrate deploy`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Real local calls:
  - `/api/search?q=breaking%20bad&debugSource=1`: `200`, source `trakt`, 15 normalized, 13 returned, 13 `poplogId`, 0 temporary candidates.
  - `/api/trending?debugSource=1`: `200`, 50 results, source `trakt_index`.
  - `/api/poplog3/discover?type=tv`: `200`, 24 results, source `trakt`.
  - `/api/title/tv/{poplogId}` for Breaking Bad: `200`, source `trakt`, cache `fresh`, PT-BR overview, Trakt images, no Balloonerismm alias.
  - `/api/poplog3/tv/{poplogId}/seasons/1`: `200`, 7 episodes.

## Prepared for scale

- DB-first canonical identity by `poplogId`, `traktId`, `imdbId`, `slug`, plus auxiliary `tmdbId`.
- TTL fields and cache status on canonical rows.
- DB refresh queue for stale-while-revalidate/background worker expansion.
- Trakt in-flight dedupe and cooldown to reduce stampede.
- Public sections use persistent section cache/Trakt index where already present.

## Activate only with real traffic

- Separate worker process consuming `poplog_refresh_queue`.
- Dedicated external cache/CDN rules.
- Read replica, search service, or queue service.
- More aggressive pre-warm jobs for details, seasons, episodes and personalized pools.

## Remaining risks and limitations

- Some legacy types, comments and inactive modules still mention TMDB/TVDB/Balloonerismm/OMDb/Watchmode because the repo has broad historical surface area. They are not active in the migrated Source Engine path.
- Provider/availability data is now local-cache only unless a future Trakt-compatible provider source is added.
- Trakt image availability depends on `extended=images`; when Trakt has no image, UI must tolerate missing artwork.
- Some older UI names such as `TmdbImage` and `tmdb_id` remain as compatibility wrappers/fields. They should be renamed in a later cosmetic cleanup once user/library contracts are migrated.
