# Slice 6 (#392) — Tasks #8/#9/#10 COMPLETE — resume handoff

**Resume here after `/clear`.** Worktree: `/Users/jack/Dev/kuruma-slice6`
Branch: `feat/slice6-booking-events`. This supersedes the stale Task-8 *plan* doc
`docs/2026-06-05-slice6-task8-web-handoff.md` (committed `cea5ef7` by a parallel
session — see ⚠️ below; that doc planned Task #8, which is now done).

## STATE: gate GREEN, only #11 review + DRAFT PR remain
Branch is **27 ahead / 5 behind** `origin/marketplace-pivot` (it advanced during
the session). All of slice 6 is implemented + the full CI gate passes locally.

### What landed this session (on top of the rebased slice-6 work)
1. **Rebased all 20 slice-6 commits onto `origin/marketplace-pivot`** (which had
   merged #391 storefront layer). Migration collision resolved: my `0035/0036/0037`
   renumbered to **`0036/0037/0038`**, `0035_locations` (from #391) kept; `when`
   values bumped above 0035_locations (the skip-bug gotcha). `slice6-dev` Neon
   branch was **reset_from_parent + re-migrated** → `db:verify` 4/4 green,
   integration **17 files / 168 tests** green. (Snapshot under Neon branch
   `slice6-dev-pre-rebase-snapshot` if rollback needed.)
2. **Rebase-integration fixes** (#391 fixtures → slice-6 booking shape):
   `9b05feb` (unit storefront fixtures), `656ae1d` (storefronts integration).
3. **`5fc66ef` API** — `GET /storefronts/:locationId/insurance-options` (public,
   renter-safe projection of the operator's ACTIVE options). New repo method
   `findActiveByOperator` (raw operatorId, bypasses the [P0] ctx-scoped `findAll`
   seal — single-operator + active-only). 6 service + 4 route tests.
4. **`a6e3275` web** — vehicle-based `bookings/new` (summary + insurance dropdown)
   + confirmation (reservation code, insurance, feeSnapshot block); `createBooking`
   server action; `AvailableVehicleCard` now links to the form (was disabled).
   Dead class flow removed. i18n en/ja/zh (635 keys × 3). Tests rewritten.
5. **`3217b1e` E2E** — full `search → book → confirmation` journey (Playwright) via
   a forged Auth.js session cookie (`e2e/auth.ts`); mock-api extended. Both specs
   green. (Better than the planned form-onwards minimum — #391 is in now.)
6. **`654d59c`** — knip ignore `@auth/core`.

### Gate evidence (all GREEN, run from worktree root unless noted)
- `bun run lint` (biome + size + modules) — only pre-existing file-size WARNs.
- `bun run --filter '*' typecheck` — 3/3 exit 0.
- `bun run --filter @kuruma/api lint:boundaries` — OK.
- `bun run scripts/lint-export-drift.ts` — 25 paths OK.
- `bun run lint:fk-indexes` (33 FKs) / `lint:i18n-parity` (635×3) / `lint:deps` — OK.
- `bun run test` — shared 18 / api 66 / web 58 files, all green.
- `bun run --filter @kuruma/web build` — compiled OK.
- `bun run db:verify` — 4/4 (DATABASE_URL via worktree `.env` = `slice6-dev`).
- Integration: `cd packages/api && bun --env-file=../../.env run test:integration` → 168.
- E2E: `bunx playwright test e2e/booking.spec.ts e2e/storefront-search.spec.ts` → green.

## NEXT (resume here)
1. **Task #11 — code review**: run code-reviewer + architect-review on the diff
   `git diff origin/marketplace-pivot...HEAD`. Pay attention to the **[P0]
   security call** in `5fc66ef`: the public insurance read intentionally exposes
   ACTIVE insurance (price/deductible) to anonymous renters — consistent with
   #391 making the catalog public; preserves #404's seal intent via active-only,
   single-operator, renter-safe projection. Flag it in the PR body.
2. **Rebase** onto the new `origin/marketplace-pivot` tip (now +5: #420/#449/#450
   seed fixes, #416 e2e, #413, #453 docs) — never force-push a pushed branch, but
   this branch is **NOT pushed yet**, so a clean rebase + first push is fine.
   Re-run `db:verify` + a smoke of the suites after rebasing.
3. **Open DRAFT PR** to `marketplace-pivot` (NOT main). Body: link #392, list
   tasks #8/#9/#10, the security note, and that Resend/notifications are slice 7.
   Do **NOT** close #392 (PRs to the non-default branch don't auto-close; close
   manually only when the slice fully lands). Marketplace PRs are squash-merged.

## ⚠️ Flags
- **Parallel session in this worktree**: `cea5ef7` (Task #8 *plan* doc) was
  committed mid-session by another session running as the same git user. My work
  landed cleanly on top and the tree is clean, so it appears idle now — but
  confirm no other session is live here before resuming (CLAUDE.md danger zone:
  "another session's branch"). The stale plan doc can be deleted at PR cleanup.
- **`marketplace-pivot` moved +5** during the session → rebase before PR (step 2).

## Key gotchas (don't relearn)
- Reading `.env` via Bash is sandbox-blocked; load it with `bun --env-file=../../.env`.
- `slice6-dev` host = `ep-small-dawn-anzoxhc5` (NOT prod `ep-winter-surf-anys1b0p`).
- `effectiveEndAt` is DB-trigger-derived (endAt + pickupLocation turnaround).
- Booking column is `assignedVehicleId` (not `vehicleId`); web reads it too.
