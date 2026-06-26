# Operator-Assigns-Vehicle-to-Float Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator assign (and re-assign) a concrete vehicle to a car-less CLASS_COMBO "float" booking, on or before pickup day, with a "needs assignment" operator worklist.

**Architecture:** New `POST /bookings/:id/assign` → `BookingLifecycleService.assignVehicle()`, a near-mirror of `substitute()` minus the price re-snapshot (a class deal's price is fixed by its rate plan). Reuses `reassignVehicle()` so the Postgres exclusion constraint atomically blocks double-booking the assigned car. New `VEHICLE_ASSIGNED` audit event; `substitute()` guarded to reject combos. Operator UI: a "Needs assignment" sidebar list + an assign dialog mirroring `SubstituteVehicleDialog`.

**Tech Stack:** Hono (CF Workers), Drizzle/Postgres (neon), Zod, Vitest, Vite + TanStack Router/Query, use-intl. Bun.

**Spec:** `docs/plans/2026-06-25-464-assign-vehicle-to-float-design.md` (read it first). Refs #464.

**Conventions:** TDD vertical slices — one failing test → minimal impl → green → commit. Run API unit tests with `env -u DATABASE_URL bun run --filter @kuruma/api test`; real-pg integration needs a local `postgres:16` + `DATABASE_URL`. Web: `bun run --filter @kuruma/web test`. After any web route/i18n change run `bun run scripts/lint-i18n-parity.ts`. Commit messages: `feat(#464): …` / `test(#464): …`.

---

## File map

| File | Responsibility | Task |
|------|----------------|------|
| `packages/shared/src/enums.ts` | add `VEHICLE_ASSIGNED` to `BOOKING_EVENT_TYPES` | 1 |
| `packages/shared/src/db/booking-types.ts` | add `VehicleAssignedPayload` to `BookingEventPayload` union | 1 |
| `packages/shared/src/lib/error-codes.ts` | add `NOT_A_COMBO`,`INVALID_STATUS`,`VEHICLE_UNAVAILABLE`,`USE_ASSIGN_FOR_COMBO` | 2,3,5 |
| `packages/api/src/services/booking-lifecycle.ts` | `assignVehicle()`; guard `substitute()` | 1,2,3,4 |
| `packages/api/src/services/booking.ts` | facade delegate `assignVehicle` | 1 |
| `drizzle/00NN_booking_event_vehicle_assigned.sql` | `ALTER TYPE … ADD VALUE 'VEHICLE_ASSIGNED'` | 5 |
| `packages/api/src/repositories/types.ts` + `services/filters.ts` | `needsAssignment` on `BookingFilters` | 7 |
| `packages/api/src/repositories/drizzle/booking.ts` + `in-memory/booking.ts` | `needsAssignment` WHERE in `findAll` | 7 |
| `packages/api/src/validators/booking.ts` (or shared validators) | `assignVehicleSchema` | 6 |
| `packages/api/src/routes/bookings.ts` | `POST /bookings/:id/assign`; `needsAssignment` query parse | 6,7 |
| `packages/web/src/vite/bookings/api.ts` | nullable `requestedVehicleId`/`assignedVehicleId` | 8 |
| `packages/web/src/vite/operator-bookings/schema.ts` | nullable in `.extend` + `BOOKING_CREATED` payload | 8 |
| `packages/web/src/vite/operator-bookings/BookingTimeline.tsx` | `VEHICLE_ASSIGNED` render branch | 9 |
| `packages/web/src/vite/operator-bookings/UnassignedFloatsList.tsx` (new) | worklist + overdue flag | 10 |
| `packages/web/src/vite/operator-bookings/AssignVehicleDialog.tsx` (new) | candidate picker + mutation | 11 |
| `packages/web/messages/{en,ja,zh}.json` | i18n keys (timeline, list, dialog) | 9,10,11 |

---

## Task 1: `assignVehicle` happy path (null→car), service unit

**Files:**
- Modify: `packages/shared/src/enums.ts` (BOOKING_EVENT_TYPES), `packages/shared/src/db/booking-types.ts`
- Modify: `packages/api/src/services/booking-lifecycle.ts`, `packages/api/src/services/booking.ts`
- Test: `packages/api/tests/services/booking-assign.test.ts` (new; mirror `booking-substitution.test.ts` setup)

- [ ] **Step 1: Write the failing test.** Mirror the InMemory wiring from `booking-substitution.test.ts`. Seed a CLASS_COMBO float (CONFIRMED, `assignedVehicleId: null`, a `classId`, a `pickupLocationId`, a `totalPrice`) and an own AVAILABLE vehicle of the same class at the same location, road-legal past `endAt`.

```ts
it('assigns a car to a float: sets assignedVehicleId, leaves price, logs VEHICLE_ASSIGNED', async () => {
  const res = await service.assignVehicle(operatorCtx, float.id, car.id, null)
  expect(res).toMatchObject({ ok: true })
  if (!res.ok) throw new Error('expected ok')
  expect(res.booking.assignedVehicleId).toBe(car.id)
  expect(res.booking.totalPrice).toBe(float.totalPrice) // UNCHANGED — class-deal price
  const events = await bookingEventRepo.findByBookingId(SYSTEM_CONTEXT, float.id)
  expect(events.at(-1)).toMatchObject({
    type: 'VEHICLE_ASSIGNED',
    payload: { type: 'VEHICLE_ASSIGNED', fromVehicleId: null, toVehicleId: car.id, reason: null },
  })
})
```

- [ ] **Step 2: Run it, expect FAIL** (`service.assignVehicle is not a function`).
Run: `env -u DATABASE_URL bun run --filter @kuruma/api test booking-assign`

- [ ] **Step 3: Add the enum + payload union.**
`enums.ts` — append `'VEHICLE_ASSIGNED'` to the `BOOKING_EVENT_TYPES` array.
`booking-types.ts` — add the member and union arm:

```ts
export type VehicleAssignedPayload = {
  type: 'VEHICLE_ASSIGNED'
  fromVehicleId: string | null // null on first assign; the prior car on a swap
  toVehicleId: string
  reason: string | null
}
export type BookingEventPayload =
  | BookingCreatedPayload
  | VehicleSubstitutedPayload
  | VehicleAssignedPayload
  | BookingCancelledPayload
  | StatusChangedPayload
```

- [ ] **Step 4: Implement `assignVehicle`** in `BookingLifecycleService` (mirror `substitute()` lines 90-207, but no reprice, no postCommit). Returns the same result shape as `substitute` (`{ ok:true, booking } | { ok:false, status, error, code? }`).

```ts
async assignVehicle(
  ctx: CallerContext,
  bookingId: string,
  vehicleId: string,
  reason: string | null,
): Promise<SubstituteResult> {
  try {
    const result = await this.runInTransaction(async (repos) => {
      const booking = await repos.bookingRepo.findById(ctx, bookingId)
      if (!booking) return { ok: false, status: 404, error: 'Booking not found' } as const
      if (booking.fulfillmentMode !== 'CLASS_COMBO')
        return { ok: false, status: 409, error: 'Only class-deal bookings are assigned a vehicle', code: 'NOT_A_COMBO' } as const
      if (booking.status !== 'CONFIRMED' && booking.status !== 'ACTIVE')
        return { ok: false, status: 409, error: `Cannot assign a vehicle to a ${booking.status} booking`, code: 'INVALID_STATUS' } as const

      const car = await repos.vehicleRepo.findById(SYSTEM_CONTEXT, vehicleId)
      // P1 — missing OR foreign => 404, no existence leak (mirrors substitute()).
      if (!car || car.operatorId !== booking.operatorId)
        return { ok: false, status: 404, error: 'Vehicle not found' } as const
      if (car.status !== 'AVAILABLE')
        return { ok: false, status: 400, error: 'Vehicle is not available' } as const
      if ((car.pickupLocationId ?? null) !== booking.pickupLocationId)
        return { ok: false, status: 400, error: 'Vehicle serves a different pickup location' } as const
      if (!car.classId || !(await this.sameAcrissClass(booking.classId, car.classId)))
        return { ok: false, status: 400, error: 'Vehicle is a different class' } as const
      // M2 — road-legal asOf = endAt (NOT effectiveEndAt) to match the candidate feeder.
      if (!isRoadLegal(car, jstDateString(booking.endAt)))
        return { ok: false, status: 400, error: "Vehicle's shaken or insurance expires before the booking ends", code: 'VEHICLE_DOCS_EXPIRE_BEFORE_RETURN' } as const

      // No reprice — class-deal price is fixed by the rate plan. effectiveEndAt is
      // invariant (turnaround follows the dropoff location, unchanged here).
      const updated = await repos.bookingRepo.reassignVehicle(ctx, booking.id, {
        assignedVehicleId: car.id,
        totalPrice: booking.totalPrice,
        effectiveEndAt: booking.effectiveEndAt,
      })
      if (!updated) return { ok: false, status: 404, error: 'Booking not found' } as const

      await repos.bookingEventRepo.append(ctx, {
        bookingId: booking.id,
        type: 'VEHICLE_ASSIGNED',
        actorId: ctx.userId,
        payload: { type: 'VEHICLE_ASSIGNED', fromVehicleId: booking.assignedVehicleId, toVehicleId: car.id, reason },
      })
      return { ok: true, booking: updated } as const
    })
    return result
  } catch (err) {
    if (pgErrorCode(err) === PG_ERROR.EXCLUSION_VIOLATION)
      return { ok: false, status: 409, error: 'Vehicle is already booked for this time range', code: 'VEHICLE_UNAVAILABLE' }
    throw err
  }
}
```

Add a delegating method on the `BookingService` facade (`services/booking.ts`, mirror the `substitute` delegate).

- [ ] **Step 5: Run test, expect PASS** (the `code` fields reference codes added in Tasks 2/5; if `ErrorCode` rejects them, add them now in `error-codes.ts` — see Task 2 Step 3). Then commit.
```bash
git add -A && git commit -m "feat(#464): assignVehicle service — assign a car to a CLASS_COMBO float (null->car)"
```

---

## Task 2: assignVehicle guards (unit)

**Files:** Modify `packages/shared/src/lib/error-codes.ts`; Test `booking-assign.test.ts`.

- [ ] **Step 1: Write failing tests** — one `it` per guard, each asserting `{ ok:false, status, code? }`:
  - SPECIFIC booking → `409 NOT_A_COMBO`.
  - CANCELLED/COMPLETED float → `409 INVALID_STATUS`.
  - unknown vehicle id → `404` (no `code`).
  - vehicle owned by another operator → `404` (P1 — same response as unknown, asserts the message does NOT distinguish).
  - own vehicle not AVAILABLE / different location / different class → `400`.
  - own vehicle whose shaken expires before `endAt` → `400 VEHICLE_DOCS_EXPIRE_BEFORE_RETURN`.
- [ ] **Step 2: Run, expect FAIL** (codes not in `ErrorCode` → `tsc`/runtime).
- [ ] **Step 3: Add codes.** In `error-codes.ts` append under a `// #464 assign` comment: `'NOT_A_COMBO'`, `'INVALID_STATUS'`. Pin both in `error-codes.test.ts`.
- [ ] **Step 4: Run, expect PASS.** The guards already exist from Task 1; this task pins them. Commit `test(#464): pin assignVehicle guards + error codes`.

---

## Task 3: guard `substitute()` against combos (unit)

**Files:** Modify `booking-lifecycle.ts`, `error-codes.ts`; Test `booking-substitution.test.ts`.

- [ ] **Step 1: Failing test** — `substitute(operatorCtx, combo.id, car.id, null)` → `{ ok:false, status:409, code:'USE_ASSIGN_FOR_COMBO' }`.
- [ ] **Step 2: Run, expect FAIL** (today substitute would proceed and reprice).
- [ ] **Step 3: Implement.** At the top of `substitute()` after the status guard add:
```ts
if (booking.fulfillmentMode === 'CLASS_COMBO')
  return { ok: false, status: 409, error: 'Use assign, not substitute, for a class-deal booking', code: 'USE_ASSIGN_FOR_COMBO' }
```
Add `'USE_ASSIGN_FOR_COMBO'` to `error-codes.ts` + pin in test.
- [ ] **Step 4: Run, expect PASS** (verify existing substitute SPECIFIC tests still green). Commit.

---

## Task 4: car→car re-assignment, no reprice (unit)

**Files:** Test `booking-assign.test.ts`.

- [ ] **Step 1: Failing tests** — (a) a combo already holding car A → `assignVehicle(ctx, id, B)` → `200`, `assignedVehicleId===B`, `totalPrice` unchanged, event `{fromVehicleId:A, toVehicleId:B}`; (b) re-assign the SAME car (A→A) → `200`, event `{from:A,to:A}` (self-no-op, matches substitute).
- [ ] **Step 2: Run.** These likely PASS already (Task 1 code is transition-agnostic) — if so, they are characterization tests pinning the no-reprice + `from` semantics. If (b) fails on a self-no-op UPDATE, confirm `InMemoryBookingRepository.reassignVehicle` self-skip behavior; assert the returned booking, not the row diff.
- [ ] **Step 3:** No new impl expected. Commit `test(#464): pin combo car->car reassign keeps class price`.

---

## Task 5: migration + real-pg exclusion race (integration)

**Files:** Create `drizzle/00NN_booking_event_vehicle_assigned.sql` (+ snapshot/journal via generate); Modify `error-codes.ts`; Test `packages/api/tests/integration/booking-assign-exclusion.test.ts` (mirror an existing real-pg booking test).

- [ ] **Step 1: Generate the migration.**
```bash
bun run db:generate --custom --name booking_event_vehicle_assigned
```
Edit the generated SQL to exactly: `ALTER TYPE "<booking_event_type_enum>" ADD VALUE IF NOT EXISTS 'VEHICLE_ASSIGNED';` (confirm the enum's pg name from an existing `ALTER TYPE` migration, e.g. `0054`). Then `bun run db:migrate && bun run db:verify` (expect 3 green).
- [ ] **Step 2: Failing real-pg test.** Seed a float + a car already CONFIRMED on an overlapping window (a SPECIFIC booking on that car), then:
```ts
it('rejects assigning a car already booked on the overlapping window (23P01 -> 409)', async () => {
  const res = await service.assignVehicle(operatorCtx, float.id, busyCar.id, null)
  expect(res).toMatchObject({ ok: false, status: 409, code: 'VEHICLE_UNAVAILABLE' })
})
it('assigns a free car, then a second float assigning the same car on overlap is now blocked', async () => {
  expect(await service.assignVehicle(operatorCtx, floatA.id, freeCar.id, null)).toMatchObject({ ok: true })
  expect(await service.assignVehicle(operatorCtx, floatB.id, freeCar.id, null)).toMatchObject({ ok: false, status: 409, code: 'VEHICLE_UNAVAILABLE' })
})
```
- [ ] **Step 3: Run, expect FAIL** if `VEHICLE_UNAVAILABLE` isn't yet an `ErrorCode`. Add it to `error-codes.ts` + pin. The catch in Task 1 already maps `23P01`.
- [ ] **Step 4: Run against local pg, expect PASS.** `bun run --filter @kuruma/api test booking-assign-exclusion` with `DATABASE_URL` set. Commit `feat(#464): VEHICLE_ASSIGNED enum migration + exclusion-race integration test`.

---

## Task 6: route `POST /bookings/:id/assign` + validator (HTTP)

**Files:** Modify `validators/booking.ts`, `routes/bookings.ts`; Test `routes/bookings.test.ts` (the HTTP block).

- [ ] **Step 1: Failing HTTP tests** — operator POST with a valid body → `200` + `assignedVehicleId` set; renter → `403`; SPECIFIC booking → `409 NOT_A_COMBO`; bad uuid → `400` (validator).
- [ ] **Step 2: Run, expect FAIL** (404 route).
- [ ] **Step 3: Implement.** Add the validator:
```ts
export const assignVehicleSchema = z.object({
  vehicleId: z.string().uuid('Vehicle ID must be a valid UUID'),
  reason: z.string().optional(),
})
```
Add the route (mirror `/substitute`, lines 284-313): operator gate → `403 'Only operators can assign a vehicle'`; `parseId`; `parseBody(c, assignVehicleSchema)`; `service.assignVehicle(ctx, id, parsed.data.vehicleId, parsed.data.reason ?? null)`; `fail(c, result.error, result.status, { ...(result.code ? { code: result.code } : {}) })`; else `ok(c, result.booking)`.
- [ ] **Step 4: Run, expect PASS.** Commit `feat(#464): POST /bookings/:id/assign route + validator`.

---

## Task 7: `needsAssignment` worklist filter (repo + route)

**Files:** Modify `repositories/types.ts`, `services/filters.ts`, `repositories/drizzle/booking.ts`, `repositories/in-memory/booking.ts`, `routes/bookings.ts`; Test the booking-repo + route tests.

- [ ] **Step 1: Failing tests.** (a) InMemory `findAll({ needsAssignment: true })` returns ONLY combos with `assignedVehicleId === null` AND `status ∈ {CONFIRMED,ACTIVE}`; excludes a CANCELLED float, an assigned combo, and a SPECIFIC booking. (b) Real-pg Drizzle parity: same fixture, same result set. (c) Route `GET /bookings?needsAssignment=true` (operator) returns the float.
- [ ] **Step 2: Run, expect FAIL** (`needsAssignment` unknown filter key).
- [ ] **Step 3: Implement.** Add `needsAssignment?: boolean` to `BookingFilters` (`repositories/types.ts`; re-exported via `services/filters.ts`). In BOTH `findAll` impls, when `filters.needsAssignment` is true add the predicate: `fulfillmentMode = 'CLASS_COMBO' AND assignedVehicleId IS NULL AND status IN ('CONFIRMED','ACTIVE')` (Drizzle: `and(eq(fulfillmentMode,'CLASS_COMBO'), isNull(assignedVehicleId), inArray(status, ['CONFIRMED','ACTIVE']))`; InMemory: the equivalent `.filter`). In `routes/bookings.ts` parse `c.req.query('needsAssignment') === 'true'` into the filter.
- [ ] **Step 4: Run, expect PASS** (unit + real-pg). Commit `feat(#464): needsAssignment booking filter for the operator worklist`.

---

## Task 8: web DTO nullability (P1) + parse tests

**Files:** Modify `web/src/vite/bookings/api.ts`, `web/src/vite/operator-bookings/schema.ts`; Test a co-located schema test.

- [ ] **Step 1: Failing test.** Parse a combo-booking JSON (both `requestedVehicleId` and `assignedVehicleId` = `null`) through `bookingDtoSchema` and expect success:
```ts
it('parses a CLASS_COMBO booking with null vehicle ids', () => {
  expect(() => bookingDtoSchema.parse(comboBookingJson)).not.toThrow()
})
```
- [ ] **Step 2: Run, expect FAIL** (`Expected string, received null`).
- [ ] **Step 3: Implement.** In `bookings/api.ts`: `BookingDto.requestedVehicleId: string | null`, `assignedVehicleId: string | null`; and `bookingDtoSchema` fields → `z.string().nullable()`. Apply the same nullability in the operator-bookings `.extend` and the `BOOKING_CREATED` payload schema (`operator-bookings/schema.ts:108`).
- [ ] **Step 4: Run, expect PASS;** `bun run --filter @kuruma/web typecheck`. Commit `fix(#464): allow null vehicle ids in web booking DTOs (combo floats)`.

---

## Task 9: web `BookingTimeline` VEHICLE_ASSIGNED branch + i18n

**Files:** Modify `BookingTimeline.tsx`, `messages/{en,ja,zh}.json`; Test `BookingTimeline.test.tsx`.

- [ ] **Step 1: Failing test** — render a timeline with a `VEHICLE_ASSIGNED` event and assert the rendered copy (e.g. "Vehicle assigned" + car name) appears.
- [ ] **Step 2: Run, expect FAIL** (build error: `assertNever(payload)` no longer exhaustive — this is the gate).
- [ ] **Step 3: Implement.** Add `case 'VEHICLE_ASSIGNED':` to the timeline switch rendering the assignment (first-assign vs swap by `fromVehicleId === null`). Add i18n keys `operatorBookings.timeline.vehicleAssigned{,Swapped}` to en/ja/zh.
- [ ] **Step 4: Run, expect PASS;** `bun run scripts/lint-i18n-parity.ts`. Commit `feat(#464): render VEHICLE_ASSIGNED in the operator booking timeline`.

---

## Task 10: web `UnassignedFloatsList` + overdue flag

**Files:** Create `UnassignedFloatsList.tsx`; Modify `CalendarSidebar.tsx`, `operator-bookings/api.ts` (a `fetchNeedsAssignment` query), `messages/*`; Test `UnassignedFloatsList.test.tsx`.

- [ ] **Step 1: Failing test** — given two floats (one CONFIRMED, one ACTIVE), the list renders both; the ACTIVE one shows the "Overdue · pickup started" label and sorts above the CONFIRMED one; empty state when none.
- [ ] **Step 2: Run, expect FAIL** (component missing).
- [ ] **Step 3: Implement.** `fetchNeedsAssignment(csrf?)` → `GET /bookings?needsAssignment=true&expand=renter` (operator-scoped). `UnassignedFloatsList` renders rows (class label, window, renter), sorts `status==='ACTIVE'` first, badges them "Overdue". Mount in `CalendarSidebar` with a count badge via the `useNewBookingsBadge` pattern. i18n keys ×3. Clicking a row opens `AssignVehicleDialog` (Task 11).
- [ ] **Step 4: Run, expect PASS;** i18n parity. Commit `feat(#464): operator 'needs assignment' floats list with overdue flag`.

---

## Task 11: web `AssignVehicleDialog` (candidate picker + mutation)

**Files:** Create `AssignVehicleDialog.tsx`; Modify `operator-bookings/api.ts` (`assignVehicle` mutation fn), `messages/*`; Test `AssignVehicleDialog.test.tsx`. Mirror `SubstituteVehicleDialog.tsx`.

- [ ] **Step 1: Failing test** — dialog lists candidate vehicles (from the substitution-candidates fetch), submitting the chosen one calls `POST /bookings/:id/assign` with `{ vehicleId }` and on success invalidates the `needsAssignment` + calendar queries; submit disabled with no selection.
- [ ] **Step 2: Run, expect FAIL** (component missing).
- [ ] **Step 3: Implement.** Copy `SubstituteVehicleDialog.tsx` → `AssignVehicleDialog.tsx`: same candidate fetch (`GET /bookings/:id/substitution-candidates` — for a float there is no current car to exclude, the endpoint returns same-op/location/class/AVAILABLE/road-legal), `assignVehicle(bookingId, vehicleId, reason, csrf)` mutation → `POST …/assign`, `onSuccess` invalidates `['needsAssignment']` + calendar keys. i18n keys (title "Assign a vehicle", submit "Assign"). a11y: labelled `<select>`, dialog semantics.
- [ ] **Step 4: Run, expect PASS;** i18n parity; full web suite `bun run --filter @kuruma/web test`. Commit `feat(#464): operator assign-vehicle dialog wired to the floats list`.

---

## Final verification (before PR)

- [ ] `env -u DATABASE_URL bun run --filter @kuruma/api test` green; real-pg integration green against local `postgres:16`.
- [ ] `bun run --filter @kuruma/web test` green; `bun run --filter @kuruma/web typecheck` clean.
- [ ] `bun run db:verify` (3 green); `bun run scripts/lint-i18n-parity.ts`; `bun run lint` (boundaries, module barrels, file size).
- [ ] `bun run --filter @kuruma/api lint:boundaries` — confirm no route imports a repo, no `new Drizzle*` outside the composition root (this slice adds none).
- [ ] code-reviewer pass; then PR with `Refs #464`.

## Out of scope (later slices)

Renter "book this class deal" UI; auto-assign heuristics; a synthetic calendar lane for floats; first-assign renter notification email.
