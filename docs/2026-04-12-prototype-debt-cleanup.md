# Prototype Debt Cleanup (2026-04-12)

> **Warning:** AI-assisted rapid prototyping produces working features fast — but accumulates structural debt that compounds silently. This document records what went wrong, why, and what 76 commits in a single day had to fix. Read this before the next prototyping sprint.

## What was wrong

The codebase was a prototype that shipped. Fast iteration with AI agents produced working features but accumulated structural debt in five areas:

### 1. No architecture boundaries

Routes had DB queries inline, business logic mixed with HTTP handling. A "controller" might validate input, query Postgres, compute prices, and format the response all in one function.

### 2. Type safety was theatrical

20+ `as Vehicle` / `as Booking` casts scattered across repositories. If a field was added to the domain type, the cast silently allowed missing fields. `any` leaked through validators. `exactOptionalPropertyTypes` was off.

### 3. Security was ad-hoc

No JWT auth middleware (routes trusted session blindly), no ownership checks (any user could read any booking), timing-vulnerable API key comparison, stack traces leaked in errors, CORS wide open, no rate limiting.

### 4. Data integrity gaps

No optimistic locking (concurrent status updates could corrupt), no idempotency keys (double-submit = double booking), N+1 queries, unbounded list endpoints, missing FK indexes.

### 5. Dead code and duplication

4 separate `ApiResponse` type definitions, orphaned fetcher files, unused deps, a debug endpoint with no auth.

## Why it was like that

AI-assisted rapid prototyping. Each feature was built as a vertical spike to prove the concept, not to last. The priority was "does it work" not "is it safe/maintainable." Multiple parallel agent sessions compounded the duplication — each session generated its own local copy of shared types rather than reusing what existed.

## What changed

| Theme | Key PRs | Effect |
|-------|---------|--------|
| **MVC + DI** | #99, #122, #83 | Routes -> Services -> Repositories. Single composition root. Boundary linter enforced in CI. |
| **Type safety** | #81, #93, #96, #164 | `exactOptionalPropertyTypes` on, 20 casts replaced with mapper functions, canonical `ApiResponse<T>` discriminated union, validators tightened to `z.enum`/`z.uuid` |
| **Security** | #198, #165, #181, #128, #132 | JWT auth middleware on all routes, ownership checks, algorithm pinning, timing-safe comparisons, rate limiting, global error handler, CORS gated by `NODE_ENV` |
| **Data integrity** | #126, #127, #201, #161, #170 | Optimistic locking, idempotency keys, DB trigger for `effectiveEndAt`, unique constraints, transactions on thread ops |
| **Performance** | #120, #172, #156, #191, #176 | 8 FK indexes + status index, N+1 fix via batch lookup, `next/image`, JWT role caching |
| **Cleanup** | #92, #70, #77, #208, #207 | Deduplicated types, removed dead code/deps/pages, trimmed CLAUDE.md by 70% |

## What it's like now

A layered API with enforced boundaries (lint + CI), type-safe mappers instead of casts, auth middleware on every route, and data integrity at the DB level. Still a small app, but the foundation won't fight you when features land on top of it.

## Lessons for next time

1. **Turn on strict TypeScript from day one.** Retrofitting `exactOptionalPropertyTypes` across 30+ files is painful. Starting strict costs nothing.
2. **Add auth middleware before the second route.** Bolting auth onto 15 existing routes means 15 places to miss an ownership check.
3. **One canonical type, one location.** If two agents need `ApiResponse`, put it in `shared/` before the first feature lands. Deduplicating 4 copies later is pure waste.
4. **Casts are lies.** `as Vehicle` compiles today and breaks silently tomorrow. Mapper functions fail at compile time when the shape changes.
5. **DB constraints over application checks.** Unique constraints, exclusion constraints, and triggers catch bugs that application code misses under concurrency.
6. **Prototype sprints need a cleanup budget.** Plan for a hardening pass after every spike phase — or the debt compounds until a 76-commit day is the only way out.
