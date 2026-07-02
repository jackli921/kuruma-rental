# Design — Picker-ize `/manage/fleet` (#1264)

- **Issue:** #1264 (feat, `enhancement`) — refs epic #1230 (operator-context picker), #407.
- **Slice:** epic #1230 Slice 4 residual (Slice 4 shipped the dashboard fleet-overview scoping in #1263; `/manage/fleet` deliberately stayed all-mode).
- **Branch:** `feat/1264-fleet-picker` off `origin/develop` (`71277a76`).
- **Date:** 2026-07-01.
- **Status:** APPROVED — design + 3-agent review (architecture, fact-check, risk) folded. All 15 factual claims verified against code.

## 1. Problem

A `PLATFORM_ADMIN` (JWT `operatorId: null`, read scope `all`) uses the operator-context picker (`?operator=<id>` on `/$locale/_business`) to operate *as* one operator across the business console.
Every console page honors the pick except `/manage/fleet` and its detail drill-down `/manage/fleet/$vehicleId`:

- The fleet list calls `operatorFleetQueryOptions()` with no picked id, so a bypass admin always sees the cross-operator aggregate and cannot act as one operator.
- `canWrite` is `isOperatorSession(session)` (`fleet/index.tsx:66`, `$vehicleId.tsx:40`) — a bypass admin can never write, even after picking.
- The Add/Edit vehicle form's **class** and **pickup-location** dropdowns list every operator's rows (`includeAll=true`). Because of the composite FKs `vehicles_operatorId_classId_fk` and `vehicles_operatorId_pickupLocationId_fk` (`packages/shared/src/db/fleet.ts:172-185`), picking a foreign operator's class or location 422s on submit.

## 2. Scope decision — web-only

The API is already picker-ready; **no API or migration change** (verified):

