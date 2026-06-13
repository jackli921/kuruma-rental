# #526 Operator Fleet (Vite) — Foundation Complete, Handoff

**Date:** 2026-06-12
**Issue:** #526 `feat(web): port operator fleet (vehicles list + CRUD + photos) to Vite` (epic #523, part of #385/#378)
**Status (updated 2026-06-12, session 2):** Foundation **rebased clean onto trunk + PUSHED → PR #554** (full web suite 801 passed). All 7 follow-up issues **FILED**. Slice implementation **NOT started** (gated on #554 merging — slice files import `api.ts` which only lives on the foundation branch until merge).

### Session-2 progress
- Rebased `feat/526-operator-fleet-vite` onto `origin/marketplace-pivot` (advanced to `a2a1c95`; auto-merged `routeTree.gen.ts`+`messages/*.json`, `vite build` confirmed no routeTree drift). New tip `163e041`.
- Gates re-run green: tsc 0 (app+node), biome clean, vite build 0, i18n parity, **full web suite 801 passed / 0 failed**.
- Pushed branch + opened **PR #554** (base `marketplace-pivot`; advances #526, does not close).
- Filed slices: **#555** VehicleForm · **#556** FleetRowActions · **#557** PhotoUpload · **#558** FleetFilters · **#559** BulkActionBar · **#560** integration (sequential, LAST) · **#561** grouped/grid (deferred P2). Prop contracts live in each issue body + below. Tracking comment posted on #526.

### Resume from here
1. Merge **PR #554** to `marketplace-pivot` (review + CI). Repo ruleset blocks branch deletion, so any stacked PRs will need manual `gh pr edit --base marketplace-pivot` retarget after merge.
2. Once #554 is on trunk, the 5 slice files (#555–#559) can branch off trunk (they need `api.ts`). Dispatch in parallel or build sequentially.
3. Then #560 integration PR (only PR that edits `OperatorFleetView.tsx`), then #561 deferred grouping.

---
_Original session-1 notes below._



---

## Where things are

- **Worktree:** `~/Dev/kuruma-526-operator-fleet`
- **Branch:** `feat/526-operator-fleet-vite` (off `origin/marketplace-pivot`)
- **Commit:** `4b61eff` — `feat(operator): fleet management foundation + read-only list (#526)`
- **Position:** 1 ahead / **2 behind** `origin/marketplace-pivot` → **rebase before pushing** (expect `routeTree.gen.ts` + `messages/*.json` conflicts; resolve messages by keeping both, then re-run `vite build` to regen routeTree).
- `in-progress` label is on #526.
- **Trunk is `marketplace-pivot`, NOT `main`.** DB/seed knob: `DEMO_OWNER_EMAIL` (see `~/Dev/kuruma-marketplace-pivot`).

### Gates green this session (local)
web typecheck 0 · i18n parity 787 keys ×3 · biome clean · `vite build` 0 (fleet chunk emitted) · `tests/vite/operator-fleet` 5/5 · `tests/vite/nav` 19/19. Full web suite was 772 tests, the only failure was the nav-contract test which is now fixed (re-run `bun run --filter @kuruma/web test` to reconfirm 0 fail).

---

## The approved plan (decided with user)

User chose **full parity, decomposed into isolated single-file parallel issues** that separate agents can do **without merge conflicts**. The conflict-safety design:

> The 4 shared-file conflict surfaces are `routeTree.gen.ts`, `messages/{en,ja,zh}.json`, `operator-fleet/api.ts`, and `OperatorFleetView.tsx`. The **foundation owns all four**. Each parallel slice builds a **self-contained controlled component in NEW files only**, reads `api.ts` + existing i18n read-only, and **does NOT edit `OperatorFleetView.tsx`**. A final tiny **sequential integration PR** mounts the components into the view. New-files-only = airtight no-conflict.

So the remaining work is: **(A) file 5 parallel issues, (B) optionally run them in parallel, (C) one integration PR, (D) one deferred grouping follow-up.**

---

## What the foundation already provides (read-only contract for the slices)

