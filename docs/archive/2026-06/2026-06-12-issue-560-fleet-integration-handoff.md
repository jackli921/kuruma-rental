# Handoff — #560 fleet CRUD integration into OperatorFleetView

**Date:** 2026-06-12
**Status:** IMPLEMENTED + SELF-REVIEWED, all gates green, **NOT pushed** (awaiting your push/PR/merge)
**Issue:** #560 (epic #523, part of #526). Closing #560 + the already-merged #555–#559 completes #526.

## Where the work lives
- **Worktree:** `/Users/jack/Dev/kuruma-560-fleet-integration`
- **Branch:** `feat/560-fleet-integration` (base `marketplace-pivot`, rebased clean onto tip `7b3a9dc`)
- **4 commits on top of trunk:**
  - `dd815b6` slice 1 — row selection + BulkActionBar
  - `7004c1f` slice 2 — FleetFilters sidebar mounted
  - `08b677b` slice 3 — row actions + Add button + EditVehicleSheet
  - `26936c8` review fixes (M1 + L1 + architect #3)

## What it does
Mounts the 5 already-merged, self-contained fleet components into `OperatorFleetView`, which is now a **stateful container** (route still owns loader/suspense):
- **Selection** — native checkbox column + select-all (over *filtered* rows) → drives `BulkActionBar`. Select-all shows an **indeterminate** state on partial selection.
- **Filters** — `FleetFilters` aside; visible rows = `filterVehicles([...vehicles], filters)` (pure lib).
- **CRUD** — `FleetRowActions` per row (edit/maintenance/retire) + "Add vehicle" toolbar button → `EditVehicleSheet` (new file) hosting `VehicleForm` + `PhotoUpload`. Class options fetched lazily (`enabled: open`).

## Files changed (6)
- `packages/web/src/vite/operator-fleet/OperatorFleetView.tsx` (now stateful container)
- `packages/web/src/vite/operator-fleet/EditVehicleSheet.tsx` (**new** — Sheet host)
- `packages/web/src/routes/$locale/_business/manage/fleet.tsx` (dropped dead `locale` prop)
- `packages/web/tests/vite/operator-fleet/OperatorFleetView.test.tsx` (+QueryClient harness, +7 tests)
- `packages/web/messages/{en,ja,zh}.json` (added `business.vehicles.bulk.selectRow`)

No API/schema/migration changes. No new dependency.

## Gates (all green, verified)
- Full web suite **913/913** (152 files); fleet subset 49
- `tsc --noEmit` 0 (web + app + api via pre-commit)
- biome clean; i18n parity **813 keys × 3 locales**

## Review outcome (code-reviewer + architect agents)
No CRITICAL/HIGH. **Fixed:**
- **M1 (real bug):** stale `selectedIds` survived filtering → bulk could hit hidden rows. Now `effectiveSelectedIds = visibleIds.filter(id ∈ selectedIds)` is what `BulkActionBar` receives + drives `allSelected`. Regression test: "drops hidden rows from the bulk selection when a filter excludes them".
- **L1:** added indeterminate select-all.
- **Architect #3:** removed dead `locale`/`_locale` prop from view + route.

**Deliberately skipped (with reason):**
- M2 (onDone/onClear both = `clearSelection`) — YAGNI; `BulkActionBar` already invalidates `FLEET_QUERY_KEY` on success. No seam needed yet.
- L2 (widen shared `filterVehicles` to `readonly T[]` to drop the `[...]` spread) — out of scope (shared lib, other callers); trivial at 40-50 vehicles.
- Architect #1 (extract `FleetTable` presentational) — deferred; file is ~205 lines, well under the 400 soft / 800 hard cap. Do it only when a future slice adds table behavior (sort/pagination/#561 grid).

## REMAINING STEPS (your turn)
1. `cd /Users/jack/Dev/kuruma-560-fleet-integration && git push -u origin feat/560-fleet-integration`
2. `gh pr create --base marketplace-pivot --title "feat(operator): mount fleet CRUD into OperatorFleetView (#560)" --body "Closes #560 …"`
3. **Manual browser smoke** (the issue's only remaining gate): `bun run dev`, sign in as an operator, visit `/<locale>/manage/fleet` — add a vehicle, edit one (incl. photo upload), maintenance/retire, bulk status, filter + select.
4. Merge squash → **manually** close #560 + drop `in-progress` label (base ≠ default branch, so GitHub won't auto-close).
5. Teardown: `git worktree remove ../kuruma-560-fleet-integration`.
6. Follow-up still open: **#561** (grid/grouped view toggle, P2).

## Resume mid-session
`claude --continue` in this repo, or re-read this doc. The worktree is intact and clean; `git log --oneline -4` shows the 4 commits above the trunk tip.
