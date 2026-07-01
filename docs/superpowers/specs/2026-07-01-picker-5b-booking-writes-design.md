# Picker slice 5b — booking writes as the picked operator

Date: 2026-07-01
Epic: #1230 (admin operator-context picker)
Follows: slice 5a (bookings read filter, PR #1317, merged develop `d1027e4c`)
Prior spec: `docs/superpowers/specs/2026-06-26-admin-operator-context-picker-design.md`

## Problem

A `PLATFORM_ADMIN` can pick an operator context (the picker, slices 0-4) and, since 5a, sees that operator's bookings narrowed on the calendar.
But the *write* affordances — "New Booking" (manual/walk-in) and "Schedule Block" — are still hidden for a picker-admin, because their gates require a tenant-scoped operator session (`isOperatorSession`).
5a deliberately deferred writes to 5b.

The goal of 5b: let a picker-admin create a manual booking and a vehicle block **as the picked operator**, with a UI that is coherent with the operator they have chosen to act as.

## Key insight — the API already authorizes these writes

Unlike slice-1 config writes (which thread a body `operatorId` for bypass callers), booking and block writes **derive `operatorId` from the chosen vehicle**, not from a body field:

- Manual booking: `routes/bookings.ts` `POST /bookings` -> `services/booking-creation.ts` sets `operatorId = vehicle.operatorId`.
  The repo's create-time tenant check only fires for `scope.kind === 'operator'`; a `PLATFORM_ADMIN` (bypass) skips it.
- Vehicle block: `routes/vehicle-blocks.ts` `POST /vehicles/:vehicleId/blocks` -> `services/vehicle-block.ts` sets `operatorId = vehicle.operatorId`, tenant boundary at `vehicleRepo.findById(ctx, vehicleId)`.

Proof the API already permits it: `packages/api/tests/routes/manual-booking.test.ts:157-193` — a `PLATFORM_ADMIN` `POST /bookings` returns `201`.

Therefore 5b needs **no new write-authorization surface**.
The security boundary is the vehicle tenancy: a write always lands on the chosen vehicle's true operator, and a `PLATFORM_ADMIN` may write for any operator by design.
"Picked operator" is a client-side UX context with no server counterpart, so there is nothing to enforce server-side.

## Non-goals

1. **No server-side defense-in-depth check.**
   A mis-pick (admin acts "as X" but selects Y's vehicle) is a UX/consistency issue, not a cross-tenant leak — the booking still lands on Y, an operator the admin is authorized to write for.
   There is no server notion of "the admin's picked operator" to validate against, so a check would add a body field and validation for zero security gain (YAGNI).
2. **Customer search stays global for admin.**
   `CustomerService.search` returns the full user table for `PRIVILEGED_ROLES` (`PLATFORM_ADMIN`); renters are cross-operator (a renter can book any operator), so scoping the "existing customer" search to the picked operator is neither required nor desired.
3. **No change to the booking/block write APIs** — they already authorize the admin.
4. **No change to 5a's read narrowing.**

## Design

The slice makes the UI coherent: scope what the picker-admin sees and picks to the operator they act as, then open the write gates.
Per owner decision, the vehicle list narrows **across the whole calendar** (columns + dialogs), server-side — mirroring 5a's bookings pattern and the existing locations pattern.

### 1. API — server-narrow `GET /vehicles` (bypass-gated, mirrors 5a)

The vehicle read path is `GET /vehicles` -> `VehicleService.findAll(ctx, filters)` -> repo `findAll`, which scopes via `operatorReadScope(ctx)` (kinds `operator` / `none` / `all`).
`VehicleFilters` has no `operatorId` today; `findAll` is a pass-through.

Changes (identical shape to 5a's `BookingFilters.operatorId`):

- `repositories/types.ts`: add `operatorId?: string` to `VehicleFilters`, doc'd "RESOLVED bypass-only narrowing, set only by `VehicleService`".
- `repositories/drizzle/vehicle.ts` `findAll`: inside the **`scope.kind === 'all'`** branch only, when `filters.operatorId` is present push `eq(vehicles.operatorId, filters.operatorId)`.
  H2 invariant: the requested id is read only in the bypass branch — never presence-gate the whole scope, so a scoped operator can never widen or redirect its own read.
- `repositories/in-memory/vehicle.ts` `findAll`: the same narrow in the bypass branch.
- `services/vehicle.ts` `findAll(ctx, filters?, requestedOperatorId?)`: compute `narrowReadToOperator(ctx, requestedOperatorId, operatorReadScope)` and inject `operatorId` into filters only when it resolves.
  (`narrowReadToOperator(ctx, id, resolveScope)` takes the scope resolver as a parameter — `operatorReadScope` for vehicles, as `bookingReadScope` was for 5a.)
- `routes/vehicles.ts` `GET /vehicles`: read `c.req.query('operatorId')` and pass it as `requestedOperatorId`.
  An empty `?operatorId=` is falsy -> no narrow.

### 2. Web — thread the pick + flip the gates

File: `packages/web/src/routes/$locale/_business/manage/bookings/index.tsx` and `packages/web/src/vite/operator-bookings/api.ts`.

- `api.ts`: `fetchCalendarVehicles(pickedOperatorId?)` -> `GET /vehicles?limit=...&operatorId=<picked>` (only when set); `operatorCalendarVehiclesQueryOptions(pickedOperatorId?)` adds the pick to the query key.
- `index.tsx`: thread `pickedOperatorId` (already in scope via `useOperatorContext()`) into `operatorCalendarVehiclesQueryOptions(pickedOperatorId)`.
  Because both dialogs receive `vehicles={vehicles}` from this component, the calendar columns **and** the New-Booking / Schedule-Block vehicle pickers all narrow to X in one change.
- Gate flip: `canManualBook` and `canManageBlocks` change from `isOperatorSession(session)` to `canWriteAsOperator(session, pickedOperatorId)` (helper already exists, `packages/web/src/vite/guards.ts:59`).
- Locations: `operatorLocationsQueryOptions(pickedOperatorId)` — the query already accepts the pick (`operatorId=<picked>` via `buildScopeParam`); the route just needs to pass it.
  Its `enabled` already follows `canManualBook`, so a picker-admin's location list turns on with the flipped gate.
- `csrfToken` is already passed to both dialogs.

Loader note: 5a threads the pick into the component query but not the route loader (`loaderDeps` omits `operator`), so the loader pre-warms the un-picked query and the component fetches the narrowed one on mount.
5b mirrors this; whether to also thread the pick into the loader (to avoid a brief all-operator column flash) is a plan-level refinement, not a design change.

## File change map (grounded against develop `be6def1f`)

API:
- `packages/api/src/repositories/types.ts` — `VehicleFilters.operatorId`
- `packages/api/src/repositories/drizzle/vehicle.ts` — `findAll` bypass-branch narrow
- `packages/api/src/repositories/in-memory/vehicle.ts` — `findAll` bypass-branch narrow
- `packages/api/src/services/vehicle.ts` — `findAll` threads `requestedOperatorId` via `narrowReadToOperator`
- `packages/api/src/routes/vehicles.ts` — `GET /vehicles` reads `operatorId` query

Web:
- `packages/web/src/vite/operator-bookings/api.ts` — `fetchCalendarVehicles` / `operatorCalendarVehiclesQueryOptions` thread the pick
- `packages/web/src/routes/$locale/_business/manage/bookings/index.tsx` — gate flips, vehicles + locations queries thread the pick

No migration.
No i18n string changes (parity unaffected).

## Testing (mirror 5a's pyramid)

- In-memory repo unit (`tests/repositories/.../vehicle...` or existing vehicle repo test): admin narrows to X; a scoped operator ignores a foreign `operatorId`; `none` sees nothing. RED-verify the admin-narrow case fails before the repo gate.
- Service unit: `VehicleService.findAll` wires `narrowReadToOperator` — narrows for bypass, clamps for a scoped operator.
- Route test (`tests/routes/vehicles.test.ts`): `?operatorId=` narrows for an admin, is ignored for an operator, empty param no-ops.
- Real-pg integration (new `tests/integration/vehicle-operator-narrow.test.ts`, 2 operators): admin control sees both, admin narrows to one, tenant-passes-foreign stays clamped (repo gate, H2).
- Web unit: gates flip to `canWriteAsOperator` (picker-admin with a pick can manual-book / manage blocks; without a pick cannot); `operatorCalendarVehiclesQueryOptions` / `operatorLocationsQueryOptions` thread the pick into their keys/URLs.
- E2E: optional, likely deferred as in 5a.

## Vertical slice

API narrow + web threading + gate flips ship together as one demoable unit:
a picker-admin picks operator X, sees only X's vehicles and locations on a coherent calendar, and creates a manual booking / vehicle block for X.

## Execution

Worktree `~/Dev/kuruma-picker-5b`, branch `feat/picker-slice-5b-booking-writes`, off develop `be6def1f`.
Own docker Postgres for real-pg tests (`export DATABASE_URL=...`); run api unit via `bunx vitest run` (not `bun test`).
TDD, one vertical cycle at a time, following the writing-plans output.