### `packages/web/src/vite/operator-fleet/api.ts` (complete data layer)
All cookie-based (`credentials:'include'`, raw `fetch` + `unwrap()`, `getApiBaseUrl()`). Parallel slices import these, never re-declare:
- `OperatorFleetVehicle` (read DTO, ISO dates) · `FleetBookingSummary`
- `fetchOperatorFleet()` · `operatorFleetQueryOptions()` · `FLEET_QUERY_KEY` (for invalidation)
- `createVehicle(CreateVehicleInput)` · `updateVehicle(id, UpdateVehicleInput)`
- `updateVehicleStatus(id, status, reason?)` · `bulkUpdateVehicleStatus(ids, status)` · `retireVehicle(id)`
- `uploadVehiclePhotos(id, files)` · `deleteVehiclePhoto(id, url)` (+ `PhotoUploadResult`/`PhotoDeleteResult`)
- `fetchVehicleClassOptions()` · `vehicleClassOptionsQueryOptions()` (for the form's class dropdown)
- Re-exported canonical write types: `CreateVehicleInput`, `UpdateVehicleInput`, `VehicleStatus`, `BulkVehicleStatus` (from `@kuruma/shared/validators/vehicle`).

### `OperatorFleetView.tsx` — read-only table (status pill, sha-ken expiry pill, seats, luggage, price) + empty state. **Integration target** for the slices.

### Route `routes/$locale/_business/manage/fleet.tsx` + nav (`Navbar.tsx`, `MobileMenu.tsx` `NavTo` union) + i18n namespace `business.vehicles.fleet` (en/ja/zh).

---

## The 5 parallel slices to FILE (single-file each, NEW files, NO view edits)

Frozen Next.js sources to port from: `packages/web/src/components/vehicles/*` (FleetFilters, BulkActionBar, FleetGroupedList, AddVehicleDialog, EditVehicleDialog, VehicleForm, PhotoUpload, ExpiryBadge, VehicleStatusToggle, MaintenanceReasonDialog) and pure logic `packages/web/src/lib/fleet-filters.ts` (already has `tests/lib/fleet-filters.test.ts` 35 tests — reuse the pure logic).

Each component is **controlled** (state lives in the view at integration). Suggested prop contracts:

1. **Add/Edit form** → `vite/operator-fleet/VehicleForm.tsx`
   `{ vehicle: OperatorFleetVehicle | null; classOptions: VehicleClassOption[]; onSaved: () => void; onCancel: () => void }` (null = create). Uses `createVehicle`/`updateVehicle` + `useMutation` + `invalidateQueries(FLEET_QUERY_KEY)`. i18n: add `business.vehicles.fleet.form.*` (or reuse `business.vehicles.*` field labels — verify which exist).

2. **Status toggle + retire** → `vite/operator-fleet/FleetRowActions.tsx`
   `{ vehicle: OperatorFleetVehicle; onEdit: () => void }`. Status toggle (AVAILABLE↔MAINTENANCE w/ reason via existing `business.vehicles.maintenance.*`) + retire confirm. Uses `updateVehicleStatus`/`retireVehicle`.

3. **Photo upload** → `vite/operator-fleet/PhotoUpload.tsx`
   `{ vehicleId: string | null }` (null = create mode, disabled until saved). `uploadVehiclePhotos`/`deleteVehiclePhoto`. **Client-side size guard per #517** (server already 413s).

4. **Filters sidebar** → `vite/operator-fleet/FleetFilters.tsx` (+ reuse `lib/fleet-filters.ts` pure logic)
   `{ vehicles: OperatorFleetVehicle[]; value: FleetFilterState; onChange: (s) => void }`. i18n: add `business.vehicles.fleet.filters.*`.

5. **Bulk actions** → `vite/operator-fleet/BulkActionBar.tsx`
   `{ selectedIds: string[]; onDone: () => void; onClear: () => void }`. `bulkUpdateVehicleStatus`. i18n exists: `business.vehicles.bulk.*`.

**Deferred (sequential, after the 5):** grouped/grid view toggle (`FleetGroupedList` + `business.vehicles.fleet.rowView/gridView/summary` already exist) — touches the view's row rendering, so do it last to avoid conflicts. File as a follow-up on #523.

### Integration PR (sequential, last)
Mount the 5 components into `OperatorFleetView`: add a checkbox column + selection state, an "Add vehicle" button (`business.vehicles.fleet.addVehicle` exists), the filters aside, the `FleetRowActions` cell, the `BulkActionBar`, and an `EditVehicleSheet` host (base-ui `Sheet`) composing `VehicleForm` + `PhotoUpload`. Wire `editing`/`selectedIds`/`filters` state. Small, conflict-free because it's last.

---

## Gotchas learned this session (save the next agent the loop)

- **i18n path is `business.vehicles.fleet`, NOT `business.fleet`.** `fleet` is nested under `business.vehicles` (en.json line ~255 → ~435). Component/route use `useTranslations('business.vehicles.fleet')`.
- **IntlProvider in tests needs the FULL message tree.** Pass `messages={enMessages}` (whole import), then alias `const en = enMessages.business.vehicles.fleet` only for assertions. Passing the sub-object breaks namespace lookup.
- **`getByText` is exact-match on an element's own text.** Two values in one node (`plate · make`) won't match either alone — split into separate `<span>`s.
- **Price: use `formatVehicleRate(daily, hourly, {perDay, perHour})` from `@/lib/format`** (returns `¥8,000/day`, null if both null). i18n `perDay`/`perHour` are **suffixes** (`/day`, `/hr`), not `{price}/day`. Assert in tests via the same helper (yen-glyph/locale safe).
- **Adding a route requires `bun run --filter @kuruma/web build` to regen `routeTree.gen.ts` BEFORE typecheck** (typed `<Link>`/`NavTo` resolve against the gen). STAGE `routeTree.gen.ts`.
- **biome import-sort is an ASSIST action** — `bun run format` does NOT fix it; run `bunx biome check --write`.
- Vite shell MAY import `@kuruma/shared/*` (types/validators/lib) — confirmed convention; only `@/modules/*` internals are banned by `lint:modules`.

---

## Immediate next actions

1. `cd ~/Dev/kuruma-526-operator-fleet` → rebase onto `origin/marketplace-pivot` (resolve routeTree by `vite build`, messages by keep-both) → re-run gates.
2. Decide: push foundation now as its own PR (`Closes #526`? — better: keep #526 open as the umbrella and land foundation under it, OR retitle #526 "foundation" and file the 5 as new children of #523). **Recommend:** push foundation PR linking #526; file 5 new sub-issues + 1 grouping follow-up under #523.
3. File the 5 parallel issues (contracts above). They are safe to dispatch to parallel agents once the foundation PR merges (so they branch off a trunk that has `api.ts` + the view + i18n).
4. After the 5 merge: integration PR, then the deferred grouping follow-up.
