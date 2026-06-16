# Class-Combo Deals (#464) — Build Design & Pricing Decision

| | |
|---|---|
| **Issue** | #464 — `feat(marketplace): class-combo deals + inventory-count availability (post-demo)` |
| **Date** | 2026-06-15 |
| **Status** | Architect-reviewed (**GO-WITH-CHANGES**) + colleague-reviewed (3 findings folded in) → **pricing DECIDED: industry-standard class rate-plan table** → ready to build pending §7 sign-off |
| **Priority** | P2, post-demo |
| **Branch / worktree** | `feat/464-class-combo` / `~/Dev/kuruma-464-class-combo` (off trunk `marketplace-pivot`) |
| **Prior art** | Design comment on #464; architect review `#464#issuecomment-4713568339`; colleague review (payment guard / discriminated input / per-location table); memory `project_464-class-combo-design.md` |

---

## TL;DR

The concurrency mechanism is **sound and verified against the real code**. **Pricing is decided (§5):** follow the battle-tested **fleet-rental** model — a combo is priced by a **dedicated class rate-plan table** (`classRatePlans`), keyed by `(operator, location, class)` — *not* a column on the class, *not* a representative-car quote. The combo price is therefore **final and deterministic at book time** (no #429-style backfill, and no mutable-price hazard against the #461 Stripe path — §5.4).

Remaining for your sign-off (§7): the per-car boundary (combo-only vs. fuller migration — I recommend **combo-only**), the starting column set, and a greenlight to build slices 0–1 (two danger-zone migrations).

---

## 1. What the feature is

A **CLASS_COMBO** ("class deal") booking lets a renter book a *vehicle class* (e.g. "Compact at the Osaka store") instead of a specific car. No car is chosen at book time — the booking **"floats"** — and the operator assigns a concrete car on or before pickup. Contrast with today's only mode, **SPECIFIC** (renter picks the exact car).

This is **additive, not greenfield.** Already merged: `bookings.fulfillmentMode` (`SPECIFIC | CLASS_COMBO`, #463), the exclusion constraint keyed on `assignedVehicleId` (`drizzle/0037`), `VehicleClassAvailabilityService`, and the `ClassComboSearchResult` search DTO (no producer yet).

---

## 2. Core problem & mechanism (condensed; full detail in the #464 comment)

**Problem:** the double-booking exclusion constraint is keyed on `assignedVehicleId`, and Postgres **skips exclusion checks when that column is NULL**. A float (NULL car) therefore never conflicts and never claims a car — yet it still consumes one unit of class capacity. Overbooking occurs when `floats + specific-occupancy > totalCars(class)`.

**Invariant** — for every `(operator, pickupLocation, class)` and every instant in range:
`(SPECIFIC bookings occupying class-C cars) + (floating CLASS_COMBO of class C) ≤ totalCars(C)`.

**Mechanism (4 parts):**
1. **Booking schema + create contract** — discriminated create input (§4.1); `assignedVehicleId`/`requestedVehicleId` nullable with CHECKs so `SPECIFIC ⇒ both NOT NULL`. Floats may be NULL only while `CLASS_COMBO` + unassigned. No exclusion-constraint change (NULLs auto-skip; assigning a car later re-enters the constraint and claims it atomically).
2. **Write guard** (in `booking-creation.ts` tx) — take a per-`(operator,location,class)` advisory lock, count current class demand over the requested range, assert `demand ≤ totalCars` else **409**, then insert. Correct under READ COMMITTED because the lock *orders* count-then-insert.
3. **Read side** — extend `VehicleClassAvailabilityService` to subtract floats so search `availableCount` stops over-counting.
4. **Assignment** — operator sets `assignedVehicleId` NULL→car via the existing substitution path; the exclusion constraint re-checks on `UPDATE` and atomically rejects an already-taken car.

> **Pricing and inventory are orthogonal.** The §5 rate-plan decision changes only *how a combo is priced*; the concurrency/inventory guard above is unaffected.

---

## 3. Architect rulings — RESOLVED (for the record; no action needed)

| # | Decision | Ruling | Why |
|---|---|---|---|
| 1 | Count precision | **Simple `COUNT(*)` overlap**, not a max-concurrent sweep | Conservative (can only over-count → never overbooks); at 40–50 cars the sweep solves a problem we don't have |
| 2 | Lock SPECIFIC creates? | **Always** take the class lock (both insert types) | "Only when floats exist" is a check-then-act race; a new SPECIFIC of a free car can steal the last unit from floats |
| 3 | Demand status filter | **`status IN ('CONFIRMED','ACTIVE')`** — confirmed complete | Enum is `CONFIRMED/ACTIVE/COMPLETED/CANCELLED`; no payment-pending *booking* status (payment state lives in `payment_events`). Matches the exclusion constraint + `findAvailableVehicles` exactly |
| 4 | Granularity | **per-`(operator, pickupLocation, class)`** | Cars physically live at one location; pooling across locations overbooks a store. Lock key + demand count + read availability + **rate plan** must all carry `pickupLocationId` |

**Verified against code:** exclusion NULL-skip holds; the `effectiveEndAt` trigger keys on `pickupLocationId` (not `assignedVehicleId`), so **floats get a correct time range**; the `bookings_specific_requires_assigned` CHECK already exists (`booking.ts:162`, authored "for #464"); all seed rows satisfy it; `runTx` is READ COMMITTED so the correctness argument holds; **no advisory-lock precedent in the repo** (net-new primitive).

> **Correction (colleague review):** the architect pass's "no Stripe / pay-at-pickup, no payment path" claim was **wrong** — a live #461 `PaymentService` (Stripe Checkout) exists (`payment/payment.ts`). It does *not* add a booking status (payment lives in `payment_events`), so the demand-filter ruling (#3) **stands** — but it forces must-fix #7 (combo checkout guard) and shaped §5.4.

---

## 4. Engineering must-fixes — MECHANICAL (no product decision needed)

### 4.1 Discriminated create input (colleague P1) — do this, not "nullable ids"
`createBookingSchema` (`validators/booking.ts:11`) *hard-requires* `requestedVehicleId` (`:13`) and derives operator/class/location/price from that vehicle — there is **no combo input path**. Merely nulling the ids would scatter mode-correctness into runtime `if`s (the *Optional Everything* smell). Model the modes at the boundary:

```
createBookingSchema = discriminatedUnion('fulfillmentMode', [
  SPECIFIC    { fulfillmentMode:'SPECIFIC',    requestedVehicleId, ...common },
  CLASS_COMBO { fulfillmentMode:'CLASS_COMBO', classId, pickupLocationId, ...common },
])
```
Server validates the combo's `classId`+`pickupLocationId` belong to a real operator/location. Back-compat: a missing `fulfillmentMode` defaults to `SPECIFIC` (existing clients unchanged). *(Aligns with `typescript.md`: discriminated unions over optional flag bags.)*

### 4.2 The rest
1. `assignedVehicleId` **and** `requestedVehicleId` go **nullable** in the table (a float has neither) + parallel CHECKs to back the discriminator.
2. **Assignment/substitute path must take the same class lock** (`booking-lifecycle.ts`) — float→specific transitions are otherwise unguarded against concurrent creates (exclusion only catches same-*car* collisions, not the class-capacity invariant).
3. **Read side must become location-aware** (`vehicle-class-availability.ts:35` currently takes a slug, no location) — filter `totalCars` by `pickupLocationId` and subtract location-scoped floats.
4. **Advisory key: two-`int4` form** with a dedicated namespace constant (not single `bigint hashtext()`).
5. **Wire raw-SQL `pg_advisory_xact_lock` into the tx repo bundle** (`transaction.ts`) **and simulate the capacity guard in the in-memory repo** — the in-memory `runInTransaction` is a no-op pass-through; the lock is Postgres-only, so unit tests must still cover the invariant in memory while the real-pg concurrency test exercises the actual lock.
6. **Reuse the exact predicate trio** already in `0037.sql` + `findAvailableVehicles` (`status IN ('CONFIRMED','ACTIVE') AND tstzrange && range`). Note at all copies: if a payment-HOLD state is ever introduced (#851), they move together.
7. **Block checkout for an unassigned combo (colleague P1).** The live #461 path: `createCheckoutSession` charges `booking.totalPrice` and 422s a null total (`payment/payment.ts:109–110`); the webhook flags `amountTotal !== booking.totalPrice` as an anomaly (`:184`). Our rate-plan price is **final + non-null at book time**, so there's no mismatch hazard — but a *car-less* booking still shouldn't take money. Add: `createCheckoutSession` returns **409 for `CLASS_COMBO` with `assignedVehicleId IS NULL`**. Fits pay-at-pickup (car assigned by pickup, before payment) and dodges the #851 refund-on-unfulfillable risk.

---

## 5. ✅ DECISION — industry-standard class rate-plan table

**Chosen:** follow the battle-tested **fleet-rental** pricing model (Hertz / Avis / Expedia / ACRISS; hotels price room *types*, airlines price fare classes — the *category* is the pricing unit, the specific unit is a fulfillment detail). Price the combo on the **class**, stored in **its own rate-plan table** — *not* a column on `vehicleClasses` (which would couple a volatile price onto the stable taxonomy entity; also `vehicle_classes` is operator-wide while pricing is per-location, so a column would lie about its grain — colleague P2), and *not* the representative-car heuristic.

### 5.1 The table (minimal now, table-shape ready for more)
`classRatePlans` / `class_deal_rates` (name TBD — §7):

| column | type | note |
|---|---|---|
| `id` | text PK | |
| `operatorId` | text, FK→operators (restrict) | tenant; matches the #728 FK convention |
| `classId` | text | composite FK `(operatorId, classId)` → `vehicleClasses`, matching `fleet.ts` |
| `pickupLocationId` | text, FK→locations | **per-location** (matches §3 ruling 4 + colleague P2) |
| `dayRateJpy` | integer | the combo's day rate — set deliberately (e.g. below the cheapest car = a real "deal") |
| `isActive` | boolean, default true | toggle a deal on/off without deleting it |
| `label` | text, nullable | optional display ("Weekend Compact Deal") |
| `createdAt` / `updatedAt` | timestamptz | |
| **UNIQUE** | `(operatorId, classId, pickupLocationId)` | one active rate per class+location (until date ranges arrive) |

**Deferred but table-ready** (this is *why* a table beats a column): `validFrom`/`validUntil` (seasonal), `minDays`/`maxDays` (length tiers), `channel` (Trip.com vs web). YAGNI now; the table absorbs them when a second pricing axis is actually needed.

### 5.2 What this simplifies
- Combo `totalPrice` is **known at book time**: `composeBookingTotal({ base: dayRateJpy × days, insurancePerDay, days, addOns })`. No representative-car selection, no quote-vs-charge drift, **no #429 backfill for combos**.
- A "deal" is just a row (operator sets `dayRateJpy`). The discount-vs-convenience question **dissolves** — a rate set below the cheapest specific car *is* the discount.
- No active rate plan for `(operator, location, class)` ⇒ that class simply isn't offered as a combo. Clean fallback.

### 5.3 The boundary I'm recommending (your call — §7)
Keep **#406 per-car pricing for SPECIFIC bookings**; the rate plan prices **combos only**. Two coherent paths: SPECIFIC = marketplace per-car (#406); CLASS_COMBO = fleet class-rate (this table). The *full* industry-standard would price everything off the class rate plan, but that reverses your deliberate marketplace per-car model — almost certainly not what you want.

### 5.4 Payment interaction (colleague P1 — why the rate-plan choice is also the safe one)
The rate plan makes the combo `totalPrice` **final at book time**, so the live #461 Stripe path (`createCheckoutSession` charges `booking.totalPrice`; the webhook rejects an amount mismatch) sees a stable, non-null amount — none of the A1/A2 mutable-price reconciliation hazard the colleague flagged. The only added rule is must-fix #7: **don't let a car-less combo be paid** — money moves once a car is committed, which is exactly the pay-at-pickup order.

> *Distributed Transaction Assumption (colleague's Learn):* a booking assignment and a payment capture are separate facts; a mutable `totalPrice` treated as atomic across both is a reconciliation bug. The rate-plan design sidesteps it by making the charged amount **immutable from book time**.

---

## 6. Build order (TDD vertical slices) + what gates what

| Slice | Work | Gated by |
|---|---|---|
| **0. Rate-plan table** | `classRatePlans` migration (§5.1) + repo + seed a few deal rates. **Danger zone (schema):** `db:generate` → `db:migrate` → `db:verify`. Operator management UI deferred (seed-only to start). | §5 (done) |
| **1. Booking schema + create contract** | `assignedVehicleId`/`requestedVehicleId` nullable; CHECKs; FK MATCH SIMPLE; migrate → verify (**danger zone**). **Discriminated `createBookingSchema`** (§4.1). Add availability-repo `countClassDemand(...)`. | greenlight |
| **2. Write guard + pricing + pay-gate** | Advisory lock + demand count + 409 in `booking-creation.ts`; combo prices off the rate plan via `composeBookingTotal`; **block unassigned-combo checkout** (#7); **real-pg concurrency test** (two floats for the last car → exactly one 409); in-memory simulation. | slices 0–1 |
| **3. Read** | Location-aware `getAvailabilityForClass` subtracts floats; over-count fix test. | slice 1 |
| **4. Assignment** | float→specific via substitution path **+ class lock**; exclusion-constraint test (assign an occupied car → reject). **No price backfill** — combo price already final. | slice 1 |
| **5. Search card** | `ClassComboSearchResult` producer with `availableCount` + rate-plan `dayRateJpy`; web `case 'CLASS_COMBO'` card. | slices 0, 2, 3 |
| **6. E2E** | Book a class deal → operator assigns a car → it shows on the calendar/booking. | all |

**Later (not blocking the core):** operator UI to CRUD deal rates; the deferred rate-plan columns when a 2nd pricing axis is genuinely needed.

---

## 7. For your sign-off
1. **Boundary (§5.3):** rate plan prices **combos only**, SPECIFIC stays on #406 per-car? *(Recommended.)* Or a fuller migration to class-rate for everything?
2. **Starting columns:** minimal set (`dayRateJpy` + `isActive` + `label`) now, date-range/length-tier later? Or include any from the start?
3. **Operator management:** seed deal rates initially (UI later), or is an operator CRUD surface part of this feature's definition of done?
4. **Name:** `classRatePlans`, or the colleague's `class_deal_rates` (more specific to the deal use), or `comboRates`?
5. **Checkout policy (§5.4 / #7):** confirm — **block payment until a combo has an assigned car** (recommended), vs. allow prepay of a car-less combo (price is final, so technically safe, but adds #851 refund exposure)?
6. **Greenlight** slices 0–1 (both danger-zone migrations) to start the TDD build?
