# Handoff — #551 turnaround floor + realistic seed + renter cooldown surfacing

**Date:** 2026-06-12 · **Issue:** [#551](https://github.com/jackli921/kuruma-rental/issues/551) (epic #385)
**Branch:** `feat/turnaround-floor-surfacing` · **Worktree:** `~/Dev/kuruma-turnaround-ux`
**Base:** `origin/marketplace-pivot` @ `a2a1c95` (was `a8cd5bb`; base moved +2) · **Tip:** `cdc37f8` · **NOT pushed.**
**Divergence:** 9 ahead / 2 behind origin/marketplace-pivot.

## Status: ALL 6 cycles DONE. Remaining = rebase → push → PR → close.

9 local commits, all pre-commit-clean (biome/size/boundaries/tsc x3):
- `fb51bae` c1 RED · `af15f50` early handoff · `efabb02` **c1** Zod floor `.min(60)`
- `34393ad` **c2** DB CHECK + migration 0048 + integration test
- `1f5ad1b` **c3** varied seed distribution
- `2271a5d` handoff refresh
- `b2973d1` **c4** API DTO — `turnaroundMinutes` on `StorefrontSummary` + `StorefrontCard`
- `2f3d12c` **c5** renter web — card + detail "~Nh turnaround between rentals", empty-state hint, i18n
- `cdc37f8` **c6** operator `LocationForm` input `min={0}` → `min={60}`

**Verified green:** web vitest **774 passed (126 files)** · api storefront unit tests pass · shared 420 (untouched) · db:verify 4/4 (schema untouched since c2). Typechecks pass via pre-commit on every commit (web tsconfig.json + tsconfig.app.json[tests] + api tsconfig.json).

**KNOWN pre-existing flake (NOT a #551 regression):** full `@kuruma/api test` shows 5 failures in
`auth-session` / `auth-middleware` / `rate-limit` under parallel run. They **pass in isolation**
(`bun run --filter @kuruma/api test auth-session rate-limit auth-middleware` → 22/22). Test-pollution
(shared env/singleton state), unrelated to storefront DTOs. The handoff gate only ran the integration
subset so never hit it. Don't chase it under this issue.

**Test DB** `kuruma-test-pg` (docker, :5432), migrated incl 0048;
`DATABASE_URL=postgres://kuruma:kuruma@localhost:5432/kuruma_test`.

## Why this exists (verified diagnosis — do not relitigate)
"Booked once = car gone forever" is **NOT a scheduling bug**. Overlap predicate, `bookings_no_overlap`
gist exclusion, and the `effectiveEndAt` trigger (mig `0037`) are all correct; booking does NOT flip
`vehicles.status`. The illusion = **every seeded location used 48h (2880m) turnaround** + near-future
search window, so a booking blocked the car ~5 days and every re-search overlapped it. c3 fixed the
seed; the floor (c1/c2) is a service-quality guarantee, not overlap-safety; surfacing (c4-c6) makes
the buffer visible so an empty near-future result is self-explaining.

## What each cycle shipped
- **c1** `shared/src/validators/location.ts` — `turnaroundSchema.min(60, 'Turnaround must be at least 60 minutes')`; `.partial()` reuse → PATCH inherits the floor.
- **c2** `shared/src/db/schema.ts:245` CHECK `locations_turnaround_min_60` (`>=60`); migration `drizzle/0048_turnaround_min_60.sql` is DROP → UPDATE backfill(<60→60) → ADD. Integration `api/tests/integration/locations-turnaround-floor.test.ts` (insert 30 → PG 23514, 60 persists).
- **c3** `shared/src/db/seed-data/locations.ts` varied (60/90/120/90/180/120/180/1440/2880); `shared/tests/db/seed-data.test.ts` floor / ≥3 distinct / ≤2 at max / ≥1 central asserts.
- **c4** `api/src/services/storefront-{detail,search}.ts` — `turnaroundMinutes` added to both DTOs, populated from `storefront.defaultTurnaroundMinutes` (no repo change; routes pass `ok(c, result.data)` through, no whitelist). Tests co-located in `src/services/*.test.ts`.
- **c5** web (live Vite tree): `vite/storefronts/turnaround.ts` pure `turnaroundHours()` (round to nearest 0.5h) + test; `turnaroundMinutes` on `vite/storefronts/api.ts` DTOs; `StorefrontCard.tsx` + `StorefrontDetailView.tsx` render a `Clock` line `t('turnaround',{hours})`; `routes/$locale/search.tsx` empty-state gains `t('emptyTurnaroundHint')`; new i18n keys `turnaround` + `emptyTurnaroundHint` in `messages/{en,ja,zh}.json` (parity test green). Component tests in `tests/vite/storefronts/` updated (fixtures + assertions).
- **c6** `web/src/modules/locations/components/LocationForm.tsx:167` `min={60}`; `tests/modules/locations/LocationForm.test.tsx` asserts `min=60`.

## REMAINING — finish the slice
1. **Rebase** onto `origin/marketplace-pivot` (now `a2a1c95`, 2 ahead of branch base). No force-push (branch not pushed yet, so a plain rebase is fine; if you ever push then rebase, use reset→cherry-pick→ff-push per the no-force gotcha).
2. **Migration 0048 renumber at merge:** still collides with unmerged #394 (also local 0048; #521 moved to 0049). On rebase, if trunk now owns 0048, renumber `0048_turnaround_min_60` → next free, and bump its `_journal.json` `when` to `max(prev)+1` (drizzle out-of-order gotcha in CLAUDE.md). Re-run `bun run db:verify` (4/4) after.
3. **Push** `-u`, open PR **`Closes #551`**, drop the `in-progress` label, run **`/code-review`**.
4. Manual browser pass (optional, not blocking): renter search card + storefront detail show "~Nh turnaround"; empty-state shows the hint; operator LocationForm number input floors at 60. **Restart Vite dev** after pulling (new i18n keys): `rm -rf packages/web/.next` is N/A for Vite — just restart `bun run dev`.

## Logistics / gotchas
- **Shell cwd RESETS to `~/Dev/kuruma-rental` after every Bash call** — `cd` into the worktree each command.
- **vitest, not bun:test.** Run via `bun run --filter @kuruma/<pkg> test [namefilter]`.
- **Biome format is an ASSIST** — pre-commit reverts an unformatted staged file. `bunx biome check --write <files>` before commit.
- **web tests live under `packages/web/tests/`** (mirror of `src/`), NOT co-located. **api service tests ARE co-located** in `src/services/`.
- **Integration tests need `DATABASE_URL`** → `kuruma-test-pg:5432` (migrated to 0048).
- **Out of scope:** per-vehicle override; near-future default-search-window UX (own follow-up).

## Acceptance — all satisfied
Floor in Zod + DB (c1/c2), backfill (c2), seed ≥3 distinct/all≥60/≤2 at 2880 (c3), renter sees
turnaround on card + detail + empty-state hint (c4/c5), LocationForm min=60 tested (c6), overlap/
exclusion tests still green, web suite green. Pending only: rebase/renumber/push/PR/code-review.
