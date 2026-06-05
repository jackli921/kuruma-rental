# Slice 6 (Booking & Event Log, #392) — session handoff

**Resume here after `/clear`.** Worktree: `/Users/jack/Dev/kuruma-slice6`
Branch: `feat/slice6-booking-events` (base `origin/marketplace-pivot` @ `2fbbedd`).

## SESSION UPDATE 2026-06-04 (cont. 2) — Task #4 LANDED (service, all green, --no-verify WIP)

Commits since #3 (`3de3e19`):
- `5601010` **Task #4a — submit transaction.** `BookingService.create` rewritten
  around the injected `runInTransaction`. New `CreateBookingInput`
  (requestedVehicleId + pickup/dropoff location ids + optional insuranceOptionId;
  operatorId/classId/assignedVehicleId/totalPrice ALL server-derived). Inside the
  tx: resolve assigned vehicle (= requested) → operator/class/rates; turnaround =
  `pickupLocation.defaultTurnaroundMinutes ?? 2880` (the 60-min buffer is GONE);
  price off the assigned vehicle (non-null, #429); insurance snapshot (active,
  this operator) added to totalPrice; fee snapshot (operator-wide + class rows);
  booking_code with bounded regenerate-on-23505 retry; INSERT booking THEN append
  BOOKING_CREATED (insert-first = atomicity); `ensureThread` AFTER commit.
  - Ctor: `(bookingRepo, runInTransaction, vehicleRepo?, userRepo?,
    vehicleClassRepo?, threading?, generateCode = generateBookingCode)`.
    `vehicleClassRepo` kept (substitution ACRISS lookup).
  - `BOOKING_CODE_CONSTRAINT`/`IDEMPOTENCY_CONSTRAINT` moved to `pg-errors.ts`
    (services must not import a concrete repo). In-memory unique error now sets
    `constraint_name` (mirrors postgres-js) so `pgConstraintName` works uniformly
    in-memory + Drizzle.
  - `VehicleBase.pickupLocationId?: string | null` exposed (slice-2 column,
    operationally wired here). `InMemoryBookingEventRepository` added to barrel.
- `7b5d539` **Task #4b — substitution (§5.5).** `BookingService.substitute` +
  new `BookingRepository.reassignVehicle` (re-checks exclusion for the NEW
  vehicle over the booking window, re-snapshots totalPrice #429, preserves
  requestedVehicleId, appends VEHICLE_SUBSTITUTED). cross-op→404,
  diff-location/diff-ACRISS→400, already-booked→409 (no event).

Tests (`bun run --filter @kuruma/api test`, 33 green): `tests/services/booking.test.ts`
(16: 10 submit + 6 substitution), `tests/services/booking-thread.test.ts` (5,
reshaped to the new input), `tests/repositories/{booking,booking-event}.test.ts` (12).

### NEXT = Task #5 (DI wire — `index.ts`) — the entry point
`createApp` still constructs the OLD BookingService ctor (`index.ts:~332`) and an
in-memory `runInTransaction` carrying only `{vehicleRepo, maintenanceLogRepo}`
(`index.ts:~161` overrides branch, `~234` no-DB branch). Widen BOTH + add the event repo:
1. Construct `bookingEventRepo` (InMemory in the two in-memory branches, Drizzle in the DB branch).
2. In-memory `runInTransaction` → pass the full 7-repo `TransactionRepos` bundle
   (type already widened, `types.ts:~371`). Same for `createDrizzleTransaction(db)`
   (`repositories/drizzle/transaction.ts`) — construct all 7 tx-bound repos (this
   is the #6 overlap; do the bundle widening as part of #5/#6).
3. `new BookingService(bookingRepo, runInTransaction, vehicleRepo, userRepo,
   vehicleClassRepo, threading)` — NEW positional order.
Once #5 lands, the 12 downstream-RED files below go green (they fail today ONLY
because createApp mis-wires the new ctor — positional args shifted).

