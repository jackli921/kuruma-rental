# Handoff — #551 turnaround floor + realistic seed + renter cooldown surfacing

**Date:** 2026-06-12 · **Issue:** [#551](https://github.com/jackli921/kuruma-rental/issues/551) (epic #385)
**Branch:** `feat/turnaround-floor-surfacing` · **Worktree:** `~/Dev/kuruma-turnaround-ux`
**Base:** `origin/marketplace-pivot` @ `a8cd5bb` · **Tip:** `1f5ad1b` · **NOT pushed.**

## Status: cycles 1-3 DONE (the whole backend), cycles 4-6 LEFT (surfacing)

5 local commits, all pre-commit-clean (biome/size/boundaries/tsc x3):
- `fb51bae` c1 RED (validator floor tests)
- `af15f50` this handoff doc (now rewritten to current state)
- `efabb02` **c1 GREEN** — `validators/location.ts` `turnaroundSchema` `.min(0)` -> `.min(60, 'Turnaround must be at least 60 minutes')`
- `34393ad` **c2** — DB CHECK + migration 0048 + integration 23514 test
- `1f5ad1b` **c3** — varied seed distribution

**Verified green now:** shared vitest 420 · api integration 197 (23 files) · db:verify 4/4.
**Test DB** `kuruma-test-pg` (docker, :5432) is migrated to **49 migrations incl 0048**;
`DATABASE_URL=postgres://kuruma:kuruma@localhost:5432/kuruma_test`.

## Why this exists (verified diagnosis — do not relitigate)
Reported "booked once = car gone forever" is **NOT a scheduling bug**. The overlap predicate,
the `bookings_no_overlap` gist exclusion, and the `effectiveEndAt` trigger (mig `0037`) are all
correct; booking does NOT flip `vehicles.status`. The illusion = **every seeded location used 48h
(2880m) turnaround** + the renter search defaults to a near-future window, so a booking blocked the
car for `rental + 48h` (~5 days) and every near-future re-search kept overlapping it. Cycle 3 fixed
the seed; the floor (c1/c2) is a service-quality guarantee, NOT overlap-safety.

## What's already done (don't redo)
- **c1** `packages/shared/src/validators/location.ts:53-60` — `turnaroundSchema` now `.min(60)`.
  `.partial()` reuse means PATCH (updateLocationSchema) inherits the floor for free.
- **c2** `packages/shared/src/db/schema.ts:241` — CHECK renamed `locations_turnaround_non_negative`
  (`>=0`) -> `locations_turnaround_min_60` (`>=60`). Migration `drizzle/0048_turnaround_min_60.sql`
  hand-edited to **DROP -> UPDATE backfill (<60 -> 60) -> ADD** (backfill before constraint).
  Integration test `packages/api/tests/integration/locations-turnaround-floor.test.ts` asserts a
  Zod-bypassed insert of 30 bounces with Postgres `23514`; 60 persists. Backfill-lift proven via a
  scratch-DB replay (documented in `34393ad` commit body; not in CI).
- **c3** `packages/shared/src/db/seed-data/locations.ts` — turnaround now varies: Namba 60,
  Shin-Osaka 90, Umeda 120, Tennoji 90, Sannomiya 180, Kyoto 120, Nara 180, KIX 1440,
  Osaka Castle 2880 (`DEFAULT_TURNAROUND_MINUTES` const kept). `packages/shared/tests/db/seed-data.test.ts`
  now asserts floor / >=3 distinct / <=2 at max / >=1 central[60,180] (replaced the old
  "exactly one override" false green).

## REMAINING — cycle 4 (API DTO)
Pure additive; **no repo change** — `Storefront = Location & {operatorName}` (`repositories/types.ts:457`)
already carries `defaultTurnaroundMinutes` (drizzle repo selects `...locationColumns`).
1. `packages/api/src/services/storefront-detail.ts:17` — add `turnaroundMinutes: number` to
   `StorefrontSummary`. Populate in the `getDetail` return object at **:214-219** (after
   `operatingHours:`) with `turnaroundMinutes: storefront.defaultTurnaroundMinutes,`.
2. `packages/api/src/services/storefront-search.ts:29` — add `turnaroundMinutes: number` to
   `StorefrontCard`. Populate in `buildCard`'s return at **:156-167** with
   `turnaroundMinutes: storefront.defaultTurnaroundMinutes,`.
3. **Tests are CO-LOCATED** (not under `tests/`): `packages/api/src/services/storefront-detail.test.ts`
   and `storefront-search.test.ts`. Add (RED first) one assertion in each that a known store's card /
   summary carries the expected `turnaroundMinutes`. Run: `bun run --filter @kuruma/api test` (vitest;
   these are in-memory, no DB needed).

## REMAINING — cycle 5 (renter web render) — MOST INVOLVED
Files (all exist): `packages/web/src/routes/$locale/search.tsx` (the `StoreGrid`),
`packages/web/src/vite/storefronts/StorefrontCard.tsx`, `.../StorefrontDetailView.tsx`,
plus DTOs in `.../storefronts/api.ts` + `params.ts` (raw-fetch DTOs — add `turnaroundMinutes` there
to match the API, the Vite shell owns its own DTOs, do NOT import api module types).
1. `StorefrontCard.tsx` — render "~Nh turnaround between rentals" (format minutes->hours in web).
2. `StorefrontDetailView.tsx` — same line + a near-date hint (secondary).
3. `search.tsx` `StoreGrid` — grid-level helper copy (recently-returned cars may be hidden during
   turnaround; try later dates) + enriched empty state.
4. **i18n: new keys in ALL locales** `packages/web/messages/{en,ja,zh}.json`. After adding namespaces,
   `rm -rf packages/web/.next` is irrelevant here (Vite) but **restart the Vite dev server**.
5. web vitest for the card + grid copy. Run `bun run --filter @kuruma/web test`.
6. **Adding/!! NOT adding a route file here** — these are existing routes, no `routeTree.gen.ts` regen
   needed. (Only NEW route files require `vite build` to regen the tree before typecheck.)

## REMAINING — cycle 6 (operator form floor) — one-liner
`packages/web/src/modules/locations/components/LocationForm.tsx:167` — `min={0}` -> `min={60}`.
(Frozen Next.js tree; this one-line edit is allowed — it shares the Zod validator already.)
Add a form test asserting the input's `min` is 60. There's an existing `form.turnaroundHint` i18n key
(`:170`) you may want to update to mention the 60m minimum.

## Logistics / gotchas
- **Shell cwd RESETS to `~/Dev/kuruma-rental` after every Bash call** — `cd` into the worktree in
  EACH command (or use absolute paths). Edits already use absolute worktree paths.
- **vitest, not bun:test.** Run package suites via `bun run --filter @kuruma/<pkg> test`.
- **Biome import-sort/format is an ASSIST** — pre-commit will REVERT the commit if a staged file
  isn't formatted. Run `bunx biome check --write <files>` BEFORE `git commit` (not `format`).
- **Integration tests need `DATABASE_URL`** pointed at `kuruma-test-pg:5432` (already migrated to 0048).
  `bun run --filter @kuruma/api test:integration <namefilter>`. It prints a harmless
  "something prevents Vite server from exiting" after passing — ignore.
- **Migration 0048 collides** with unmerged #394 (also local 0048); #521 moved to 0049. The renumber
  + `_journal.json` `when`-bump (to `max(prev)+1`) happens at **MERGE time**, per the drizzle
  out-of-order gotcha in CLAUDE.md. Nothing to do until then.
- **Out of scope:** per-vehicle override; the near-future default-search-window UX (own follow-up).

## Acceptance (from issue) — remaining to satisfy
Renter sees turnaround on search card + grid helper + detail (c4/c5); LocationForm min=60 tested (c6).
Floor in Zod + DB (c1/c2 done), backfill (c2 done), seed >=3 distinct/all>=60/<=2 at 2880 (c3 done),
overlap/exclusion tests still green, full gate green.

## On finish
Rebase onto `origin/marketplace-pivot` (no force — use reset->cherry-pick->ff-push if already pushed),
push, open PR `Closes #551`, drop the `in-progress` label, then `/code-review`.
