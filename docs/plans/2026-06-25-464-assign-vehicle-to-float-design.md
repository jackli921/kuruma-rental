# #464 — Operator assigns a vehicle to a CLASS_COMBO float

Date: 2026-06-25 · Branch: `feat/464-assign-vehicle` · Issue: #464 (§1.1/§4/§5)
Status: **DESIGN — confirmed by owner; awaiting architect-review + implementation plan.**
Danger zone (booking lifecycle, exclusion-constraint interaction, append-only enum migration).

## Goal

A `CLASS_COMBO` booking is created car-less (a "float": `assignedVehicleId = NULL`,
`fulfillmentMode = 'CLASS_COMBO'`). This slice lets an operator assign a concrete
vehicle to that float on or before pickup day, the last unbuilt acceptance criterion
of #464. Full vertical slice: API + operator web UI + tests.

## Why this is a danger zone

- **Makes a float visible to the per-vehicle exclusion constraint.** A float with
  `NULL assignedVehicleId` is invisible to the GiST exclusion (`drizzle/0037`,
  `WHERE status IN ('CONFIRMED','ACTIVE')`). The moment we set a non-NULL
  `assignedVehicleId`, the constraint re-checks atomically — assigning a car already
  booked on the overlapping window must fail `23P01 → 409`, never double-book.
- **Pricing divergence.** A class deal is priced off the `class_rate_plan`,
  independent of which car fulfils it. Assignment (and re-assignment) MUST NOT
  re-snapshot price off the vehicle. This is the axis on which assign differs from
  the existing `substitute()`, which *does* re-price.
- **Append-only enum migration** for the new `VEHICLE_ASSIGNED` event type, which
  fans out across BOTH packages (see Schema §).
- **`effectiveEndAt` is invariant on assign — do NOT recompute it.** Turnaround is a
  **dropoff-location** property (`locations.defaultTurnaroundMinutes`, trigger
  `0069`), never a vehicle property (the legacy per-vehicle buffer was dropped in
  `0037`). Assigning a car changes neither `endAt` nor `dropoffLocationId`, so the
  persisted `effectiveEndAt` is already correct; `reassignVehicle`'s UPDATE doesn't
  fire the recompute trigger. Pass `booking.effectiveEndAt` through unchanged.

## Confirmed decisions (owner sign-off 2026-06-25)

