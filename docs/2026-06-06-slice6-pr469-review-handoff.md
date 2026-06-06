# Slice 6 (#392) PR #469 — review-fix resume handoff (2026-06-06)

**Worktree** `/Users/jack/Dev/kuruma-slice6` · **branch** `feat/slice6-booking-events`
· tip **`c082b05`**. DRAFT **PR #469** → `marketplace-pivot`. origin is at `884427a`
(the review fixes `c082b05` are **local-only, NOT pushed yet**).

## Context
A reviewer requested changes on PR #469 (3 findings). Verdict: fix the two P1s
before undrafting.

## DONE this session (committed `c082b05`, tests green, biome clean)
- **Finding #1 (P1) — vehicle↔pickup-location mismatch:** `services/booking.ts`
  create now enforces `vehicle.pickupLocationId === input.pickupLocationId` (was
  only checking the location's operator). Tests: service same-location 400 +
  route 400. Aligned two fixtures that booked a car away from its location
  (`tests/routes/select-columns.test.ts`, `tests/integration/bookings.test.ts`
  overlap — both now seed the vehicle's `pickupLocationId`).
- **Finding #2 (P1) — incomplete event log:** `updateStatus` + `cancel` now wrap
  projection-update + event-append in `runInTransaction`, appending
  `STATUS_CHANGED` / `BOOKING_CANCELLED` (actorId = ctx.userId). Tests replay the
  event log for both. (`services/booking.ts` ~570/~604.)
- Verified locally: api unit/route **66 files**, integration `bookings` file 12
  tests green.

## REMAINING (do these, in order)
1. **Finding #3 (P2) — migration assumes empty `bookings`.** `0036_slice6_*.sql`
   adds NOT NULL cols with no backfill. DECISION: the marketplace cutover reseeds
   bookings (empirically empty — 0036 applied clean on staging-forked slice6-dev,
   and CI db-drift migrates a fresh DB), so **document the assumption** rather
   than splitting (YAGNI). Add a short note to the **PR #469 body** (and reply to
   the reviewer) stating the empty/reseeded-bookings cutover contract. Do NOT
   edit `0036.sql` — changing its bytes breaks the applied-hash on slice6-dev
   (would force another reset_from_parent + re-migrate).
2. **Re-run the FULL gate** (the P1 changes touch the booking hot path):
   - `bun run lint` · `bun run --filter '*' typecheck`
   - `bun run test` (shared/api/web) · `bun run --filter @kuruma/web build`
   - `bun run db:verify` (worktree `.env` = slice6-dev) and integration:
     `cd packages/api && bun --env-file=../../.env run test:integration` (expect 172)
   - E2E: `bunx playwright test e2e/booking.spec.ts e2e/storefront-search.spec.ts`
     (storefront-search:13 is a known cold-compile flake → recovers on retry/CI)
3. **Rebase if behind** `origin/marketplace-pivot` (it has been moving), then
   **push** (`git push` — branch already tracks origin; never force a pushed
   branch, but fast-forward of new commits is fine) to update PR #469.
4. Optionally post a PR comment summarizing the three resolutions.

## Gotchas (unchanged)
- `.env` reads are sandbox-blocked → `bun --env-file=../../.env` for integration.
- slice6-dev host = `ep-small-dawn-anzoxhc5` (NOT prod). db:verify must stay 4/4.
- Reviews so far: no CRITICAL/HIGH; the [P0] public insurance endpoint was
  confirmed sound (active-only, single-operator, renter-safe projection).
- Prior full state: `docs/2026-06-05-slice6-task8-10-complete-handoff.md`.
