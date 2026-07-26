# One-way custody network — design

> **Status:** DRAFT for review · rev.6 (canonical rewrite) · **Date:** 2026-07-26
> **Supersedes:** `docs/plans/2026-06-21-one-way-rentals-design.md` (#882).
> Review history lives in git and Appendix A — this document states the current design only.

---

## 1. What we're building

One-way rentals where a car picked up at location **A** can be dropped at a *different* location — a branch of the **same** operator, or a **different** operator's station that opted in to host cars.
The dropped car is **received, inspected, and photographed**, then either held for return home, re-rented on a homeward trip, or (in a later phase) rented onward.

Everywhere the car goes, **the owner sets the price**; **whoever holds it earns a custody fee**.
That one separation is the whole design.

---

## 2. Core model: separate OWNER from HOST

- **Owner** — the operator that owns the car. Sets price + formula, earns the rental. (= existing `vehicles.operatorId`.)
- **Host** — whoever physically holds the car right now. Earns a per-day custody + handoff fee. **When host == owner, the fee is 0.**

This single split unifies every behavior — same-operator branch return, cross-operator handoff, homeward re-rental, ferry-home, promo-home.
All of them are "the car changed hosts," always owner-priced.
Same-operator is the degenerate case where the host fee collapses to zero and the flow is exactly today's.

---

## 3. Physical-state model — explicit, never inferred

A car's physical situation is **one explicit discriminant plus its dependent references**.
It is never read from an overloaded null, and never inferred from a changed home base.

| Concept | Meaning | Storage |
|---|---|---|
| **Owner operator** | Owns + prices. Fixed. | `vehicles.operatorId` (exists) |
| **Home base** | Canonical resting branch, one of the owner's locations. "Homeward" points here. Owner may re-label it — **a re-label never moves the car.** | reinterpret `vehicles.pickupLocationId` as home base |
| **Custody state** | `NULL` \| `AT_STATION` \| `IN_TRANSIT`. `NULL` = **custody-untracked** (§13 bootstrap — the car has no home base and behaves exactly as today). `AT_STATION` = physically parked at some operator's location. `IN_TRANSIT` = on the road (rental or ferry). | new `vehicles.custodyState` |
| **Current host** | The operator physically holding the car (= the operator of `physicalLocationId`). Non-null iff `AT_STATION`. | new `vehicles.physicalHostOperatorId` |
| **Physical location** | The location the car was last *received* at. Non-null iff `AT_STATION`. Written only on a confirmed receipt (§6). | new `vehicles.physicalLocationId` — **composite FK `(physicalHostOperatorId, physicalLocationId) → locations(operatorId, id)`** (may cross operators) |
| **In-flight leg** | The one leg currently moving the car. Non-null iff `IN_TRANSIT`. | new `vehicles.inFlightLegId` — **composite FK `(inFlightLegId, id) → movement_legs(id, vehicleId)`** so the referenced leg is the car's own |
| **Open custody period** | The current custody stint. Non-null iff `AT_STATION`. | new `vehicles.openCustodyPeriodId` — **composite FK `(openCustodyPeriodId, id, physicalHostOperatorId, physicalLocationId) → custody_periods(id, vehicleId, hostOperatorId, hostLocationId)`** so the open period always matches the car's host and location |
| **Listing hold** | Received but deliberately not listed (ferry queued, promo-home, maintenance, awaiting owner relist). | new `vehicles.heldOffline` boolean NOT NULL default false |
| **Relist policy** | On receipt: relist immediately, or wait for the owner. | new `vehicles.autoRelistOnReceipt` boolean NOT NULL default false (default = wait for owner) |

**The three-way CHECK (DB seal).** Exactly one of:

- `custodyState IS NULL` — every custody column null (untracked);
- `custodyState = 'IN_TRANSIT'` — host/location/period null, `inFlightLegId` **not** null;
- `custodyState = 'AT_STATION'` — host/location/period **not** null, `inFlightLegId` null.

With the two composite FKs above, `IN_TRANSIT` **cannot exist without its in-flight leg** and `AT_STATION` **cannot exist without a matching open custody period** — these invariants are constraints, not process discipline.

Derived, never stored:

- **"At home"** ⇔ `physicalLocationId == homeBase`. A car at a non-home owner branch is `AT_STATION`, host-is-owner (fee 0), but **not** at home.
- **"Host is owner"** ⇔ `physicalHostOperatorId == operatorId` → custody fee 0. A **foreign host** is `AT_STATION` with a different operator.
- A **home-base re-label** (§9) changes pricing / search region only — it never touches `physicalLocationId` / `physicalHostOperatorId`.

```
Learn: Overloaded null / inferred state
One nullable column standing in for "at home", "in transit", and "unknown" makes three states indistinguishable.
Heuristic: give physical state its own discriminant; let a reference be null only in the states where it is genuinely undefined — and tie state to references with a CHECK.
```

---

## 4. One movement stream — legs with a departure and an arrival

Every physical traversal — a rental, a ferry, a transfer — is **one row** in **`movement_legs`**, with a durable `id` and **both** a departure and an arrival fact:

```
movement_legs { id, vehicleId, kind (RENTAL|FERRY|TRANSFER),
                bookingId (NULLABLE — set for RENTAL, null for FERRY/TRANSFER),
                fromOperatorId, fromLocationId, toOperatorId, toLocationId,
                plannedStartAt, plannedEndAt,
                departedAt (NULL until departure), receivedAt (NULL until arrival receipt),
                voidedAt (NULL — set only by a pre-departure cancel/substitution),
                idempotencyKey, requestFingerprint, createdAt }
```

A leg is **born `PLANNED`** (`departedAt` null). `departedAt` is set **only** by the single departure transition (§5), and `receivedAt` only by the single receipt transition (§6) — each flipped exactly once.
Operations that need a leg already moving (ACTIVE substitution/assignment, §5) **compose create-planned + depart in one transaction**; the transition is still the only writer of `departedAt`.
A **voided** leg stays as an audit row but drops out of every fold and every constraint scope below.

This one stream is folded by feasibility (§8), bounds custody periods (§11), and parents receipts (§6) — one concept, three consumers.

**DB seals:**

- `UNIQUE(idempotencyKey)` — a retried create never duplicates a movement.
- **`UNIQUE(bookingId, vehicleId) WHERE bookingId IS NOT NULL AND voidedAt IS NULL`** — uniqueness follows **traversal identity**: at most one live leg per (booking, car). A booking that swaps cars mid-trip legitimately owns **two** live legs — the old car's detached recovery leg and the new car's current leg (§5). The booking's **current leg** is the live leg whose `vehicleId` equals the booking's current vehicle; the recovery leg keeps `bookingId` for audit but is excluded from every "the booking's leg" read by the vehicle mismatch.
- `CHECK ((kind = 'RENTAL') = (bookingId IS NOT NULL))` — a rental leg always names its booking; a ferry/transfer never does.
- `UNIQUE(vehicleId) WHERE departedAt IS NOT NULL AND receivedAt IS NULL AND voidedAt IS NULL` — at most **one in-flight leg per vehicle**.
- Timestamp coherence — `CHECK (receivedAt IS NULL OR (departedAt IS NOT NULL AND receivedAt >= departedAt))` and `CHECK (voidedAt IS NULL OR departedAt IS NULL)` (a departed leg is never voided — it becomes a recovery leg).
- `UNIQUE(id, vehicleId)` — the composite-FK target that lets receipts (§6) and `vehicles.inFlightLegId` (§3) pin their leg to its vehicle.

**One lock guards the whole stream.** Every timeline mutation — booking create/cancel/substitution/class-assignment, leg departure, arrival receipt — takes the same per-vehicle advisory xact-lock (`pg_advisory_xact_lock(hashtext(vehicleId))`).
Two-vehicle operations (substitution) take both locks in ascending `vehicleId` order; where the class-capacity combo lock is also held, the order is combo lock first, then vehicle lock(s).
**Leg and booking creation additionally read their endpoint `locations` rows `FOR SHARE`** inside the same transaction, so location archival (§7) serializes against them — the create-vs-archive race is closed in both directions, not accepted.

```
Learn: Movement Event Identity
One physical traversal needs one durable identity with distinct departure and arrival facts.
Heuristic: uniqueness must follow traversal identity — a booking that swaps cars is one contract over two traversals, so scope "one live leg" per (booking, vehicle), not per booking.
```

---

## 5. Custody transitions (all under the §4 lock)

- **Departure** — the one transition that starts any leg (rental pickup, ferry/transfer start). Preconditions: leg `PLANNED` (not voided), car `AT_STATION`, leg's `from` == car's physical location. Effects, atomically: set `departedAt`; car → `IN_TRANSIT` (host/location null, `inFlightLegId` := leg); close the open custody period (§11) and clear `openCustodyPeriodId`. For `FERRY`/`TRANSFER` legs a **`DEPARTURE` receipt is written in the same transaction — mandatory** (§6). For `RENTAL` legs departure evidence is optional in v1 (the existing pickup-verification flow).
- **Arrival receipt** (§6) at location `L` → set `receivedAt`; car → `AT_STATION` at `L` (host = operator of `L`); open a new custody period and set `openCustodyPeriodId`; then `heldOffline := NOT autoRelistOnReceipt`. Preconditions:
  - **Ordering (rental legs):** the booking must be **terminal** — `COMPLETED` (normal return) or `CANCELLED` (recovery). Receiving under an `ACTIVE` booking is a 409: the flow is *return → complete → receive*.
  - **No re-targeting on a normal arrival:** `L` must equal the leg's `toLocation`. Only a **recovery** receipt (below) may land elsewhere and re-set the leg's `to*` pair — in the same transaction, before the endpoint trigger (§6) checks it.
- **Pre-departure cancellation** (`CONFIRMED → CANCELLED`, car never left) → **void the planned leg**. Physical state and the open custody period are untouched.
- **Active cancellation** (`ACTIVE → CANCELLED` — operator-only, #679) → the car is physically out. Its in-flight leg becomes a **recovery leg**: the car stays `IN_TRANSIT` until a recovery receipt confirms where it actually landed.
- **Class-assignment** (`assignVehicle`, a `CLASS_COMBO` float gets its car — allowed while `CONFIRMED` **or** `ACTIVE`, `booking-lifecycle.ts:267`):
  - booking `CONFIRMED` → create the booking's `RENTAL` leg **planned** over the booking's window, feasibility-checked like a create;
  - booking `ACTIVE` → create the leg **and depart it in the same transaction** (from = the assigned car's physical location) — the rental is already underway, so an undeparted leg would be a lie.
- **Substitution** (`substitute`, allowed while `CONFIRMED` **or** `ACTIVE`, `booking-lifecycle.ts:105`):
  - **pre-departure** (`CONFIRMED`) → void the old car's leg, create a planned leg for the replacement — one transaction, both vehicle locks in sorted order, replacement feasibility-checked like a create;
  - **while `ACTIVE`** → the old car's leg **stays live as a detached recovery leg** (a receipt lands it wherever it actually returns); the replacement's leg is **created and departed in the same transaction** (from = the replacement's physical location, to = the booking's drop-off). The §4 per-(booking, vehicle) uniqueness admits both live legs; the booking's current leg is the replacement's.

### 5.1 Who may receive — authorization derives from the leg, not from custody

While `IN_TRANSIT` the car has **no** current host — so a capability scoped to *current physical custody* is empty exactly when the receipt must happen.
Authorization for a state-establishing command derives from the **intended transition**:

- **Normal arrival** → the caller must hold the custody capability at the **leg's destination operator** (`toOperatorId`) — membership at the operator whose station the plan says receives the car. Owner staff and platform admins also qualify.
- **Recovery arrival** → the destination may be wrong by definition, so the caller must hold the custody capability at the operator of the **actual receiving location**, or be owner staff / platform admin.
- **Completing a foreign-host booking** — the renter returns the car at the host **before** any receipt exists (the ordering rule above). The live leg's `toOperatorId` therefore also grants a **leg-derived, receipt-scoped capability**: mark the leg's booking returned/`COMPLETED`, then write the arrival receipt. Never general booking read/write, never cross-tenant enumeration. (Slice 2 — in Slice 1 all parties are the owner's staff.)

---

## 6. The receipt gate — procedure **and** immutable evidence

The procedure a host completes before a car reappears:

> **receive → confirm booking/identity → photograph → condition inspection**

On completion it (a) advances custody state + physical location (§5), (b) closes/opens the custody period (§11), and (c) writes an **immutable receipt record** — a model of its own, **not** the catalog-photo pipeline (vehicle photos are public catalog assets; a receipt is legal evidence).

```
handoff_receipts { id, legId (FK → movement_legs), phase (DEPARTURE|ARRIVAL), vehicleId,
                   actorUserId, atOperatorId, atLocationId, capturedAt,
                   condition (structured: fuel, odometer, damage markers, notes),
                   photoStorageKeys (PRIVATE R2 keys),
                   supersedesReceiptId (NULLABLE — a correction points at the row it replaces),
                   idempotencyKey, requestFingerprint, createdAt }
```

**DB seals:**

- `UNIQUE(idempotencyKey)` — a retried upload never double-writes.
- One canonical receipt per leg-end — `UNIQUE(legId, phase) WHERE supersedesReceiptId IS NULL`.
- `UNIQUE(supersedesReceiptId) WHERE supersedesReceiptId IS NOT NULL` — the correction chain stays linear.
- A correction stays on the same leg-end — composite FK `(supersedesReceiptId, legId, phase) → handoff_receipts(id, legId, phase)` (backed by `UNIQUE(id, legId, phase)`).
- A receipt names its leg's vehicle — composite FK `(legId, vehicleId) → movement_legs(id, vehicleId)`.
- **The receipt's location is real and correctly attributed** — composite FK `(atOperatorId, atLocationId) → locations(operatorId, id)`.
- **The receipt matches its leg's endpoint** — a deferred constraint trigger asserts `ARRIVAL.atLocationId == leg.toLocationId` and `DEPARTURE.atLocationId == leg.fromLocationId`. A recovery re-target updates the leg's `to*` in the same transaction first, so the trigger always sees a consistent pair.
- **Photos are mandatory** — `CHECK (cardinality(photoStorageKeys) >= 1)` on every receipt. Dev/test use in-memory storage; an environment without the private bucket cannot run custody, by configuration.
- **Immutable / append-only, DB-enforced** — the #1556 consent-ledger mechanism (role separation: the app role holds INSERT/SELECT only, no UPDATE/DELETE). A correction is a new row; the current view is the head of the supersession chain.
- **Private access** — a private R2 bucket/prefix (never the public catalog base); served only to the booking's parties + the handling host + platform.

**Replay semantics (normative).** A retried receipt command is resolved by **checking `idempotencyKey` first, inside the per-vehicle lock, before any state precondition**, and comparing the stored `requestFingerprint` (hash of the canonical payload):

- same key, same fingerprint → return the prior receipt (idempotent replay, even though the leg is no longer in flight);
- same key, **different** fingerprint → `409 IDEMPOTENCY_MISMATCH` — a reused key never silently returns evidence for a different claim.

The unique seal is the backstop for true races only (a 23505 aborts the transaction, so check-first ordering is required, not optional).
Photo uploads happen before the transaction; a failed transaction may orphan private keys — accepted, invisible, reaped later if ever needed.

```
Learn: Evidence model vs asset model
A public catalog photo and a legal receipt look alike (both are R2 images) but have opposite requirements.
Heuristic: evidence needs immutability, private access, an actor, endpoint coherence, and payload-bound idempotency of its own — never route it through a public-asset pipeline.
```

---

## 7. Where may a car go — receiving set and homeward leash

Two different location sets govern a drop-off; conflating them makes cross-operator hosting unreachable:

> `ownerActiveLocations(V) = { L : L.operatorId == V.operatorId ∧ L.status = 'ACTIVE' ∧ owner(V).deactivatedAt IS NULL }`
> `activeReceivingLocations(V) = ownerActiveLocations(V) ∪ { L : L.status = 'ACTIVE' ∧ operator(L).deactivatedAt IS NULL ∧ operator(L).hostOptIn }`

The receiving set is **who may take custody** (owner branches plus opted-in foreign hosts); the owner set is **where "home" may point**.
In Slice 1 (same-operator only, no opt-in yet) the two sets coincide; the policy is written over the receiving set from day one.

A car is **displaced** when `physicalLocationId != homeBase` — including a same-operator non-home branch.
The v1 drop-off policy (`P` = the car's physical location, which under §8 is always the pickup):

> `allowedDropoffs(V) =`
> — **at home** (`P == homeBase`): `activeReceivingLocations(V)` — the one permitted hop out (a one-way A→B, incl. foreign B, or the A→A round trip);
> — **displaced at P**: `({homeBase(V)} ∩ ownerActiveLocations(V)) ∪ ({P} ∩ activeReceivingLocations(V))` — **return home, or a round trip in place (P→P)**, each only while that station remains active and authorized. Nothing else.

**No onward B→C, ever, in v1** — after one hop out, every permitted trip either stays put or lands home, so drift is impossible.
The `P→P` branch keeps a displaced car earning while it waits for a homeward renter — **owner-approved 2026-07-26** (§15 Q1), conditional on exactly the intersection above.
Free-roam onward is a later phase behind the same model; the leash is one policy function, not an architecture.

**Location archival guard.** A location that is any car's home base, any car's `physicalLocationId`, or an **endpoint (origin or destination) of a live not-yet-arrived leg** cannot be archived: the archive write is a **single conditional `UPDATE … WHERE NOT EXISTS(each reference class)`** — zero rows updated ⇒ 409.
The reverse direction is closed by §4's `FOR SHARE` reads: a concurrent booking/leg create and an archive serialize on the location row, in either order.

---

## 8. The feasibility algorithm — projection excludes, never promotes

**Q3 (§15) is strict: a car is listable and bookable only at the location it was last physically received.**
A planned or in-flight leg never makes its destination searchable — promotion happens **only** on the arrival receipt.
The movement projection has exactly one job: **excluding windows the car will not be there for.**

The one predicate, shared verbatim by search, class-availability, storefront, and checkout:

```
feasible(V, pickup P, dropoff D, window [S, E)) ⇔
  1. presence   — owner status AVAILABLE, custodyState == 'AT_STATION', NOT heldOffline,
                  road-legal (shaken/insurance) through E, operator not deactivated
  2. anchor     — P == physicalLocationId                      (no promotion: pickup is where the car IS)
  3. projection — every live leg with plannedEndAt <= S lands at P
                  (fold in order; any leg landing elsewhere ⇒ infeasible — the car will be gone,
                   and its destination is not yet received, so the car is bookable NOWHERE for [S,E))
  4. overlap    — no live leg with [plannedStartAt, plannedEndAt) ∩ [S,E) ≠ ∅,
                  and no booking overlap (existing exclusion constraint) or vehicle_block
  5. leash      — D ∈ allowedDropoffs(V)                        (§7)
```

*Live* = not voided, not yet received. Rule 3's benign case is an earlier `P→P` round trip (lands back at `P` — fine); its blocking case is a pending one-way, which makes the car temporarily unbookable everywhere until its arrival receipt reopens it at the new station.

Consequences, stated explicitly:

- **Advance chaining at a destination does not exist in v1.** A car with a pending A→B booking cannot be pre-booked at B for a later window — B lists it only after the receipt (this supersedes #882's promotion half; the fold survives only as rules 3–4).
- **The SQL prefilter is the anchor, not the fold:** `physicalLocationId = P AND custodyState = 'AT_STATION' AND NOT heldOffline` plus the existing filters; the pure predicate then applies rules 3–5 per candidate. The prefilter never admits a pending destination.
- **Checkout runs the full predicate again inside its locked transaction** (§4 lock), so search never advertises what checkout would reject, and no receipt can slip between read and commit.
- **Every renter-facing display of a station uses `physicalLocationId`** — never the home base (`flat-search.ts:181`, `storefront-search.ts:157` currently key off `pickupLocationId` and must move). Home base remains a pricing / search-region input only.
- **Displaced cars skip the class capacity gate.** A displaced car belongs to no combo pool, so the class `demand >= capacity` gate (`booking-creation.ts:435`) does not apply to a SPECIFIC booking of a displaced car — its guards are the exclusion constraint plus rules 3–4. At-home SPECIFIC bookings keep the gate unchanged.
- **`CLASS_COMBO` for displaced cars is deferred.** A displaced car (same-operator branch included) drops out of the combo pool and is bookable only as `SPECIFIC`; combo for displaced inventory is a later slice.

```
Learn: Projection vs evidence
A projection predicts feasibility; it cannot substitute for required physical evidence.
Heuristic: use schedule projections to EXCLUDE what will not be true; require the physical receipt to PROMOTE what has become true.
```

---

## 9. Getting a car home (owner tools)

- **Ferry (B1)** — owner marks "bring it home"; car goes `heldOffline`; staff drive it back; on receipt at home, normal. The ferry leg is created `PLANNED` and departed through the §5 transition (mandatory `DEPARTURE` receipt).
  **v1 continuity rule:** a ferry may start only when the car has no live legs — a future booking's pickup would be stranded (409 `CUSTODY_CONFLICT`; substitute or cancel those bookings first). Scheduling a future ferry is out of v1.
- **Promo-home (B2)** — owner lists a **discounted one-way** with drop-off locked per §7 + a cutoff date. The promo applies iff the trip **lands the car at its home base by the cutoff** — compared against the booking's *arrival* (`effectiveEndAt <= cutoffAt`), never the booking-creation clock.
- **Reset home base** — owner re-labels the car's home to where it landed. No physical move (§3); it changes pricing / search region only and fires region reassignment + geocode.

---

## 10. Money & settlement (owner decisions Q2, Q4)

- Renter **always pays the owner's price** (owner rate card + formula) — one consistent price wherever the car is picked up.
- Host earns a **per-day custody fee + handoff service fee**, **deducted from the owner's payout** — the renter never sees it. Platform takes its usual cut.
- `host == owner` → fee 0 → today's single-operator settlement, unchanged.

---

## 11. Two ledgers: custody accrual and multi-party settlement

Accrual (what is owed) and payout (who pays whom) are different facts — two append-only ledgers, never a running total on the car.

**Accrual — `custody_periods`** (per stint the host *actually holds* the car):

```
custody_periods { id, vehicleId, ownerOperatorId, hostOperatorId, hostLocationId,
                  receivedAt, departedAt,                        -- [held); departedAt NULL = still held
                  openedByLegId (NULLABLE — null only for the §13 bootstrap baseline row),
                  closedByLegId,
                  dailyRateJpySnapshot, handoffFeeJpySnapshot,   -- snapshotted at receipt
                  accruedJpy,                                     -- derived at close (Slice 2)
                  settlementState (ACCRUING|CLOSED|SETTLED),
                  settlementRef, settledAt }
```

- A period spans `[receivedAt, departedAt)` — the time the host physically holds the car. It opens on the arrival receipt and **closes the instant the car departs** (§5), atomically under the §4 lock — no host accrues while a renter or ferry driver holds the car.
- **One open period per vehicle** — partial unique `UNIQUE(vehicleId) WHERE departedAt IS NULL`, plus `UNIQUE(id, vehicleId, hostOperatorId, hostLocationId)` as the §3 composite-FK target tying the open period to the car's current host/location.
- **Snapshot** the daily rate + handoff fee at receipt; a later config change never retro-alters an amount owed.
- `accruedJpy` is derived at close (`rate × heldDays + handoff`) — day-count basis and JPY rounding are Slice 2 decisions (§14.7).
- `hostIsOwner` → rate 0 → no accrual. Slice 1 runs the full open/close lifecycle at rate 0.

**Payout — a multi-party settlement record** (Slice 2): `payment_events` records a single renter→platform payer and cannot express owner→host, so custody settlement is a separate debit/credit record (debit owner, credit host, credit platform) referencing closed periods, with its own `PENDING|PAID|FAILED` state + reference and the `payment_events` idempotency discipline.
Custody can accrue with **no** renter payout (a stale held-offline car) — the settlement record stands on its own.

```
Learn: Accumulator-on-the-Entity
A running per-day total on the car erases the per-host breakdown and cannot be reconciled.
Heuristic: when a cost accrues from many sources over time, store the events and fold; when money moves between more than two parties, use an explicit debit/credit record.
```

---

## 12. Schema & surface implications (summary)

- **`vehicles`** — the §3 columns, three-way CHECK, and composite FKs (`physical*` → locations; `inFlightLegId` → its own leg; `openCustodyPeriodId` → its own matching period).
- **`operators` / `locations`** — host opt-in flag + custody-fee config (Slice 2; the §11 snapshot source).
- **`bookings`** — cross-operator legs keep the #1521 composite-FK discipline: persist host-operator snapshots per leg end with composite FKs to `locations(operatorId, id)`; never relax to bare ids. Host access is the §5.1 leg-derived capability — never owner-tenant read.
- **`movement_legs` / `custody_periods` / `handoff_receipts` / settlement** — new tables (§4, §11, §6).
- **`locations`** — no schema change; archival guarded (§7).
- **Search / availability / checkout** — the §8 predicate everywhere; display via `physicalLocationId`; displaced cars skip the capacity gate; displaced `CLASS_COMBO` deferred.
- **Booking lifecycle** — `CONFIRMED → ACTIVE → COMPLETED` drives departure; terminal status + receipt drives arrival (§5).

---

## 13. Bootstrap, migration, and the untracked on-ramp

`vehicles.pickupLocationId` is **nullable today** (`fleet.ts:105`) — a blanket "backfill `physicalLocationId := pickupLocationId`" cannot satisfy the §3 CHECK for every row. The migration is therefore explicit:

- **Columns are added additively** (all nullable or defaulted; no flag flip in the migration).
- **Backfill** (same migration, idempotent): vehicles **with** a home base → `AT_STATION`, host = owner, location = home base, plus a **baseline custody period** (owner-host, rate 0, `receivedAt` = migration time, `openedByLegId` NULL — the only rows permitted null). Vehicles **without** a home base → `custodyState` NULL (**untracked**).
- **Untracked cars behave exactly as today**: no custody gating, no one-way participation, invisible to location search (they have no location). **Assigning a home base is the tracking on-ramp** — it initializes `AT_STATION` at home + a baseline period, atomically.
- **No movement legs exist at bootstrap**; the first leg is created by the first post-flip booking/ferry (or by the flip script below for in-flight dark-era bookings).

---

## 14. Build order (each a vertical, shippable slice)

- **Slice 0 — pure core.** Custody state machine (§3/§5) + the §8 feasibility predicate + `allowedDropoffs` (§7). Pure, exhaustively unit-tested (FC/IS). No cost fold (its inputs are open, §14.7).
- **Slice 1 — same-operator homeward.** §3 columns + bootstrap (§13) + `movement_legs` (§4) + receipt gate & evidence (§6) + custody-period lifecycle at rate 0 (§11) + cancellation recovery + substitution/assignment legs (§5) + archival guard (§7) + ferry (B1) + promo-home (B2). Search **and** checkout move to the §8 predicate. No cross-company money.
- **Slice 2 — cross-operator.** Host opt-in (widening the §7 receiving set), the stronger booking-leg relation + leg-derived host capability (§5.1/§12), the cost fold + non-zero rates + multi-party settlement (§11). Behind a flag.
- **Later — free-roam onward + `CLASS_COMBO` for displaced cars.**

### 14.1 Flag + kill-switch semantics

Slice 1 ships dark behind **one runtime flag, `ONE_WAY_CUSTODY`**. A flag gates *behavior*, never *facts*:

- **Flag OFF gates outbound movement only:** no one-way bookings (drop-off ≠ pickup), no promo mutations, no ferries to anywhere **except the car's home base** — those are server-side 404-gated, not merely hidden.
- **Recovery is never gated:** departing/receiving **existing** legs, creating + running a **homeward** ferry/transfer, and the listing-hold toggle all remain available while OFF. A displaced or `IN_TRANSIT` car can always be brought home and received — a kill-switch that strands cars is not a kill-switch.
- **Pending planned legs at flip-OFF are defined:** existing confirmed one-way bookings keep their legs and run to completion through the state-driven transitions (commitments are honored), or staff cancel/substitute them normally; planned ferries may depart (homeward) or be voided.
- **Facts are always honored:** search reads the custody columns unconditionally — an `IN_TRANSIT` or `heldOffline` car stays unlistable even while dark. While the flag has never been ON this is byte-identical to today (§13 backfill makes `physicalLocationId ≡ pickupLocationId`; no legs exist).
- **The OFF booking path is kill-safe:** besides today's `pickupLocationId` equality it requires the car custody-listable and **at home** (when tracked). Equivalent while never-flipped; after a kill, displaced cars are unbookable until received/ferried home — never bookable at a station they are not at.
- **Cutover fence:** the leg-synthesis script (idempotent, print-first) runs **immediately before and immediately after** each flip. It synthesizes legs for pre-flag `CONFIRMED`/`ACTIVE` bookings and departed `TRANSFER` recovery legs for cars whose dark-era `COMPLETED` one-way left them away from their materialized location (staff then receive them through §6 — evidence intact, no silent teleport). Between the two runs, the never-gated state-driven endpoints own every in-flight movement, so no request spanning the flip is lost.

---

## 15. Owner (kaku) decisions — record

- **Q1 — Roam vs homeward.** Phase 1 is **homeward-only** (§7). **Displaced `P→P` round trips: approved 2026-07-26**, conditional on `P` remaining active and authorized (the §7 intersection). No onward B→C.
- **Q2 — Pricing.** Always the **owner's** rate card + formula. The host only adds custody + handoff fees.
- **Q3 — In-transit booking (exact reading, re-confirmed 2026-07-26).** A car in transit cannot be booked, for any window. It must be physically received, confirmed, photographed, and condition-checked before it appears anywhere. **Every return requires an arrival photo receipt; `autoRelistOnReceipt` changes only the post-receipt listing choice and never bypasses the receipt.**
- **Q4 — Fee incidence.** The host's custody fee is **deducted from the owner's payout**; the renter sees only the owner's price.

---

## 16. Open questions

1. **Cross-operator liability** — receipt inspection finds damage: previous renter's leg or in-custody? The §6 record is the evidence; the policy is a business decision.
2. **Settlement cadence** — per handoff or periodic sweep of closed rows? (Lean: per-handoff.)
3. **Host fee model** — flat per-day, or per-day + fixed handoff? Who sets it — host, with a platform floor/cap?
4. **Insurance on a homeward re-rental from a foreign host** — whose policy covers the leg? (Likely the owner's — confirm.)
5. **Reset-home-base side effects** — region reassignment + geocode fire; never a physical move (§3/§9).
6. **Stale car** — nobody ferries or books homeward: the car stays `heldOffline`, custody accrues (owed to the host). Surface drift + cost to the owner; no system deadline in v1.
7. **Settlement rounding + day-count** — calendar days vs 24h periods, JPY rounding. Structure fixed (§11); numbers are a business call.
8. **`CLASS_COMBO` for displaced/hosted cars** — confirm the deferral (§8) and design the pool/price model later.

---

## 17. Out of scope (v1)

- Free-roam onward (B→C→D).
- `CLASS_COMBO` participation for displaced/hosted cars.
- Automated fleet rebalancing / route optimization.
- Cross-operator liability/insurance *settlement* beyond capturing the evidence record.
- Advance booking of a car at any location before it is physically received there (Q3-strict, §8).
- Scheduling future ferries.

---

## 18. Why this approach

- **Owner/Host separation** — one split unifies same-operator and cross-operator; `host == owner` degrades cleanly to today.
- **Physical location is the only listing basis; projection only excludes.** Q3-strict removes the read/write drift class entirely: search, storefront, and checkout share one small predicate anchored on a received fact (§8).
- **Explicit physical state, everything else derived** — a three-way discriminant whose dependent references are tied on by CHECK + composite FKs; *home* and *host-is-owner* are derived, never encoded (§3).
- **Uniqueness follows traversal identity** — a mid-trip swap makes one booking own two traversals; the constraints model that instead of fighting it (§4/§5).
- **Authorization from the intended transition** — the receipt that establishes custody is authorized by the leg's destination, not by the custody it hasn't established yet (§5.1).
- **Custody tracks possession** — a period spans only `[receivedAt, departedAt)`; nobody is charged for custody they don't have (§11).
- **Evidence at the boundary** — private, immutable, photo-mandatory, endpoint-coherent, fingerprint-idempotent receipts (§6).
- **Kill-safe by construction** — outbound gated, recovery never gated, facts always honored (§14.1).
- **Policy as a dial** — homeward vs free-roam is one function over an explicit receiving set (§7).

---

## Appendix A — review history

- **rev.1** — initial design (materialized location).
- **rev.2–rev.4** — three design-review rounds: restored the timeline predicate alongside the materialized fact, movement-leg identity, custody-period possession semantics, archival guard, one-open-period seal.
- **rev.5** — folded eight plan-review blockers (state-dependent leash, substitution legs, ferry transition, receipt ordering/idempotency, flag semantics, capacity-gate skip, display mapping, added seals).
- **rev.6 (this)** — canonical rewrite after the rev.5 review: projection-excludes-never-promotes feasibility (§8) replacing destination promotion; traversal-identity leg uniqueness admitting ACTIVE substitution/assignment (§4/§5); receiving set split from homeward set, foreign drop-offs restored (§7); leg-derived receipt authorization (§5.1); recovery-only operations while OFF + cutover fence (§14.1); bootstrap/untracked on-ramp + baseline periods (§13); state↔reference composite-FK seals, endpoint trigger, photo CHECK, `FOR SHARE` archival serialization (§3/§6/§7); fingerprint-bound idempotency + mandatory ferry departure evidence (§6). Displaced `P→P` approved; Q3 exact reading recorded (§15).

Full diffs: `git log -- docs/superpowers/specs/2026-07-26-one-way-custody-network-design.md`.