- `/vehicles/fleet-overview` already accepts a bypass-gated `?operatorId` (Slice 4 / #1263) via `narrowReadToOperator(ctx, id, bookingReadScope)` (`tenancy.ts:126-132`) — applied **only** when the caller's scope is `all`, so an operator caller can never widen (`services/fleet-overview.ts:14-28`).
- Vehicle writes already authorize a `PLATFORM_ADMIN` bypass caller to act on a named operator:
  - **CREATE** — `createVehicleSchema.operatorId` is optional (`validators/vehicle.ts:97`); `resolveOperatorIdForWrite(ctx, body.operatorId)` honors it for bypass callers, ignores it for `OPERATOR_*` (token wins) (`tenancy.ts:212-222`).
  - **UPDATE / STATUS / BULK / RETIRE** — the repo scopes by `operatorReadScope(ctx)`: `all` → no `operatorId` filter (bypass may touch any vehicle by id); `operator` → `WHERE operatorId = ctx.operatorId`. PATCH additionally **strips `operatorId`** (`repositories/drizzle/vehicle.ts:222`), so a vehicle can never be reassigned between tenants.
- Detail read (`/vehicles/:id/detail`, by-id, tenant-sealed but returns any vehicle under scope `all`), photo upload/delete, and status/maintenance all resolve correctly under scope `all`.

Mirrors Slice 5b (booking/block writes), also web-only.

## 3. Design — the changes (all in `packages/web`)

### 3.0 The scope rule (one rule, applied everywhere)

The vehicle **form's dropdown scope is the vehicle's operator, not the ambient pick**:

```
dropdownOperatorId = vehicle?.operatorId ?? pickedOperatorId
```

- **Create** (`vehicle == null`) → `pickedOperatorId` (the tenant the new vehicle will belong to).
- **Edit** (`vehicle != null`) → `vehicle.operatorId` (the tenant that owns the composite FK).

This is correct on **both** routes. On the list, edit's `vehicle.operatorId` equals the pick anyway (list is server-narrowed). On the detail route, it is what prevents the picked-A / viewing-B composite-FK 422. For an operator session both terms are undefined → `includeAll=true`, which the `/manage` endpoint ignores (token wins) — byte-for-byte unchanged.

*Missing Aggregate Boundary — the class/location and the vehicle must stay consistent (composite FK), so the option scope is owned by the vehicle's operator, not by unrelated UI state.*

### 3.1 Register only the LIST route as a picker route
Add to `OPERATOR_CONTEXT_ROUTE_IDS` (`vite/operator-context/operator-context.ts`):
- `/$locale/_business/manage/fleet/` (its reads narrow to the pick → chip is truthful).

**Do NOT register** `/$locale/_business/manage/fleet/$vehicleId` — its read is by-id and unaffected by the pick, so a chip there would misrepresent scope (registry doctrine, `operator-context.ts:92-96`). Edit still works because `retainSearchParams(['operator'])` (`_business.tsx:34`) carries the pick onto the detail page.

### 3.2 Thread the picked operator into the LIST reads (key parity)
The picked id must reach **all** read call sites so the loader-prefetched key matches the component read key (else `useSuspenseQuery` re-suspends after the loader with no pending UI):

- `routes/.../fleet/index.tsx`: add `loaderDeps: ({ search }: { search: FleetSearch & { operator?: string | undefined } }) => ({ operator: search.operator })` (the widened type is required — `FleetSearch` has no `operator`; the param is inherited from `_business` and merges at runtime, per the shipped `bookings/index.tsx:86-92`). Loader → `operatorFleetQueryOptions(deps.operator)` + `vehicleClassOptionsQueryOptions(deps.operator)`. Component reads `useOperatorScope()` and passes `scope.pickedOperatorId` into the same options.

### 3.3 Scope the dropdown fetches (`vite/operator-fleet/api.ts`)
Replace hardcoded `includeAll=true` with `buildScopeParam(dropdownOperatorId)`:
- `fetchVehicleClassOptions(operatorId?)` + `vehicleClassOptionsQueryOptions(operatorId?)` (key on `operatorId ?? 'all'`).
- `fetchPickupLocationOptions(operatorId?)` + `pickupLocationOptionsQueryOptions(operatorId?)` — keeps `includeArchived=true`, swaps `includeAll` for `buildScopeParam`.

`EditVehicleSheet` computes `dropdownOperatorId = vehicle?.operatorId ?? pickedOperatorId` (per §3.0) and passes it into both its `useQuery` calls. `pickedOperatorId` reaches the sheet via a new prop from its two mounts:
- **List:** `OperatorFleetView` (gains `scope`) → `EditVehicleSheet`.
- **Detail:** `VehicleDetail` (gains `pickedOperatorId`) → `EditVehicleSheet`.

### 3.4 Writes
- `canWrite` becomes `canWriteAsOperator(session, pickedOperatorId)` on both routes (list via `useOperatorScope().canWrite`; detail via `useOperatorContext()` + `canWriteAsOperator`), replacing `isOperatorSession`.
- **CREATE** body carries the picked tenant. In `VehicleForm`'s `mutationFn` (`VehicleForm.tsx:184-186`), inject on create only: `createVehicle(pickedOperatorId ? { ...data, operatorId: pickedOperatorId } : data, csrfToken)`. **No `WithOperatorId` wrapper** — `CreateVehicleInput.operatorId` is already optional (`validators/vehicle.ts:97`), so the wrapper is dead code (knip would flag the unused import). `VehicleForm` gains a `pickedOperatorId?: string` prop, threaded route → `OperatorFleetView`/`VehicleDetail` → `EditVehicleSheet` → `VehicleForm`.
- **UPDATE / STATUS / BULK / RETIRE** stay id-scoped — no `operatorId` in body (PATCH strips it anyway). Reads are already narrowed, so only the picked operator's rows are actionable; the API bypass `all` scope applies the mutation by id.

### 3.5 All-mode operator-labeled rows
`OperatorFleetView` takes a `scope: OperatorScope` prop (replacing the loose `canWrite`), consistent with the config Views (`OperatorLocationsView.tsx:31`, fees/insurance/add-ons). It derives one resolver and threads it (not a map + a flag) into `FleetTable` / `FleetGrid` (→ `FleetVehicleCard`):

```
const operatorNameFor = (v) => scope.showOperator ? scope.operatorNameById.get(v.operatorId) : undefined
```

Each leaf renders `<OperatorBadge name={operatorNameFor?.(v)} />` (reuse `@/vite/operator-context` `OperatorBadge`, i18n key `business.operatorContext.badge`, present in en/ja/zh — a sanctioned `operator-fleet → operator-context` barrel edge).

Note: fleet-overview reads via `bookingReadScope`, under which legacy `STAFF`/`ADMIN` resolve to `renter` and see **zero rows** (`tenancy.ts:162-168`), so only `PLATFORM_ADMIN` actually gets cross-operator rows — labeling is effectively PLATFORM_ADMIN-only regardless of the `showOperator` predicate. Accepted limitation: grid mode groups by class, so two operators' same-named classes render as duplicate group headers in all-mode (the per-row badge disambiguates the vehicles).

## 4. Security & regression invariants

- Every narrowing is UX over the already-enforced server boundary; reads bypass-gated, writes authorized server-side.
- **Operator-session parity is byte-for-byte:** `buildScopeParam(undefined) === 'includeAll=true'` (unchanged); `operatorFleetQueryOptions(undefined)` → `['operator-fleet','all']` (unchanged); `canWriteAsOperator(operatorSession, undefined)` → true via `isOperatorSession`; `showOperator` false → no `/operators` fetch, no badge.
- PATCH cannot reassign tenant (`vehicle.ts:222`).
- Bulk sends `effectiveSelectedIds = visibleIds ∩ selectedIds` (`OperatorFleetView.tsx:58,135`), so a stale cross-operator id cannot reach `PATCH /vehicles/bulk-status`. On an operator switch the new `vehicles` shrink the intersection to empty → `BulkActionBar` renders null. (No explicit selection-clear needed; the intersection is the seal. Optional cosmetic: `useEffect` on `pickedOperatorId` to also drop `selectedIds` — deferred, YAGNI.)

## 5. Testing (TDD, web vitest — `cd packages/web && bunx vitest run`)

No API/integration/migration change → web tests only.

**New behavior:**
1. `fetchVehicleClassOptions` / `fetchPickupLocationOptions` URL: `operatorId=X` when scoped, `includeAll=true` when not (fetch-mock URL assertions; keep the `includeArchived=true` assertion on locations). Mirror the existing fleet URL test (`api.test.ts:258-278`).
2. `operator-context.test.ts`: fleet **index** IS a picker route; fleet **detail** is NOT (assert both `OPERATOR_CONTEXT_ROUTE_IDS.has(...)` outcomes explicitly).
3. **Loader key-parity** (invoke `Route.options.loader({ context, deps:{ operator:'op_9' } })`, mirror `OperatorClassesRoute.test.tsx:77-93`): both `ensureQueryData` calls receive keys carrying `op_9` (`['operator-fleet','op_9']`, `['operator-fleet','class-options','op_9']`).
4. List route with `?operator=X`: picker chip shows, `canWrite` true, reads narrowed.
5. **Create body positive** (in `VehicleForm.test.tsx`, `createVehicle` already mocked): picked → `mock.calls[0][0]` `toMatchObject({ operatorId: 'op_9' })`. **Negative:** operator session / no pick → payload has **no** `operatorId` (`not.toHaveProperty('operatorId')`).
6. All-mode (bypass admin, no pick): read-only (no Add/bulk/edit affordances) + `OperatorBadge` on rows.
7. **Operator-session (common case):** `showOperator` false → **no** badge in tree and `operatorsQueryOptions` fetch **not** called.
8. **Detail-route edit gating:** picked admin → Edit present; unpicked admin → absent (`queryByRole('button', { name: editVehicle })`).
9. **Detail dropdown scoping (H1 guard):** editing a vehicle scopes the class/location fetch URL to the **vehicle's** operator, not the pick.

**Existing tests to update (enumerated — new props/mocks break these):** mock `@/vite/operator-context` with **`importOriginal` spread** overriding only `useOperatorScope` (mirror `OperatorFeesRoute.test.tsx:19-21`; a bare mock makes `OperatorBadge` undefined → "Element type is invalid" on every row).
- `OperatorFleetRoute.test.tsx` — add the `useOperatorScope` mock + `operators` seed; bypass read-only assertion survives as the all-mode case.
- `OperatorFleetView.test.tsx` (`renderView`) — pass a `scope` object (~30 tests).
- `VehicleForm.test.tsx` (`renderForm`), `VehicleDetail.test.tsx` (`renderDetail`) — new optional `pickedOperatorId` prop.
- `FleetVehicleCard.test.tsx`, `FleetRowActions.test.tsx`, `FleetEditAction.test.tsx` — new optional badge/resolver prop (keep optional to minimize churn).

## 6. Out of scope / non-goals

- No API change, no DB migration, no new API read/write param.
- No new i18n keys (reuse `business.operatorContext.badge`).
- No change to operator-session behavior.
- Detail route NOT registered in `OPERATOR_CONTEXT_ROUTE_IDS` (chip deliberately absent; write still enabled).
- Grid group-header operator disambiguation (accepted all-mode limitation).
- Explicit selection-clear on operator switch (intersection seal suffices).

## 7. Verification before PR

- `cd packages/web && bunx vitest run` green (full web suite).
- `tsc --noEmit` (web) clean; `bun run lint` (biome + `lint:size` + `lint:modules`) clean.
- CI/pre-commit gates this slice touches: `lint:i18n-parity` (no new keys, but run it), `lint:fetch-binding` (api.ts fetch edits), `lint:csrf-writes` (create path), `lint:deps`/knip (no unused `WithOperatorId` import — see §3.4).
- `vite build` (regenerates `routeTree.gen.ts`) clean.
- No `db:generate` / `db:verify` (no schema change).
- PR references #1230 but does NOT close it (Slice 6 Team + #1324 badge watermark remain); `Closes #1264`.