**Downstream RED (expected, resolve at #5–#7):** `tests/routes/{bookings,
manual-booking,operator-user-isolation,public-catalog,select-columns,stats,
vehicle-classes,vehicle-detail,actor-derivation,availability}.test.ts`,
`tests/repositories/{fleet-overview,tenancy-guards}.test.ts`. All booking-coupled
(createApp wiring or old Booking fixture shape). 12 files / 88 tests.

**Scope carried to #6/#7 (NOT done in #4):**
- `bufferMinutes` still referenced by `VehicleBase` + `drizzle/{shared,vehicle}.ts`
  + `seed.ts` + `validators/vehicle.ts` + `in-memory/availability.ts`. The schema
  column is ALREADY dropped (migration 0037) — these TS refs are the real
  downstream tsc red; remove in #6.
- `cancel`/`updateStatus` do NOT yet append `BOOKING_CANCELLED`/`STATUS_CHANGED`
  events (§3.1 says they should — "existing transitions rewired to also append").
  Deferred to #7: they must move the projection write into the tx to append
  atomically. Task #4 was scoped to create + substitute only.
- `#392` stays OPEN; do NOT claim the E2E gate until #391 lands (original contract).

---

## SESSION UPDATE 2026-06-04 (cont.) — Tasks #2 + #3 LANDED (all green, --no-verify WIP)

Commits since the schema commit (`e38e85f`):
- `51a094e` **Task #2** — validator reshape + `booking_code` generator.
  - `shared/validators/booking.ts`: `createBookingSchema` now requires
    `requestedVehicleId` + `pickup/dropoffLocationId` (UUID), optional
    `insuranceOptionId`; `classId`/`vehicleId` removed (server-derived). Unknown
    keys (assignedVehicleId/totalPrice/bookingCode/operatorId/snapshots) silently
    dropped by default Zod strip. Tests: `shared/tests/validators/booking.test.ts` (16).
  - `api/src/lib/booking-code.ts`: `generateBookingCode()` (nanoid customAlphabet,
    8-char no-confusables) + `BOOKING_CODE_PATTERN`. `nanoid@5` added to api.
    Tests: `api/tests/lib/booking-code.test.ts` (4). **Service-level UNIQUE retry is Task #4.**
- `3de3e19` **Task #3** — in-memory repos + scoping + event log.
  - `api/src/stores.ts`: `Booking` reshaped to marketplace shape; new `BookingEvent`.
  - `api/src/tenancy.ts`: `bookingReadScope(ctx)` → renter-own / operator / bypass /
    none (bookings are PRIVATE — do NOT reuse `operatorReadScope`, which maps
    renters to `all`). Gates bypass on `ctx.bypassScope`, not a role string.
  - `api/src/repositories/types.ts`: `BookingEventRepository` (append-only) +
    `RunInTransaction` widened to a 7-repo `TransactionRepos` bundle (vehicle,
    maintenanceLog, booking, bookingEvent, location, insuranceOption, feeSchedule).
  - `api/src/repositories/in-memory/booking-event.ts` (new) + `booking.ts` reshape:
    exclusion mirror + countActive key on `assignedVehicleId`; `bookingCode` UNIQUE
    mirror throwing `{code:23505, constraint: BOOKING_CODE_CONSTRAINT}` (exported)
    so the service can distinguish a code clash (retry) from an idempotency clash
    (replay). Tests: `api/tests/repositories/{booking-event,booking}.test.ts` (4+8).

### NEXT = Task #4 (service) — the entry point
`api/src/services/booking.ts` is still the LEGACY shape (classId/vehicleId optional,
`DEFAULT_BUFFER_MINUTES=60`, single insert). Rewrite `create` to:
1. Reshape `CreateBookingInput` → `requestedVehicleId`, `pickup/dropoffLocationId`,
   `insuranceOptionId?`, `renterId`, dates, source, notes, externalId, idempotencyKey.
