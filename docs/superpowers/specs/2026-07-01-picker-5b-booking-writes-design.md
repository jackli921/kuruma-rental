# Picker slice 5b — booking writes as the picked operator

Date: 2026-07-01
Epic: #1230 (admin operator-context picker)
Follows: slice 5a (bookings read filter, PR #1317, merged develop `d1027e4c`)
Prior spec: `docs/superpowers/specs/2026-06-26-admin-operator-context-picker-design.md`

Revision 2 (2026-07-01): folds in spec-review findings P1 (block reads must narrow too) and P2 (the vehicle narrow must gate on the privileged tier, not the public-catalog `all` scope).

## Problem

A `PLATFORM_ADMIN` can pick an operator context (the picker, slices 0-4) and, since 5a, sees that operator's bookings narrowed on the calendar.
But the *write* affordances — "New Booking" (manual/walk-in) and "Schedule Block" — are still hidden for a picker-admin, because their gates require a tenant-scoped operator session (`isOperatorSession`).
5a deliberately deferred writes to 5b.

The goal of 5b: let a picker-admin create a manual booking and a vehicle block **as the picked operator**, with a calendar view model that is fully scoped to that operator — every tenant-shaped read on the surface, not just the most visible one.

## Key insight — the API already authorizes these writes

Unlike slice-1 config writes (which thread a body `operatorId` for bypass callers), booking and block writes **derive `operatorId` from the chosen vehicle**, not from a body field:

- Manual booking: `routes/bookings.ts` `POST /bookings` -> `services/booking-creation.ts` sets `operatorId = vehicle.operatorId`.
  The repo's create-time tenant check only fires for `scope.kind === 'operator'`; a `PLATFORM_ADMIN` (bypass) skips it.
- Vehicle block: `routes/vehicle-blocks.ts` `POST /vehicles/:vehicleId/blocks` -> `services/vehicle-block.ts` sets `operatorId = vehicle.operatorId`, tenant boundary at `vehicleRepo.findById(ctx, vehicleId)`.

Proof the API already permits it: `packages/api/tests/routes/manual-booking.test.ts:157-193` — a `PLATFORM_ADMIN` `POST /bookings` returns `201`.

Therefore 5b needs **no new write-authorization surface**.
The security boundary is the vehicle tenancy: a write always lands on the chosen vehicle's true operator, and a `PLATFORM_ADMIN` may write for any operator by design.
"Picked operator" is a client-side UX context with no server counterpart, so there is nothing to enforce server-side.

## The scope-coherence principle (why P1 matters)

The bookings calendar is composed from **three** tenant-shaped reads: bookings, vehicles (columns + dialog pickers), and vehicle blocks.
Since the write dialogs are opened from this surface, every one of those reads must share the picked-operator scope.
If any single read stays cross-operator while the others narrow, the surface *looks* scoped to X but still surfaces — and, with the write gates flipped, lets the admin **mutate** — operator Y's records.

Concretely, block bands are not dropped by the calendar's client filters (unknown vehicle ids still render; week/month views carry no vehicle-column list at all), so an un-narrowed `GET /vehicle-blocks` renders Y's blocks to an admin acting as X, and `deleteBlock` (which resolves any vehicle for a bypass admin) then lets them delete one via `BlockDetailDialog`.
So 5b narrows **all three** reads, server-side.

## Non-goals

1. **No server-side defense-in-depth check tying a write to the picked operator.**
   A mis-pick (admin acts "as X" but selects Y's vehicle) is a UX/consistency issue, not a cross-tenant leak — the booking still lands on Y, an operator the admin is authorized to write for.
   There is no server notion of "the admin's picked operator" to validate against.
2. **Customer search stays global for admin.**
   `CustomerService.search` returns the full user table for `PRIVILEGED_ROLES` (`PLATFORM_ADMIN`); renters are cross-operator (a renter can book any operator), so scoping the "existing customer" search to the picked operator is neither required nor desired.
3. **No change to the booking/block write APIs** — they already authorize the admin.
4. **No change to 5a's read narrowing.**

## Design

The slice scopes the whole calendar view model to the picked operator, then opens the write gates.
Per owner decision, the vehicle list narrows across the **whole** calendar (columns + dialogs), server-side; the same treatment now extends to block bands.

### 1. API — server-narrow `GET /vehicles` (privileged-tier gated)

The vehicle read path is `GET /vehicles` -> `VehicleService.findAll(ctx, filters)` -> repo `findAll`, which scopes via `operatorReadScope(ctx)` (kinds `operator` / `none` / `all`).
`VehicleFilters` has no `operatorId` today; `findAll` is a pass-through.

The vehicle catalog is **public** — `operatorReadScope` maps renters and partners to `all` by marketplace design, so `all` is *not* a bypass-only branch.
That is exactly the trap the `narrowReadToOperator` doc (`tenancy.ts`) warns slices 5a/5b/6 about: keying the narrow off `operatorReadScope` would echo a renter's `?operatorId=`.
Vehicles have no private-read resolver whose `all` means "privileged bypass" (unlike bookings/blocks), so the narrow is gated on the platform tier **explicitly**, matching the effective gate of 5a's booking narrow and the block narrow below (both resolve to `PLATFORM_ADMIN`).

Changes:

- `repositories/types.ts`: add `operatorId?` to `VehicleFilters`, doc'd "RESOLVED privileged-tier narrowing, set only by `VehicleService`".
- `services/vehicle.ts` `findAll(ctx, filters?, requestedOperatorId?)`: resolve the narrow as `PRIVILEGED_ROLES.has(ctx.role) ? requestedOperatorId : undefined` and inject it into filters only when set.
  This is the single tier-enforcement point (the #1272 "enforce once, below the route" pattern) — a renter/partner/operator `?operatorId=` is dropped here.
- `repositories/drizzle/vehicle.ts` and `repositories/in-memory/vehicle.ts` `findAll`: inside the existing `scope.kind === 'all'` branch, apply `eq(vehicles.operatorId, filters.operatorId)` when it is present.
  (Base tenant scoping via `operatorReadScope` is unchanged; a scoped operator or `none` caller never reaches this branch, and the service guarantees only a privileged caller ever sets the field.)
- `routes/vehicles.ts` `GET /vehicles`: read `c.req.query('operatorId')` and pass it as `requestedOperatorId`.
  An empty `?operatorId=` is falsy -> no narrow.

### 1b. API — server-narrow `GET /vehicle-blocks` (bypass-only via its own resolver)

The block read path is `GET /vehicle-blocks` -> `VehicleBlockService.listBlocks(ctx, from, to)` -> repo `findOverlappingInRange(ctx, from, to)`, scoped by `vehicleBlockReadScope(ctx)` (`operator` -> own, bypass admin -> `all`, PARTNER/renter/legacy -> `none`).
Unlike vehicles, this resolver's `all` **is** bypass-only (PARTNER is branched to `none` before the bypass check), so the standard `narrowReadToOperator` idiom applies cleanly with no vocabulary mismatch.

Changes:

- `repositories/types-vehicle-block.ts`: `findOverlappingInRange(ctx, from, to)` gains an optional 4th positional param `requestedOperatorId?: string` (RESOLVED, set only by the service).
- `repositories/drizzle/vehicle-block.ts` and `repositories/in-memory/vehicle-block.ts`: the `all` case (today the fall-through that pushes no operator condition) applies `eq(vehicleBlocks.operatorId, requestedOperatorId)` when the id is present.
- `services/vehicle-block.ts` `listBlocks(ctx, from, to, requestedOperatorId?)`: `narrowReadToOperator(ctx, requestedOperatorId, vehicleBlockReadScope)` and pass the resolved id to `findOverlappingInRange`.
- `routes/vehicle-blocks.ts` `GET /vehicle-blocks`: read `c.req.query('operatorId')`, pass as `requestedOperatorId`.

### 2. Web — thread the pick + flip the gates

Files: `packages/web/src/routes/$locale/_business/manage/bookings/index.tsx` and `packages/web/src/vite/operator-bookings/api.ts`.

- `api.ts`:
  - `fetchCalendarVehicles(pickedOperatorId?)` -> `GET /vehicles?limit=...&operatorId=<picked>` (only when set); `operatorCalendarVehiclesQueryOptions(pickedOperatorId?)` adds the pick to the query key.
  - `operatorCalendarBlocksQueryOptions(from, to, pickedOperatorId?)` (and its fetch) -> `GET /vehicle-blocks?...&operatorId=<picked>`; the pick joins the query key.
- `index.tsx`: thread `pickedOperatorId` (already in scope via `useOperatorContext()`) into the vehicles query, the blocks query, and the locations query.
  Because both dialogs receive `vehicles={vehicles}` from this component, the calendar columns **and** the New-Booking / Schedule-Block vehicle pickers all narrow to X in one change; block bands narrow via the blocks query.
- Gate flip: `canManualBook` and `canManageBlocks` change from `isOperatorSession(session)` to `canWriteAsOperator(session, pickedOperatorId)` (helper already exists, `packages/web/src/vite/guards.ts:59`).
- Locations: `operatorLocationsQueryOptions(pickedOperatorId)` — the query already accepts the pick (`operatorId=<picked>` via `buildScopeParam`); the route just needs to pass it.
  Its `enabled` already follows `canManualBook`, so a picker-admin's location list turns on with the flipped gate.
- `csrfToken` is already passed to both dialogs.

Loader note: 5a threads the pick into the component query but not the route loader (`loaderDeps` omits `operator`), so the loader pre-warms the un-picked query and the component fetches the narrowed one on mount.
5b mirrors this; whether to also thread the pick into the loader (to avoid a brief all-operator flash) is a plan-level refinement, not a design change.

## File change map (grounded against develop `be6def1f`)

API:
- `packages/api/src/repositories/types.ts` — `VehicleFilters.operatorId`
- `packages/api/src/repositories/types-vehicle-block.ts` — `findOverlappingInRange` optional `requestedOperatorId`
- `packages/api/src/services/vehicle.ts` — `findAll` privileged-tier narrow
- `packages/api/src/repositories/drizzle/vehicle.ts` — `findAll` `all`-branch narrow
- `packages/api/src/repositories/in-memory/vehicle.ts` — `findAll` `all`-branch narrow
- `packages/api/src/routes/vehicles.ts` — `GET /vehicles` reads `operatorId`
- `packages/api/src/services/vehicle-block.ts` — `listBlocks` narrow via `vehicleBlockReadScope`
- `packages/api/src/repositories/drizzle/vehicle-block.ts` — `findOverlappingInRange` `all`-branch narrow
- `packages/api/src/repositories/in-memory/vehicle-block.ts` — same
- `packages/api/src/routes/vehicle-blocks.ts` — `GET /vehicle-blocks` reads `operatorId`

Web:
- `packages/web/src/vite/operator-bookings/api.ts` — vehicles + blocks queries thread the pick
- `packages/web/src/routes/$locale/_business/manage/bookings/index.tsx` — gate flips; vehicles, blocks, locations queries thread the pick

No migration.
No i18n string changes (parity unaffected).

## Testing (mirror 5a's pyramid, extended for P1/P2)

Vehicles:
- In-memory repo unit: admin narrows to X; `none` sees nothing; a scoped operator's read is unaffected by a foreign `operatorId`.
- Service unit (the tier gate — the P2 fix): `PLATFORM_ADMIN` narrows; **renter, partner, and legacy STAFF/ADMIN passing `?operatorId=` are NOT narrowed** (param dropped); a scoped operator ignores it. RED-verify the renter-drop case.
- Route test (`tests/routes/vehicles.test.ts`): `?operatorId=` narrows for an admin, is ignored for a renter/operator, empty param no-ops.
- Real-pg integration (`tests/integration/vehicle-operator-narrow.test.ts`, 2 operators): admin control sees both, admin narrows to one, tenant/renter stays clamped.

Blocks (the P1 fix):
- In-memory repo + service unit: admin narrows blocks to X; admin with no pick sees all; a scoped operator is clamped to its own; the narrow rides `vehicleBlockReadScope` so PARTNER/renter never reach it.
- Route test (`tests/routes/vehicle-blocks.test.ts`): `?operatorId=` narrows the fleet-wide read for an admin.
- Real-pg integration: 2 operators' blocks in range; admin narrows to one.

Web unit:
- Gates flip to `canWriteAsOperator` (picker-admin with a pick can manual-book / manage blocks; without a pick cannot).
- `operatorCalendarVehiclesQueryOptions`, `operatorCalendarBlocksQueryOptions`, and `operatorLocationsQueryOptions` thread the pick into their keys/URLs.

E2E: optional, likely deferred as in 5a.

## Vertical slice

API narrows (vehicles + blocks) + web threading + gate flips ship together as one demoable unit:
a picker-admin picks operator X, sees only X's vehicles, blocks, and locations on a coherent calendar, and creates a manual booking / vehicle block for X — with no path to view or mutate another operator's records from that surface.

## Execution

Worktree `~/Dev/kuruma-picker-5b`, branch `feat/picker-slice-5b-booking-writes`, off develop `be6def1f`.
Own docker Postgres for real-pg tests (`export DATABASE_URL=...`); run api unit via `bunx vitest run` (not `bun test`).
TDD, one vertical cycle at a time, following the writing-plans output.