- **D1 — Re-assignment scope: INCLUDE car→car.** `assignVehicle` handles both
  `null→car` (first assign) and `car→car` (swap a combo's car, e.g. breakdown),
  always no-reprice. `reassignVehicle()` already supports both transitions.
- **D2 — Audit: new `VEHICLE_ASSIGNED` event.** Distinct enum value via append-only
  `ALTER TYPE ... ADD VALUE` migration. `fromVehicleId = null` on first assign;
  `from→to` on a swap. Kept separate from `VEHICLE_SUBSTITUTED` in the timeline.
- **D3 — Timing gate: status ∈ {CONFIRMED, ACTIVE}.** Mirrors `substitute()`; allows
  at-pickup (ACTIVE) assignment. No hard pre-startAt cutoff.
- **D4 — UI surface: "Needs assignment" sidebar list + dialog.** Floats can't render
  in the vehicle-keyed calendar (`calendar-events.ts:29` — "no column to live in").
  A dedicated list (in `CalendarSidebar`, badge via the `useNewBookingsBadge` pattern)
  lists unassigned floats → assign dialog mirroring `SubstituteVehicleDialog.tsx`.
- **Endpoint shape: dedicated, not a generalization of `substitute()`.** Conflating
  would corrupt class-deal pricing (SRP). `substitute()` is additionally guarded to
  reject `CLASS_COMBO` (closes a latent mis-price path).

## API contract

`POST /bookings/:id/assign` — operator-only (`isOperatorRole`), tenant-scoped.

Request: `{ vehicleId: string, reason?: string | null }` (Zod, validators/booking).
Responses:
- `200` updated booking (assignedVehicleId set; totalPrice/effectiveEndAt unchanged).
- `404` booking not found / cross-tenant (no leak).
- `409 NOT_A_COMBO` — `fulfillmentMode !== 'CLASS_COMBO'` (SPECIFIC uses substitute).
- `409 INVALID_STATUS` — status not in {CONFIRMED, ACTIVE}.
- `400` candidate invalid (wrong operator/location/class, not AVAILABLE); road-legal
  rejection reuses the existing **`VEHICLE_DOCS_EXPIRE_BEFORE_RETURN`** code.
- `409 VEHICLE_UNAVAILABLE` — exclusion violation (`23P01`): car already booked on
  the overlapping window.

**Error codes (M1).** `NOT_A_COMBO`, `INVALID_STATUS`, `VEHICLE_UNAVAILABLE`, and the
`substitute()` guard's `USE_ASSIGN_FOR_COMBO` are NOT in `ERROR_CODES`
(`lib/error-codes.ts`) — the union is closed and `fail(c, …, {code})` is narrowed to
it, so an unlisted code is a `tsc` error. Append the four and pin them in
`error-codes.test.ts`. Reuse `VEHICLE_DOCS_EXPIRE_BEFORE_RETURN` for road-legal.

**Worklist read (its own data-layer sub-slice — M3, NOT a freebie).** Reuse the
existing bookings list with a new filter: `GET /bookings?fulfillmentMode=CLASS_COMBO&
unassigned=true` (operator-scoped; `unassigned` ⇒ `assignedVehicleId IS NULL`). This
touches 4 files: `BookingFilters` (`repositories/types.ts`, re-exported via
`services/filters.ts`), the `WHERE` in `DrizzleBookingRepository.findAll` AND
`InMemoryBookingRepository.findAll`, and the route query parse in `routes/bookings.ts`.

## Service logic — `BookingLifecycleService.assignVehicle(ctx, id, vehicleId, reason?)`

Runs inside the existing `runInTransaction` runner:
1. Load booking (scoped by `CallerContext`). Absent → `NotFoundError`.
2. Guard `fulfillmentMode === 'CLASS_COMBO'` else `ConflictError NOT_A_COMBO`.
3. Guard `status ∈ {CONFIRMED, ACTIVE}` else `ConflictError INVALID_STATUS`.
4. Load candidate via `vehicleRepo.findById(SYSTEM_CONTEXT, vehicleId)`. Validate:
   same `operatorId`, status `AVAILABLE`, same `pickupLocationId`, ACRISS class of the
   vehicle matches the booking's `classId`, and **`isRoadLegal(car, jstDateString(
   booking.endAt))`** — `endAt`, NOT `effectiveEndAt` (M2, Policy Drift). The assign
   dialog is fed by `findSubstitutionCandidates`, which filters road-legal on
   `endAt` (`booking-lifecycle.ts:254`); using `effectiveEndAt` here (up to 48h later)
   would 400 a car the operator was just shown ("ghost candidate"). Match the feeder.
5. `reassignVehicle(ctx, id, { assignedVehicleId: vehicleId, totalPrice:
   booking.totalPrice /* UNCHANGED */, effectiveEndAt: booking.effectiveEndAt
   /* UNCHANGED */ })`. The exclusion constraint re-checks atomically. **Wrap the
   `runInTransaction` call in the same `catch` `substitute()` uses
   (`booking-lifecycle.ts:197-206`) mapping `PG_ERROR.EXCLUSION_VIOLATION (23P01)` →
   `409 VEHICLE_UNAVAILABLE`** — omit it and the race surfaces as a 500.
6. Append `VEHICLE_ASSIGNED` event: top-level `actorId: ctx.userId` (NOT a payload
   field) + payload `{ type: 'VEHICLE_ASSIGNED', fromVehicleId:
   booking.assignedVehicleId, toVehicleId: vehicleId, reason }`.

**Guard `substitute()`:** if `booking.fulfillmentMode === 'CLASS_COMBO'` →
`ConflictError USE_ASSIGN_FOR_COMBO` before any reprice (new test pins this; verified
safe — every existing `substitute` caller/seed uses SPECIFIC).

**Notification (L2):** `assignVehicle` fires NO lifecycle email for MVP. Do NOT reuse
`substitute()`'s `'SUBSTITUTED'` trigger — "your vehicle was changed" is wrong for a
class-deal renter who never had a car. A first-assign notification is a later slice.

No class-capacity re-check on assign: the float already consumed its capacity slot at
create; assignment only chooses *which* car. The exclusion constraint is the only
new concurrency gate.

## Schema / migration + `VEHICLE_ASSIGNED` type fanout (H1)

Adding the event type is **not** a one-line enum change — it fans out across both
packages, and `assertNever` makes the web fail to build until handled:
- **Migration:** `bun run db:generate --custom --name booking_event_vehicle_assigned`
  → `ALTER TYPE "<enum>" ADD VALUE IF NOT EXISTS 'VEHICLE_ASSIGNED';` (append-only;
  precedent `0054`/`0062`/`0064`). Postgres forbids *using* a new enum value in the
  same tx that adds it — we only add here (no row insert), so it's safe.
- **`packages/shared/src/enums.ts`:** add `'VEHICLE_ASSIGNED'` to the enum list.
- **`packages/shared/src/db/booking-types.ts`:** add `VehicleAssignedPayload =
  { type: 'VEHICLE_ASSIGNED'; fromVehicleId: string | null; toVehicleId: string;
  reason: string | null }` to the `BookingEventPayload` union (or `bookingEventRepo.
  append` won't typecheck). `toBookingEvent` (`shared.ts`) is generic — no change.
- **`packages/web/.../operator-bookings/BookingTimeline.tsx`:** the `assertNever(
  payload)` becomes a compile error → add a `case 'VEHICLE_ASSIGNED'` render branch
  + en/ja/zh i18n keys. **This is the load-bearing reason the web build gates the slice.**
- No `bookings`-table change: a `CLASS_COMBO` row with a non-NULL `assignedVehicleId`
  is already valid (`bookings_specific_requires_assigned` only constrains SPECIFIC).
- `db:generate → db:migrate → db:verify` (3 green) per the migration runbook.

## Operator UI (`packages/web/src/vite/operator-bookings`)

- **`UnassignedFloatsList`** in `CalendarSidebar`: operator-scoped query of floats
  awaiting a car; badge via the `useNewBookingsBadge` pattern. Empty state when none.
- **`AssignVehicleDialog`** (mirrors `SubstituteVehicleDialog.tsx`): candidate picker
  fed by the substitution-candidates endpoint (same op/location/class/AVAILABLE/
  road-legal; no current car to exclude), optional reason, submit → `POST .../assign`,
  invalidate the floats + calendar queries on success.
- i18n keys ×3 locales (en/ja/zh), parity-checked. a11y: labelled select, dialog
  semantics per repo norms.

## Testing (TDD, vertical)

- **Service unit** (InMemory): guards (not-combo, wrong-status, cross-operator,
  wrong-location, wrong-class, not-AVAILABLE, expiring-car); happy `null→car` sets
  assignedVehicleId and leaves totalPrice unchanged; `car→car` swap keeps price;
  `VEHICLE_ASSIGNED` event shape (from/to). `substitute()` rejects a combo.
- **Real-pg integration** (the exclusion race — the load-bearing test): assign a car
  already CONFIRMED on the overlapping window → `409`; assign a free car → `200` and
  the float now collides with a second assign of the same car (proves it became
  visible to the constraint).
- **Web**: `AssignVehicleDialog` submits the chosen vehicle; `UnassignedFloatsList`
  renders floats and hides assigned bookings.

**Validator (L1):** add `assignVehicleSchema` to `validators/booking.ts` mirroring
`substituteVehicleSchema`. Field is `vehicleId` (assign is a fresh endpoint); note
`substitute` uses `newVehicleId` — keep route↔validator↔service consistent per side.

## Caveats (not bugs — state, don't fix)

- **Assign is not guaranteed to succeed (L4).** Capacity≥demand was gated at create,
  but if the only candidate car retires/expires/relocates afterward, a float can have
  zero eligible cars and every attempt 400/409s — operator resolves manually. No
  capacity re-check on assign (the float already holds its slot).
- **Double-submit (L3):** a re-assign of the same car is a self-no-op UPDATE → `200`
  with a `from===to` audit row. Harmless, matches `substitute`; no idempotency added.

## Out of scope (later slices)

- Renter "book this class deal" UI (3b CTA still funnels to the storefront).
- Auto-suggest / auto-assign heuristics.
- A synthetic calendar lane for floats (sidebar list is the chosen surface).
- First-assign renter notification email (L2).

---

## Review log

- **2026-06-25 architect-review:** structurally sound, no CRITICAL. Folded in: H1
  (`VEHICLE_ASSIGNED` payload-union + web-timeline fanout), M1 (error-code union),
  M2 (road-legal `asOf` = `endAt`, Policy Drift), M3 (worklist filter = 4-file
  sub-slice), L1/L2/L3/L4. Confirmed safe: enum migration, no table change, DI wiring
  (no composition-root/repo change), 4-layer authz, exclusion-race atomicity.
