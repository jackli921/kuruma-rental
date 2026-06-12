# Handoff — #551 turnaround floor + realistic seed + renter cooldown surfacing

**Date:** 2026-06-12 · **Issue:** [#551](https://github.com/jackli921/kuruma-rental/issues/551) (epic #385)
**Branch:** `feat/turnaround-floor-surfacing` · **Worktree:** `~/Dev/kuruma-turnaround-ux`
**Base:** `origin/marketplace-pivot` @ `a8cd5bb` · **Tip:** `fb51bae` (1 commit, NOT pushed)

## Why this exists (the verified diagnosis)
Reported "booked once = car gone forever" is **NOT a scheduling bug**. Overlap predicate
(`repositories/drizzle/availability.ts`), the `bookings_no_overlap` gist exclusion, and the
`effectiveEndAt` trigger (mig `0037`, `endAt + COALESCE(turnaround,2880)*interval '1 minute'`)
are all correct; booking does NOT flip `vehicles.status`. The illusion = **every seeded
location uses 48h (2880min) turnaround** + the renter search always defaults to / restores a
near-future window, so a booking blocks the car for `rental + 48h` (~5 days) and every
near-future re-search keeps overlapping it. The car DOES return for any pickup ≥ `endAt + 48h`.
**Full plan + decisions live in issue #551 body + 2 comments — read them first.**

## Decisions locked (do not relitigate)
1. Keep 48h as the documented default; **vary the seed** with realistic per-location values.
2. Enforce a **60-min floor** (Zod + DB CHECK). A floor is a servicing-gap guarantee, NOT
   overlap-safety (overlap is already impossible at any turnaround).
3. **Defer** per-vehicle override (docs = location-only MVP, mig 0037).
4. Surface cooldown to renters at the **search grid** (primary — full stores vanish there via
   `buildCard → null`) + on `StorefrontCard`; detail-page hint is secondary.

## TDD plan — 6 vertical cycles (one behavior each)
- **Cycle 1 — shared validator floor.** 🔴 **IN PROGRESS.** RED test committed (`fb51bae`):
  `packages/shared/tests/validators/location.test.ts` now asserts reject 0/30/59 (msg
  `'Turnaround must be at least 60 minutes'`) + accept 60. **NEXT (GREEN):** in
  `packages/shared/src/validators/location.ts` change `turnaroundSchema` `.min(0, 'Turnaround
  cannot be negative')` → `.min(60, 'Turnaround must be at least 60 minutes')`. Then
  `cd packages/shared && bunx vitest run tests/validators/location.test.ts` → green.
  ⚠ Also check the `updateLocationSchema` describe block (~L196-230) for any
  "accepts zero on update" test — flip it the same way if present (`.partial()` reuses the
  same field schema, so the floor applies to PATCH too — desired).
- **Cycle 2 — schema CHECK + backfill migration.**
  - `packages/shared/src/db/schema.ts` locations CHECK `locations_turnaround_non_negative`
    (`>= 0`) → rename `locations_turnaround_min_60` (`>= 60`).
  - `bun run db:generate --name turnaround_min_60`, then **hand-edit** the generated SQL so
    order is: DROP old CHECK → `UPDATE locations SET "defaultTurnaroundMinutes"=60 WHERE
    "defaultTurnaroundMinutes"<60;` → ADD new CHECK. (Backfill before constraint — review P1.)
  - `bun run db:migrate && bun run db:verify` (3 greens).
  - ⚠ **Migration number = `0048` collides** with unmerged #394 + #521 (both local 0048) →
    renumber + bump `_journal.json` `when` to `max(prev)+1` on merge (drizzle out-of-order
    gotcha in CLAUDE.md).
  - **2a (CI gate):** integration test — **direct drizzle insert** (Zod-bypassed) of
    `defaultTurnaroundMinutes: 30` → expect Postgres CHECK violation `23514`. Add to
    `packages/api/tests/integration/locations.test.ts` (or a new file). The integration DB is
    migrated out-of-band (global-setup only seeds the operator).
  - **2b (backfill lift):** NO in-suite harness exists → verify by **documented manual replay**
    on a scratch DB (migrate→0047, insert 30, run 0048, assert 60), recorded in the PR.
    Optional standalone smoke script; explicitly NOT in CI. (See issue execution-note comment.)
- **Cycle 3 — seed distribution.** `packages/shared/src/db/seed-data/locations.ts`: today only
  KIX overrides (1440), rest 2880 (2 distinct). Replace with e.g. Namba 60 · Shin-Osaka 90 ·
  KIX 1440 · Umeda 120 · Tennoji 90 · Sannomiya 180 · Kyoto 120 · Nara 180 · Osaka Castle 2880.
  Keep `DEFAULT_TURNAROUND_MINUTES = 2880` const. Test (`packages/shared/tests/db/seed-data.test.ts`):
  every loc ≥60, **≥3 distinct values**, ≤2 at 2880, ≥1 central in [60,180]. (Old "one override"
  assertion was a false green — replace it.)
- **Cycle 4 — API DTO.** `Storefront = Location & {operatorName}` already carries
  `defaultTurnaroundMinutes` (no repo change). Add `turnaroundMinutes: number` to
  `StorefrontSummary` in `services/storefront-detail.ts` (populate in `getDetail`) + to
  `StorefrontCard` in `services/storefront-search.ts` (populate in `buildCard`). Service unit
  tests assert the field for a known store.
- **Cycle 5 — renter web render.** `routes/$locale/search.tsx` `StoreGrid`: grid-level helper
  copy (recently-returned stores/cars may be hidden during turnaround; try later dates) +
  enriched empty-state. `vite/storefronts/StorefrontCard.tsx`: render "≈Nh turnaround between
  rentals" (format min→hours in web). `vite/storefronts/StorefrontDetailView.tsx`: same line +
  near-date hint (secondary). web vitest for card + grid copy. New i18n keys → add to all
  locales (en/ja/zh) + restart dev server.
- **Cycle 6 — operator form floor.** `packages/web/src/modules/locations/components/LocationForm.tsx`
  turnaround `<Input min={0}>` → `min={60}` (confirmed currently 0) + a form test. (Frozen
  Next.js tree — edits allowed for this one-liner; it shares the Zod validator already.)

## Acceptance criteria (from issue)
Floor enforced in Zod AND DB (Zod-bypass insert proves DB); backfill lifts <60 rows; seed
≥3 distinct/all ≥60/≤2 at 2880; renter sees turnaround on search card + grid helper + detail;
LocationForm min=60 tested; overlap/exclusion tests still green; full gate green
(shared+api+web unit, api integration, db:verify 3 greens, lint/tsc/boundaries).

## Logistics / gotchas
- **Shell cwd resets to `~/Dev/kuruma-rental` after every Bash call** — `cd` into the worktree
  in EACH command (or use absolute paths). Edits must use absolute worktree paths.
- Pre-commit (husky+lint-staged) runs biome + size + boundaries + tsc on staged files — fast.
- vitest (not bun:test). Biome import-sort is an ASSIST → `bunx biome check --write` (not `format`).
- DB for integration: `kuruma-test-pg` on :5432 (already running). Run `db:migrate` against it
  before integration tests after adding migration 0048.
- **Out of scope:** per-vehicle override; the near-future default-search-window UX (own follow-up).
- On finish: rebase onto `origin/marketplace-pivot`, push, PR `Closes #551`, drop `in-progress`.
