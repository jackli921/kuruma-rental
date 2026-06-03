# Slice 6 — Booking & Event Log (issue #392)

**Date:** 2026-06-02
**Status:** Draft v1 — implementation plan for AFK execution; awaiting green light to create worktree
**Parent epic:** #385
**Source of truth:** `docs/plans/2026-05-25-marketplace-mvp-proposal.md` — §6 row 6 (slice scope), §6.1 (E2E gate before slice-6 merge), §6.2 (tenant scoping), §10 item 3 (booking_code format), §9 items 19/22/25, §10 items 9/14/17, §2 rows "Record mutation model" / "Booking write boundary" / "Vehicle substitution" / "Vehicle turnaround buffer".
**Format model:** mirrors `docs/plans/2026-06-02-slice4-insurance-pricing-fees.md` structure/depth, adapted to an event-sourced booking write-path slice.

This is the **booking write-path rework**. It converts the legacy single-insert, class-with-optional-vehicle booking (`#308` / `#345`) into a **selected-vehicle, event-sourced** booking whose authoritative lifecycle lives in an append-only `booking_events` log, with the existing `bookings.status` as the write-through projection for fast reads. It is the slice where the proposal's mutation model (§2 "Record mutation model"), exclusion-on-assigned-vehicle (§2), 48h turnaround (§2), `booking_code` (§10 item 3), selected-insurance snapshot, and fee snapshot (§9 item 19) all land together as one transactional submit.

---

## 0. What this slice does NOT ship (boundary fences)