2. Inject `bookingEventRepo` + `runInTransaction` + fee/location/insurance read deps
   into the ctor (concretes wired in `index.ts` = Task #5).
3. Inside `runInTransaction` (proposal §4.1): resolve assigned vehicle (→ operatorId,
   classId, rates; `assignedVehicleId = requestedVehicleId`), turnaround =
   `pickupLocation.defaultTurnaroundMinutes ?? 2880`, price off assigned vehicle
   (non-null), insurance snapshot (active option, this operator), fee snapshot
   (operator-wide + class rows), `generateBookingCode()` + retry on
   `constraint===BOOKING_CODE_CONSTRAINT` (bounded ~3), insert booking + append
   `BOOKING_CREATED`. `ensureThread` stays AFTER commit. #429 backfill guard.
4. `substitute()` operator-only (same operator/location/ACRISS-class; 404 cross-op).
Service is testable WITHOUT index.ts: inject an in-memory `runInTransaction` that
passes the in-memory repos through. Mutation-resistant: a 60-min turnaround result
must FAIL a test (§9 item 20). Test table = plan §7.

`bun run --filter @kuruma/api test` (vitest). Many route/service/integration test
files are RED until #4-#6 reshape the service + drizzle repos — expected.
The handoff below this line is the ORIGINAL plan (still valid for #4 onward).

---

## The contract (READ FIRST)
Build **Draft v2** of the plan. It is NOT on marketplace-pivot — it lives on
`origin/docs/slice678-refresh`. Read it with:
`git show origin/docs/slice678-refresh:docs/plans/2026-06-02-slice6-booking-event-log.md`
(The on-disk `docs/plans/2026-06-02-slice6-booking-event-log.md` is the stale **v1** — ignore it.)

## Locked scope decisions (do not re-litigate)
- `assignedVehicleId` is server-derived (= `requestedVehicleId`); never a client field.
- Turnaround is location-only: `bufferMinutes` DROPPED; `effectiveEndAt = endAt + (location.defaultTurnaroundMinutes ?? 2880)`. A 60-min result must FAIL a test.
- Substitution rejects different-ACRISS-class (no rank order).
- Pricing vehicle-level (4c); `totalPrice` non-null on submit; honor #429 backfill guard.
- Notifications are slice 7 — emit `BOOKING_CREATED` only; reuse the `ensureThread` post-commit seam.

## Kickoff decision (reviewer-approved — "modified option 1")
Slice 5 (#391, storefront search + vehicle-selection) is **NOT merged** → the full
renter E2E (`search→storefront→selection→book→confirmation`) can't be built on this base.
Approved plan:
- Build **full API** + **booking-form** (`bookings/new`, slice 6 owns the form) + **confirmation** additions + a **form-onwards** Playwright E2E (`book→confirmation`).
- Open the PR as **DRAFT/partial**. Do **NOT** close #392 and do **NOT** claim the hard E2E gate until #391 lands and the full search→confirmation E2E is green (unless the gate is explicitly amended).
- Do NOT build on top of the in-flight `feature/391` branch.
- #392 issue body was synced to v2 (comment posted): `status` projection (not `current_state`), same-ACRISS-class (not same-or-better).

## DB / Neon (CRITICAL)
- Do NOT copy root `.env` (points at PRODUCTION). Worktree `.env` (gitignored) already
  points at an **isolated** Neon branch `slice6-dev` = `br-sweet-shape-anylv6ir`
  (forked from `marketplace-pivot` @ 0034). Project `hidden-heart-30840607`.
- Rationale: this draft is long-lived; migrating shared staging would break other
  sessions' `db:verify` Check 3 (journal-count vs applied-count). At merge, staging
  migrates via the normal flow.
- Migrations done: **0035** additive → **0036** custom (exclusion+trigger swap) →
  **0037** drop legacy cols. `db:verify` 4/4 green; DB introspection confirmed
  exclusion keys on `assignedVehicleId`, trigger reads pickup-location turnaround.

## Migration mechanics gotcha (for any FUTURE schema change here)
`db:verify` Check 1 runs `drizzle-kit generate` and fails on any new file → schema.ts
must match the latest snapshot and the rename must never hit drizzle's interactive prompt.
Strategy used: rename `vehicleId`→`assignedVehicleId` done as **add-new + drop-old**
across two generated migrations sandwiching the custom exclusion/trigger swap (table was
empty, so rename≡add+drop). `lint:fk-indexes` parses `drizzle/*.sql` for `CREATE INDEX`
leading columns — every FK column needs one (added in schema.ts `.index()`).

## DONE (committed `e38e85f`, --no-verify WIP)
Task #1: schema + 3 migrations. `packages/shared/src/db/schema.ts` is the source of truth:
new `bookings` cols, `bookingEvents` table + `bookingEventTypeEnum`, `vehicles_operatorId_id_unique`,
snapshot/payload TS types at file end, `seed-bookings.ts` updated to the new shape.
**`--no-verify` was required** because the pre-commit hook runs a FULL monorepo tsc and
the downstream api/web (below) still reference removed columns.

## NEXT — downstream tsc is RED; these reference removed `bookings.vehicleId` / `vehicles.bufferMinutes`:
`packages/api/src/repositories/drizzle/`: `availability.ts`, `booking.ts`, `customer.ts`,
`fleet-overview.ts`, `shared.ts`, `vehicle-detail.ts`, `vehicle.ts` (vehicle insert/select
still set `bufferMinutes`). Most are mechanical `vehicleId`→`assignedVehicleId`; `vehicle.ts`
just drops `bufferMinutes`. Run `(cd packages/web && bunx tsc --noEmit)` to see the full list.

## Remaining tasks (see TaskList; plan §9 order)
2. Validators (`shared/validators/booking.ts`) + `booking_code` generator (nanoid customAlphabet,
   no-confusables 8-char) — TDD, unit test first. `nanoid` NOT yet a dep; add to `@kuruma/api`.
   The seed currently uses placeholder `SEED####` codes — swap to the real generator if desired.
3. InMemory repos: new `BookingEventRepository` (append, findByBookingId — append-only, NO update/delete)
   + booking repo exclusion mirror on `assignedVehicleId` + three-way scoping (renter own /
   operator `ctx.operatorId` / `ctx.bypassScope` all). Replaces `PRIVILEGED_ROLES` scoping.
4. Service: `BookingService.create` ONE transaction (derive assignedVehicleId, resolve turnaround,
   price off assigned vehicle non-null, insurance snapshot, fee snapshot, booking_code gen+retry,
   insert booking + `BOOKING_CREATED` event; `ensureThread` AFTER commit). `substitute()` operator-only.
   `RunInTransaction` bundle (`types.ts:356`, currently `{vehicleRepo, maintenanceLogRepo}`) widened to
   add booking + bookingEvent repos. `#429` backfill guard test.
5. DI wire `packages/api/src/index.ts` (~:186 `createDrizzleTransaction`, ~:332 `BookingService` ctor) —
   concretes only here.
6. Drizzle repos + Neon integration tests (real exclusion 23P01, turnaround window 48h-reject/12h-accept,
   bookingCode 23505, composite FK 23503). `test` Neon branch is ARCHIVED — use `slice6-dev` (DATABASE_URL
   already set) for local integration runs.
7. Routes: extend `POST /bookings`; add `POST /bookings/:id/substitute` (OPERATOR_* only; renter 403; cross-op 404).
8. Web: `bookings/new` vehicle-select + active-insurance dropdown; confirmation page selected-insurance +
   "Potential additional charges" `feeSnapshot` block + disclaimer (empty → no block); i18n en/ja/zh
   `bookings.confirmation.fees.*` (restart dev server for new namespace).
9. E2E: form-onwards Playwright happy path (mock OAuth only; Resend is slice 7).
10. Full gate: `bun run test`, `bun run lint`, lint:boundaries/modules/size, lint:fk-indexes,
    lint:i18n-parity, export-drift, `db:verify`. lint:deps non-blocking. Run the api tests with
    `bun run --filter @kuruma/api test` (vitest; raw `bun test` is clock-skew-flaky here).
11. Review (code-reviewer + architect-review) → rebase onto `origin/marketplace-pivot` (never force-push)
    → open **DRAFT** PR to marketplace-pivot. Do NOT close #392.

## TDD discipline
One failing test → minimal impl → repeat. Mutation-resistant assertions. Follow plan §7 test table.
routes→services→repositories only. Commit at each green checkpoint; the pre-commit hook needs the whole
monorepo green, so either keep it green or use `--no-verify` for WIP and note it.