| Deferred to | Item |
|---|---|
| **Slice 7 (#393)** | Actual email send. The `EmailSender` interface (`packages/api/src/services/email/`, proposal §9 item 5 / §10 item 2) and `notification_log` table are slice 7. Slice 6 commits the booking and emits the `BOOKING_CREATED` event **only**; no network side effect runs inside or after the transaction here. The post-commit hook seam already exists (`BookingService.ensureThread`, `#335`) — slice 7 extends that seam, slice 6 does not add a second one. |
| **Slice 7** | `operators.preAuthHandoffUrl` rendering on the confirmation page. The column already exists on `marketplace-pivot` (slice 1 schema), but wiring the link + email is slice 7's "pre-auth handoff" deliverable. Slice 6 renders selected insurance + the **fee-disclosure** block only. |
| **Post-MVP** | Per-vehicle insurance applicability (`vehicle_insurance_options` join table). Slice 6 lets the renter choose from the operator's active insurance options and snapshots that choice; it does not restrict options per vehicle. |
| **Slice 4b (#392-dependency, landed)** | `fee_schedules` table + CRUD. Slice 6 **reads** that table to build the snapshot; it does not create or modify it. |
| **Post-MVP** | Auto-compute / auto-charge of fees at checkout. Slice 6 snapshots rates and **displays informationally** only (§9 item 19: "informational only in MVP"). |
| **Post-MVP** | Renter cancellation/modification UI (§9 item 7, §10 item 8). Event log makes both trivially addable later; not in this slice. Operator-initiated cancel stays on the existing `cancel` path. |

---

## 1. Preconditions (MUST hold before kickoff)

| Precondition | Why | Status 2026-06-02 |
|---|---|---|
| **Slice 4a (#389a — insurance options) merged to `marketplace-pivot`** | Slice 6 reads active `insurance_options` so the renter can pick one during booking and the booking can snapshot the selected option's name/price/deductible. | Plan landed (`docs/plans/2026-06-02-slice4-insurance-pricing-fees.md` §3); merge state TBC at kickoff |
| **Slice 4b (#392 dep — fee schedules) merged to `marketplace-pivot`** | Slice 6 reads `fee_schedules` rows to build `bookings.fee_snapshot`. Without the table + its `feeType`/`unit`/`amountJpy`/`vehicleClassId` columns there is nothing to snapshot. | Plan landed (`docs/plans/2026-06-02-slice4-insurance-pricing-fees.md` §4); merge state TBC at kickoff |
| **Slice 5 (#391 — storefront search + vehicle selection) merged** | Slice 6 is the **submit** for the vehicle the renter selected in slice 5's storefront-detail screen. Slice 5 owns "renter picks a concrete vehicle"; slice 6 owns "renter confirms that vehicle into a booking." Proposal §6 critical path: "5 and 6 can partially parallelize" — but the submit endpoint needs slice 5's vehicle-selection UI as its caller. | #391 |
| **Slice 2 (#387 — locations) merged** | `bookings.pickup_location_id` + `dropoff_location_id` FKs (proposal §2 "Locations") and the substitution rule "same-operator, **same-location**" (§9 item 25) both require the `locations` table. Substitution's location check is unimplementable without it. | In review (PR #414 → `marketplace-pivot`); **HARD blocker** for slice 6 |
| **Slice 1 (#386 — tenancy) merged** | `CallerContext.operatorId` / `bypassScope`, `OPERATOR_*` roles, `operators` table. **Confirmed present on `marketplace-pivot`** (`packages/api/src/middleware/auth.ts` already exports `operatorId?`, `bypassScope?`, `OPERATOR_ROLES`, `SCOPE_BYPASS_ROLES`). | Merged |
| **`#401` (drop operator fallback) merged** | Operator-scoped writes resolve `operatorId` from `ctx`, no `BEST_CAR_RENTAL_OPERATOR_ID` fallback (`memory/project_operator-2-gate`). Substitution + operator booking-list reads must obey this. | Merged to `origin/marketplace-pivot` via PR #408. Branch from `origin/marketplace-pivot` or fast-forward local before kickoff. |

If a contract name differs at kickoff, slice 6 adapts its own PR — never refactor a landed slice (`CLAUDE.md` "Stay in scope").

---

## 2. Grounding in merged code — what exists, what we extend (do NOT reinvent)

The single-tenant booking write path is already mature. Slice 6 **extends** it; it does not rebuild it.

### 2.1 The existing exclusion constraint (KEEP THE PATTERN)

`drizzle/0006_exclusion_constraint.sql` (real, merged):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "vehicleId" WITH =,
    tstzrange("startAt", "effectiveEndAt") WITH &&
  ) WHERE (status IN ('CONFIRMED', 'ACTIVE'));
```

- `effectiveEndAt` is a **stored** column (`bookings.effectiveEndAt timestamptz NOT NULL`, `drizzle/0008`), computed by a trigger from `vehicles.bufferMinutes` (`drizzle/0015_effective-end-trigger.sql`, `compute_effective_end_at()`), with a defense-in-depth CHECK `effectiveEndAt >= endAt`.
- Postgres only excludes rows where **every `=` operand is non-null**, so today's nullable `vehicleId` means unassigned (class-only) bookings never collide. That subtlety is mirrored in `InMemoryBookingRepository.create` (`packages/api/src/repositories/in-memory/booking.ts:127-145`) and `getConflictingBookings`.

**Slice 6 extension — three changes, no reinvention:**

1. **Rename the constrained column** `vehicleId` → `assignedVehicleId` (proposal §2: "exclusion constraint on `(assigned_vehicle_id, time_range)`"). The constraint shape is identical; only the column it keys on changes. **`assignedVehicleId` becomes NOT NULL** for new selected-vehicle bookings (the class-only path is retired this slice), so the "null operand skips exclusion" loophole closes — every confirmed booking now occupies its assigned vehicle atomically.
2. **Rebind the trigger** to compute `effectiveEndAt` from the **turnaround** value, not the legacy 60-min `bufferMinutes`. See §5.3 — `effective_end_at = end_at + turnaround_minutes` where turnaround resolves `vehicles.turnaroundMinutesOverride ?? locations.defaultTurnaroundMinutes ?? 2880` (48h). Proposal §2 "Vehicle turnaround buffer" + §9 item 20 ("rename/map `bufferMinutes` → `turnaround_minutes`; do not leave the old 60-minute default").
3. **Add `operatorId` to bookings** (it is absent on `marketplace-pivot` today — see §2.4). The exclusion constraint does **not** need `operatorId` in it: it is per-`assignedVehicleId`, and a vehicle belongs to exactly one operator, so cross-operator collisions are structurally impossible (proposal §8.1 risk row: "adding `operator_id` doesn't change behavior").

### 2.2 The existing booking service / repo (EXTEND, don't replace)

- `BookingService.create(ctx, input, now = new Date())` (`packages/api/src/services/booking.ts:148`) — `now` is **injected** (`#314`) for testability; keep that. It already: validates renter (staff-override path), checks idempotency **scoped to caller** (`#340`, `findByIdempotencyKey(ctx, key)`), resolves class+vehicle, computes server-side price (`#74` — never client-supplied), inserts, catches `EXCLUSION_VIOLATION`→409 / `UNIQUE_VIOLATION`+replay, then runs `ensureThread` (`#335`) **after** the row exists.
- `BookingRepository` interface (`packages/api/src/repositories/types.ts:141`) — `create(ctx, data)` is a single insert today.
- `RunInTransaction` (`types.ts:257`) + `createDrizzleTransaction` (`repositories/drizzle/transaction.ts`) **already exist** — used by `MaintenanceService`. Slice 6 reuses this exact pattern to make booking-submit one transaction; it does not invent a new transaction mechanism. The factory's repo bundle is widened to include the booking + event repos (§4.2).
- `pgErrorCode` / `PG_ERROR` (`packages/api/src/pg-errors.ts`) — `EXCLUSION_VIOLATION = '23P01'`, `UNIQUE_VIOLATION = '23505'`. Slice 6 adds nothing here; `booking_code` collision reuses `UNIQUE_VIOLATION` (§5.4).

### 2.3 The existing route + helpers (REUSE)

- `createBookingRoutes(service)` (`packages/api/src/routes/bookings.ts`) — `POST /bookings` already builds `ctx` via `toCallerContext(requireUser(c))`, parses with `createBookingSchema` via `parseBody()`, forces `source=DIRECT` for non-staff. Slice 6 widens the validator + input, keeps the route shape.
- `routes/helpers.ts`: `ok()`, `fail()`, `parseBody()`, `parseDateRange()`, `stripUndefined()`. Use them; do not hand-roll `c.json`.

### 2.4 marketplace-pivot bookings table — current shape (what we migrate FROM)

On `origin/marketplace-pivot` the `bookings` table is still the **legacy single-tenant shape**: `renterId`, `classId` (single FK → `vehicleClasses.id`), nullable `vehicleId`, `startAt`/`endAt`/`effectiveEndAt`, `status`, `source`, `idempotencyKey`. It has **no** `operatorId`, **no** `requestedVehicleId`/`assignedVehicleId`, **no** `bookingCode`, **no** `feeSnapshot`, **no** `currentState`. Slices 2-5 did not touch it. **Slice 6 is the booking-table marketplace migration.** (Proposal §5.1 step 4: "replace legacy nullable `bookings.vehicleId` with selected/assigned vehicle semantics.")

---

## 3. Event taxonomy & the write-through model

### 3.1 `booking_events` — append-only log

The booking's lifecycle is a sequence of immutable events. The existing `bookings.status` column is the **projection** (write-through cache) of the latest lifecycle event for fast reads — the events are the source of truth. The proposal names this projection `current_state`; MVP keeps `status` to avoid churning every existing reader.

MVP event types (`bookingEventTypeEnum`):

| Event | Emitted when | `status` after | Payload (jsonb) |
|---|---|---|---|
| `BOOKING_CREATED` | Booking submit (this slice's happy path) | `CONFIRMED` | `{ requestedVehicleId, assignedVehicleId, classId, startAt, endAt, totalPrice, insuranceSnapshot, feeSnapshot }` |
| `VEHICLE_SUBSTITUTED` | Operator swaps the assigned car (§9 item 25) | unchanged (still `CONFIRMED`/`ACTIVE`) | `{ fromVehicleId, toVehicleId, reason }` |
| `BOOKING_CANCELLED` | Operator cancels (existing `cancel` path, rewired to emit an event) | `CANCELLED` | `{ cancellationFee, cancelledAt }` |
| `STATUS_CHANGED` | `CONFIRMED→ACTIVE→COMPLETED` transitions (existing `updateStatus`, rewired) | new status | `{ from, to }` |

> **Scope discipline:** Only `BOOKING_CREATED` + `VEHICLE_SUBSTITUTED` are *new* behavior this slice. `BOOKING_CANCELLED` / `STATUS_CHANGED` are the **existing** transitions made to *also append an event* so the log is complete — they reuse `VALID_BOOKING_TRANSITIONS` (`schema.ts:271`). Do not build new cancellation/modification flows (§0).

`status` maps to the existing `bookingStatusEnum` (`CONFIRMED | ACTIVE | COMPLETED | CANCELLED`) and is the write-through projection target. No new `currentState` column ships in MVP.

### 3.2 Invariant

Every booking mutation that changes lifecycle state happens as: **append event → update projection**, in the same transaction. A projection that disagrees with `max(booking_events.createdAt)` is a bug; an integration test asserts the projection equals the last event's resulting state.

---

## 4. The single-transaction submit (the heart of this slice)

Proposal §2 "Booking write boundary" + §9 item 22 + §10 item 14: **booking submit is ONE DB transaction** for (a) selected-vehicle availability validation, (b) booking row insert with requested+assigned vehicle IDs, (c) selected-insurance snapshot, (d) initial `BOOKING_CREATED` event insert, (e) fee snapshot. **Notifications happen after commit (slice 7).**

### 4.1 Transaction sequence (inside `runInTransaction`)

```
BEGIN
  1. Resolve class + selected vehicle (must belong to class; vehicle's operator owns it)
  2. Resolve turnaround_minutes := vehicle.turnaroundMinutesOverride
                                   ?? location.defaultTurnaroundMinutes
                                   ?? 2880 (48h)         [§5.3]
  3. Compute server-side price (calculateBookingPrice, #74 — never client-supplied)
  4. Resolve selected insurance option from this operator's ACTIVE options and build insurance_snapshot
  5. Build fee_snapshot from applicable fee_schedules rows  [§6]
  6. Generate booking_code (8-char no-confusables base32 nanoid)  [§5.4]
  7. INSERT bookings { requestedVehicleId, assignedVehicleId, operatorId, classId,
       pickup/dropoffLocationId, startAt, endAt, effectiveEndAt(=trigger), status='CONFIRMED',
       bookingCode, insuranceOptionId, insuranceSnapshot, feeSnapshot, totalPrice, idempotencyKey }
       -> exclusion constraint on assignedVehicleId enforces uniqueness ATOMICALLY  [§2.1]
       -> unique(bookingCode) may collide -> retry generation (bounded)  [§5.4]
  8. INSERT booking_events { bookingId, type='BOOKING_CREATED', payload, actorId=renterId }
  9. (status already 'CONFIRMED' from the insert default — projection is consistent)
COMMIT
-- AFTER COMMIT (NOT in tx): ensureThread (#335). Slice 7 adds EmailSender here.
```

**Why one transaction (FC/IS framing):** availability validation + row + event + snapshot are a single atomic *decision-and-record*. If the exclusion constraint fires (step 6), the whole thing rolls back — no orphan event, no orphan snapshot. The thread/email work is an **imperative shell** side effect that must NOT be inside the transaction (network I/O in a DB tx is the `Side Effects in Business Logic` smell). This is exactly why `ensureThread` is already post-insert today.

### 4.2 Repository / transaction wiring (boundaries: AGENTS.md)

- Widen `RunInTransaction`'s repo bundle (`types.ts:257`) to include `bookingRepo` + `bookingEventRepo` (+ read access to `feeScheduleRepo`, `vehicleRepo`, `locationRepo` for in-tx resolution). `createDrizzleTransaction` (`repositories/drizzle/transaction.ts`) constructs the Drizzle repos bound to the `tx` handle; the InMemory equivalent passes its repos through (JS single-threaded — same pattern as today).
- `BookingService.create` orchestrates: it calls `runInTransaction(async (repos) => { ...steps 1-7... })`. **Orchestration lives in the service**, the multi-row write lives behind the transaction repo — routes never see a transaction (AGENTS.md: routes→services→repositories, never backwards).
- New `BookingEventRepository` interface (`types.ts`): `append(ctx, event)`, `findByBookingId(ctx, bookingId)`. Drizzle + InMemory pair under `repositories/{drizzle,in-memory}/booking-event.ts`. Concretes wired **only** in `index.ts` (AGENTS.md: "No `new ConcreteRepository()` outside `index.ts`").
- `index.ts` widens the `createDrizzleTransaction(db)` call and the `new BookingService(...)` constructor args to inject the event repo + transaction runner. Today `BookingService` takes `(bookingRepo, vehicleRepo, userRepo, vehicleClassRepo, threading)` (`index.ts:287`); add `bookingEventRepo`, `runInTransaction`, and the fee/location read deps.

### 4.3 Tenant scoping at the route/service (§6.2)

- **Renter books**: `ctx.role = RENTER`, no `operatorId`; the booking's `operatorId` is derived from the **selected vehicle's** operator (not from the caller). A renter cannot set `operatorId`.
- **Operator reads** its own bookings: `findAll`/`findById` filter on `ctx.operatorId` for `OPERATOR_*` (NEVER bypass — proposal §6.2 heuristic). This **replaces** the legacy `PRIVILEGED_ROLES`-based scoping in `DrizzleBookingRepository.findAll` (`booking.ts:14-15`) and `InMemoryBookingRepository.scopedValues` (`in-memory/booking.ts:37-41`), which only knew renter-vs-privileged. New scoping is three-way: renter (own rows) / operator (operator's rows) / bypass (all). Gate bypass on `ctx.bypassScope === true`, not on a role string (mirrors slice 4 §2 "[P1]").
- **Substitution** (§5.5) is an operator-only write, scoped to `ctx.operatorId`; it loads the booking first to confirm tenant ownership (404 not 403 on cross-operator — no existence leak, mirrors slice 4).

---

## 5. Schema, migrations & generation details

All `schema.ts` changes generate via `bun run db:generate --name <change>` → `bun run db:migrate` → `bun run db:verify` (3 green) per `CLAUDE.md` Database Migrations. **The exclusion constraint, the turnaround trigger rebind, and the `btree_gist`-backed rename are NOT expressible in Drizzle's table builder** — they require a **hand-written custom migration**: `bun run db:generate --custom --name booking_exclusion_assigned_vehicle` (`CLAUDE.md`: "never drop raw `.sql` into `drizzle/`"). The additive columns (event table, `booking_code`, `fee_snapshot`, etc.) go in a normal generated migration; sequence the custom SQL migration **after** it.

### 5.1 `bookings` table changes

| Column | Change | Source |
|---|---|---|
| `operatorId text NOT NULL → operators.id` | **Add** (absent on pivot, §2.4) | §2 multi-tenancy |
| `requestedVehicleId text NOT NULL → vehicles.id` | **Add** — what the renter chose | §2, §9 item 25 |
| `assignedVehicleId text NOT NULL → vehicles.id` | **Rename** from `vehicleId` + make NOT NULL — what the operator fulfills; exclusion keys on this | §2 |
| `pickupLocationId` / `dropoffLocationId text NOT NULL → locations.id` | **Add** (needs #387) | §2 "Locations" |
| `bookingCode text NOT NULL UNIQUE` | **Add** | §10 item 3, §9 item 3 |
| `insuranceOptionId text → insurance_options.id` | **Add nullable** — selected renter insurance option; null only if renter declines coverage / operator has no active option | §4 renter item 4 |
| `insuranceSnapshot jsonb` | **Add nullable** — `{ name, dailyPriceJpy, deductibleJpy, insuranceOptionId }` locked at booking time | §4 renter item 4 |
| `feeSnapshot jsonb NOT NULL DEFAULT '[]'` | **Add** | §9 item 19 |
| `classId` | Keep (discovery/grouping); composite FK `(operatorId, classId) → vehicle_classes(operatorId, id)` to seal class-to-operator (mirrors `vehicles` on pivot, #395) | §2 |
| `status` | Keep as the write-through projection target (§3.1, §11) | §2 |

Composite FK seal: `(operatorId, requestedVehicleId)` and `(operatorId, assignedVehicleId)` → `vehicles(operatorId, id)` so an assigned vehicle must belong to the booking's operator (same pattern as `vehicles_operatorId_classId_fk` on pivot). Add the same composite seal for `(operatorId, insuranceOptionId)` → `insurance_options(operatorId, id)` where `insuranceOptionId IS NOT NULL`. This makes "operator can only substitute/price against its own records" a DB invariant, not just a service check.

### 5.2 `booking_events` table (new)

```
booking_events
  id            text PK (uuid)
  bookingId     text NOT NULL -> bookings.id
  type          booking_event_type enum (BOOKING_CREATED | VEHICLE_SUBSTITUTED | BOOKING_CANCELLED | STATUS_CHANGED)
  payload       jsonb NOT NULL
  actorId       text -> users.id   (renter for CREATED; operator user for SUBSTITUTED/CANCELLED; null for system)
  createdAt     timestamptz NOT NULL default now()
  index idx_booking_events_bookingId (bookingId, createdAt)   -- ordered replay per booking
```

Append-only: no `update`/`delete` repo methods exist on `BookingEventRepository` (enforced by interface, not just convention).

### 5.3 Turnaround → exclusion range (the math)

`effective_end_at = end_at + turnaround_minutes`, where at booking time:

```
turnaround_minutes = vehicle.turnaroundMinutesOverride
                     ?? location.defaultTurnaroundMinutes   -- pickup location; default 2880 on the column
                     ?? 2880                                 -- 48h hard fallback
```

- Proposal §2 "Vehicle turnaround buffer", §9 item 20, §10 item 11. `locations.default_turnaround_minutes` defaults to **2880 (48h)** per §5.1 step 4; `vehicles.turnaround_minutes_override` is the optional per-vehicle exception.
- The existing trigger `compute_effective_end_at()` (`drizzle/0015`) reads `vehicles.bufferMinutes` (default 60). **Rebind it** to resolve `turnaround_minutes` from the override→location→default chain and key off `assignedVehicleId`. Keep the trigger (defense-in-depth) so a direct SQL insert can't bypass the buffer; the service also computes `effectiveEndAt` for the in-memory repo to mirror. CHECK `effectiveEndAt >= endAt` stays.
- **`bufferMinutes` retirement:** §9 item 20 is explicit — "do not leave the old 60-minute default in place." Map `vehicles.bufferMinutes` → `vehicles.turnaroundMinutesOverride` (nullable, no 60-min default), and add `locations.defaultTurnaroundMinutes` (default 2880). The exclusion range thus widens from "60 min after return" to "48h after return" — that is the intended behavior change.

### 5.4 `booking_code` generation (§10 item 3)

- **Format:** 8-char, no-confusables base32 nanoid. Alphabet excludes `0 O 1 I l` (e.g. `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`), no prefix, pattern like `2J7QXKN4`. Internal `bookings.id` stays UUIDv7 (proposal §2 "Booking ID", `memory/project_architect-review`).
- **Library:** `nanoid` with `customAlphabet` (~1KB, §10 item 3). **`nanoid` is not yet a dependency** (verified: absent from all `packages/*/package.json`) — add to `@kuruma/api` (the generator runs server-side in the booking service; never client-side, no PII, recitable over phone).
- **Uniqueness + retry:** `bookingCode` is `UNIQUE NOT NULL`. 8 chars over a 32-symbol alphabet = ~2^40 space; collision is astronomically rare at MVP scale but must be handled. On `UNIQUE_VIOLATION` (`23505`) for `bookingCode` specifically (distinguish from the idempotency-key unique), **regenerate and retry the insert**, bounded to e.g. 3 attempts, then surface a 500. Reuse `pgErrorCode` (`pg-errors.ts`); the retry is in the service around the transaction step. Generation happens **inside** the transaction sequence (§4.1 step 5) so a retry re-runs the whole atomic insert cleanly.

### 5.5 Substitution write path (`VEHICLE_SUBSTITUTED`, §9 item 25 / §10 item 17)

New operator-only endpoint, e.g. `POST /bookings/:id/substitute` (route → service → transaction repo). In one transaction:

1. Load booking scoped to `ctx.operatorId` (404 if not this operator's — no leak).
2. Validate the replacement vehicle: **same operator, same pickup location, same ACRISS class**. §9 item 25 allows "same-or-better," but no ACRISS rank order is defined; better-class substitution is a follow-up requiring an explicit ordering decision.
3. `UPDATE bookings SET assignedVehicleId = :new, effectiveEndAt = recomputed` — the exclusion constraint re-checks availability for the **new** assigned vehicle atomically (rolls back if the new car is already booked for the range).
4. Append `VEHICLE_SUBSTITUTED` event `{ fromVehicleId, toVehicleId, reason, actorId: operatorUserId }`. `requestedVehicleId` is **never** mutated — the audit trail preserves what the renter originally selected (§2 "Vehicle substitution").

This is a vertical sub-slice but small; ships in slice 6 because the proposal lists "substitution event support" in row 6. **UI for substitution is minimal** (operator booking-detail action) — the data path + event are the deliverable.

### 5.6 Migration ordering (the journal trap)

Two migrations: (1) generated additive (`booking_events` table, new `bookings` columns, enum), (2) custom SQL (`assignedVehicleId` rename + exclusion-constraint swap + trigger rebind). Order: additive **then** custom. Per `CLAUDE.md` 2026-04-17 trap: if rebasing onto a `marketplace-pivot` that gained migrations meanwhile, **regenerate** (don't hand-edit `_journal.json`); if cherry-picking, bump `when` to `max(prev)+1`. Run `bun run db:verify` after each; CI `db-drift` enforces.

---

## 6. Insurance + fee snapshot shapes

### 6.1 Selected insurance (`bookings.insurance_snapshot jsonb`)

At booking, the renter may choose one active insurance option from the selected vehicle's operator. The option list is not filtered per vehicle in MVP; per-vehicle applicability is post-MVP. If an option is selected, snapshot it inside the same transaction so later operator edits do not rewrite booked terms:

```jsonc
{
  "insuranceOptionId": "...",
  "name": "Premium",
  "dailyPriceJpy": 2800,
  "deductibleJpy": 250000
}
```

`totalPrice` includes base vehicle rental + selected insurance daily price for the booking day count. If the renter declines insurance or the operator has no active options, `insuranceOptionId` and `insuranceSnapshot` are null.

### 6.2 Fee schedules (`bookings.fee_snapshot jsonb`)

At booking, snapshot the **applicable** `fee_schedules` rows so the rate is locked at booking time (proposal §9 item 19: "locks rate-at-time-of-booking so post-MVP checkout charges against the locked rate, not the current one"). "Applicable" = active rows for the booking's operator that are either **operator-wide** (`vehicleClassId IS NULL`) or **match the booking's class** (`vehicleClassId = booking.classId`). Slice 4b's two partial-unique indexes guarantee at most one active row per `(operator, type, scope)`.

Snapshot element shape (one per applicable fee):

```jsonc
{
  "feeType": "OVERTIME_HOURLY",   // | CLEANING_FLAT | NO_FUEL_FLAT
  "unit": "PER_HOUR",             // | FLAT (coherence already enforced in slice 4b)
  "amountJpy": 500,
  "vehicleClassId": "..." | null  // provenance: class-specific vs operator-wide
}
```

- Overtime is **not computed** at booking (no return-overage yet) — the snapshot just locks the hourly rate; the post-MVP rule is `ceil(overage_hours) * snapshotted_hourly_rate` (§9 item 19). MVP displays it as "¥500 / hour over scheduled return."
- Snapshot reads `fee_schedules` **inside the transaction** (consistent point-in-time) via the fee-schedule repo's read method, scoped to the booking's operator. No write to `fee_schedules`.

### Confirmation page — "potential additional charges" (§4 renter item 5, proposal "informational only")

`packages/web/src/app/[locale]/bookings/confirmation/page.tsx` already exists (renter flow #345). Slice 6 adds the selected-insurance summary plus a **"Potential additional charges"** block rendering `booking.feeSnapshot`: each row as a labelled line (i18n `bookings.confirmation.fees.*`, en/ja/zh), e.g. "Overtime ¥500/hour · Cleaning ¥3,000 · No-fuel return ¥5,000", with a one-line disclaimer that these apply only if incurred. It reads the snapshots off the booking (no separate fetch). Pre-auth link + email are slice 7 (§0).

---

## 7. Tests (TDD vertical-slice, mutation-resistant)

Per `~/.claude/rules/testing.md` + proposal §6.1. One failing test → minimal impl → repeat. Mirror `packages/api/tests/integration/rls-context.test.ts` for the tenant-isolation cases (seed operator A + B + their `OPERATOR_STAFF` + renters; assert isolation both directions).

| Layer | Cases |
|---|---|
| **Validator** (`shared/test/validators/booking`) | `requestedVehicleId`/`assignedVehicleId` required UUID; optional `insuranceOptionId` UUID; reject end ≤ start (existing `.refine`); pickup/dropoff location ids required UUID; client-supplied `totalPrice`/`bookingCode`/`operatorId`/snapshot fields silently dropped |
| **booking_code unit** | 8 chars; alphabet excludes `0O1Il`; 10k generations all match `/^[2-9A-HJ-NP-Z]{8}$/` and are unique; collision path retries on injected `UNIQUE_VIOLATION` then succeeds; exhausts retries → 500 |
| **Turnaround unit** | `effectiveEndAt = endAt + resolve(override ?? locationDefault ?? 2880)`; override wins over location; location wins over 2880; **mutation guard**: a 60-min result must FAIL (proves the 48h default landed, §9 item 20) |
| **Insurance/fee snapshot unit** | selected active insurance option snapshots `{insuranceOptionId,name,dailyPriceJpy,deductibleJpy}` exactly and contributes to `totalPrice`; another operator's / archived insurance option rejected. Operator-wide + class-specific fee rows both included; another operator's fees excluded; archived fees excluded; fee snapshot element matches `{feeType,unit,amountJpy,vehicleClassId}` exactly |
| **InMemory booking repo** | CRUD + event-append; exclusion mirror now keys on `assignedVehicleId` (overlapping assigned vehicle → `EXCLUSION_VIOLATION`); renter sees own / operator sees operator's / bypass sees all; `status` projection equals last appended event's state |
| **Drizzle booking repo** (Neon `test`) | real exclusion: two CONFIRMED bookings, same `assignedVehicleId`, overlapping `[startAt, effectiveEndAt)` → `23P01`; turnaround widens the conflict window (booking B starting 24h after A's `endAt` is rejected when turnaround=48h, accepted when 12h); `bookingCode` unique → `23505`; composite FK rejects assigning a vehicle or insurance option from another operator → `23503` |
| **Service — submit** | one transaction: on exclusion failure NO `booking_events` row and NO booking row persist (atomicity — query both after the failed call); idempotent replay returns existing booking + emits no second event (`#340`); `ensureThread` runs after commit, its failure does not roll back the booking (`#335`); `now` injected (`#314`) |
| **Service — substitution** | rejects different-operator vehicle (404); rejects different-location vehicle (400); rejects lower-class vehicle (400); accepts same-operator/location/same-class → updates `assignedVehicleId`, leaves `requestedVehicleId`, appends `VEHICLE_SUBSTITUTED`; new vehicle already booked for range → `EXCLUSION_VIOLATION`→409, no event appended |
| **Route** | `POST /bookings` 201 with `bookingCode` + `insuranceSnapshot` + `feeSnapshot` in body; renter cannot set `operatorId`; operator booking list scoped (op-A staff cannot read op-B booking → 404); substitution route gated to `OPERATOR_*` (renter → 403) |
| **Web** | booking form renders active operator insurance options; confirmation page renders selected insurance + each `feeSnapshot` row + disclaimer; empty snapshot renders no block (no empty heading) |
| **E2E (Playwright) — REQUIRED before merge (§6.1)** | renter search → storefront result → vehicle selection → book → **confirmation shows booking code + vehicle details + selected insurance + potential additional charges**. Mock only HTTP boundaries (OAuth callback); Resend is slice 7 so nothing to mock here. |

**E2E gate (§6.1, §6.2):** green E2E happy-path is a **hard merge gate** for slice 6 (and slice 8). The #345/#338 E2E suites, re-seeded against the marketplace shape (default operator = Best Car Rental Osaka), run in CI throughout and must stay green (proposal §6.2(b), §8.1 regression risk).

---

## 8. Per-slice merge gate (proposal §6.1)

All green before merge: `bun run test` · `bun run lint` · `bun run --filter @kuruma/api lint:boundaries` · `bun run lint:modules` · `bun run db:verify` · **E2E happy-path green** (§6.1, hard gate for slice 6) · code-reviewer + architect agents (`memory/feedback_review-before-ship`).

---

## 9. Execution order & worktree

```
# Branch from the remote pivot; local marketplace-pivot is known to lag.
git worktree add ../kuruma-booking-events -b feature/392-booking-event-log origin/marketplace-pivot
```

Per `CLAUDE.md` Monorepo: fresh `bun install` + verify `tsc --noEmit` in the worktree. Order within the slice (vertical, RED→GREEN per cycle):

1. **Schema** — `bookings` columns + `booking_events` table + enums; generated additive migration; then **custom** migration (rename→`assignedVehicleId`, exclusion swap, trigger rebind) via `db:generate --custom`; `db:migrate`; `db:verify` (3 green).
2. **Validators** (`shared/validators/booking.ts`) — widen create schema; booking_code generator util (`shared/lib/` or `api` util) with its unit test first.
3. **InMemory repos** — `BookingEventRepository` + booking-repo changes (exclusion mirror on `assignedVehicleId`, three-way scoping); injected in tests via `createApp(overrides)`.
4. **Service** — submit transaction orchestration + substitution + insurance snapshot + fee snapshot + turnaround resolution + booking_code retry. `BookingEventRepository` + `RunInTransaction` widened bundle.
5. **DI wire** — `index.ts`: widen `createDrizzleTransaction`, construct event repo, extend `BookingService` ctor.
6. **Drizzle repos** — integration tests against Neon `test` (exclusion, FK seal, code uniqueness, turnaround window).
7. **Routes** — extend `POST /bookings`; add `POST /bookings/:id/substitute`; reuse helpers.
8. **Web** — booking insurance dropdown + confirmation selected-insurance and "potential additional charges" blocks + i18n (`rm -rf packages/web/.next && bun run dev` to pick up new namespace, `CLAUDE.md` i18n gotcha).
9. **E2E** — Playwright happy path (hard gate).
10. **Review** (code-reviewer + architect) → rebase onto `origin/marketplace-pivot` (never force push, `memory/feedback_no-force-push`) → PR `Closes #392`, link epic #385.

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Turnaround rebind leaves the legacy 60-min `bufferMinutes` default live (§9 item 20) | Medium | High | Map `bufferMinutes`→nullable `turnaroundMinutesOverride` (no default); `locations.defaultTurnaroundMinutes` default 2880; mutation-guard test asserts a 60-min result FAILS |
| Projection (`status`) drifts from the event log | Medium | High | Both writes in one transaction; integration test asserts projection == last event's resulting state; append-only repo (no update/delete) |
| Exclusion constraint not actually atomic across the rename + NOT NULL flip | Low | Critical | Custom SQL migration keyed on `assignedVehicleId` (proven pattern from `0006`); integration test forces concurrent overlap → `23P01`; per proposal §8.1 "adding operator_id doesn't change behavior" |
| Email/network side effect leaks into the transaction | Low | High | `ensureThread` stays post-commit (existing #335 seam); slice 7's EmailSender extends the same post-commit hook; explicit §0 fence + atomicity test (no booking row on rolled-back tx) |
| booking_code collision unhandled → 500 on rare clash | Low | Low | `UNIQUE NOT NULL` + bounded regenerate-on-`23505` retry inside the tx; unit test injects a collision |
| Substitution assigns another operator's / location's vehicle | Low | Critical | Composite FK `(operatorId, assignedVehicleId)→vehicles(operatorId,id)`; service checks same-operator/location/class; integration asserts 23503 + 404 |
| #387 (locations) not merged → pickup/dropoff FK + substitution location check unbuildable | Medium | High | Hard precondition (§1); do not start slice 6 web/substitution until #387 lands |
| Out-of-order journal `when` after rebase onto a moved pivot | Medium | Medium | Regenerate migration on rebase; never hand-edit `_journal.json`; `db:verify` + CI `db-drift` (`CLAUDE.md` 2026-04-17) |

---

## 11. Resolved decisions / cross-slice risks

1. **`status` vs `currentState`.** Resolved: keep existing `bookings.status` as the write-through projection target. The proposal's `current_state` name is documentation intent, not an MVP column rename.
2. **Slice 5 ↔ 6 boundary on vehicle selection.** Resolved: slice 5 owns storefront search/detail and selecting a concrete vehicle into navigation state; slice 6 owns the booking form, submit endpoint, confirmation page data, and validation. If slice 5 only lands a placeholder select control, slice 6 wires the real submit flow.
3. **Substitution class rule.** Resolved: MVP substitution requires the same operator, same pickup location, and same ACRISS class. "Better class" remains post-MVP until an explicit ACRISS rank order exists.
4. **Insurance at booking.** Resolved: renter insurance selection is in slice 6. Add nullable `insuranceOptionId` + `insuranceSnapshot` to `bookings`; snapshot selected active operator option at submit; include selected-insurance price in `totalPrice`. No per-vehicle insurance applicability table in MVP.
5. **`notification_log` ownership.** Resolved: slice 7 creates `notification_log`. Slice 6 emits `BOOKING_CREATED` and keeps post-commit hooks side-effect-safe, but creates no notification table.
