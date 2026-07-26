# One-way custody network — design

> **Status:** DRAFT for review · rev.5 (plan-review blockers folded) · **Date:** 2026-07-26
> **Supersedes:** `docs/plans/2026-06-21-one-way-rentals-design.md` (#882) — but **retains** its timeline-feasibility predicate + per-vehicle lock (see §2). The derived-location model is *not* fully abandoned; only its use as the source of *current* location is replaced.
> **Confirmed with owner (kaku):** four business decisions, recorded in §14. **Owner-signed-off:** the `AT_STATION|IN_TRANSIT` state shape; deferring displaced `CLASS_COMBO`.
> **Review history:** rev.2 folded six findings; rev.3 folded five second-round blockers; rev.4 folded four third-round P1s + the one-open-period DB constraint. rev.5 folds the eight plan-review blockers: state-dependent homeward policy (§7), displaced cars vs the class capacity gate (§11), substitution/assignment leg semantics (§5), ferry depart-through-the-one-transition + no-pending rule (§8), full custody conditions at checkout + physical-location display mapping (§11), receipt ordering/idempotency/no-re-target (§5/§6), flag + kill-switch semantics (§12.1), archival atomicity + origin endpoints + mandatory photos + five added DB seals (§6/§7). One refined policy point is flagged for the owner in §14 Q1.

---

## 1. What we're building

One-way rentals where a car picked up at location **A** can be dropped at a *different* location — a branch of the **same** operator, or a **different** operator's station that opted in to host cars.
The dropped car is **received, inspected, and photographed**, then either held for return home, re-rented on a homeward trip, or (in a later phase) rented onward.

Everywhere the car goes, **the owner sets the price**; **whoever holds it earns a custody fee**.
That one separation is the whole design.

---

## 2. Relationship to the old model — the objection *narrows*, it does not dissolve

The old #882 design *derived* a car's location as a fold over its **future** booking timeline, specifically to avoid a mutable `currentLocationId`.
It had to, **because it allowed advance one-way bookings** — you could book a car at B *before it arrived*, so "where is the car now" could not answer "where will it be at a future pickup."

Two forces change what we need — but only one of them removes work.

1. **Q3 (§14) removes advance foreign-*listing*.**
   A car is never listed at a location it has not yet reached; it becomes listable at B only after B physically receives, confirms, photographs, and inspects it.
   So we never predict an arrival to decide *whether to advertise the car at a new station*.
   A **materialized present-tense location** is therefore a correct basis for the *first-listing gate* — and, being a fact rather than a prediction, is safe to store.

2. **A car that is validly at B can still take future bookings that relocate it.**
   This is the half of the old objection that does **not** dissolve, and the review caught that rev.1 missed it.
   A car physically at B — listed, correct — can be booked **B→A for a future window**.
   The instant that booking exists, the car's location *after* it is A.
   A later search for "pickup at B next month" must **not** match this car on the stale present-tense scalar; by then the car is at A.
   This is exactly #882's symmetric case ("available at A wrongly matches a car no longer there"), and Q3 never touched it.

So the model keeps **both**, for two different questions:

- **"Where is it now / may it be listed at a foreign station at all?"** → the **materialized** physical location (§4), gated by the receipt procedure (§6). Cheap, present-tense, a fact.
- **"Is a pickup at P feasible for a future window `[S, E)`?"** → the **restored, locked, shared** timeline-feasibility predicate — `locationAt(V, t)` plus pickup/dropoff continuity from **#882 §3.1**, used *identically* by search and checkout (§11).

The materialized scalar is the fold evaluated at *now*; the predicate is the fold evaluated at a *requested future instant*.
They never contradict, because the scalar is written only on a confirmed receipt — which is itself a movement event the fold sees.
**#882 §3.1 is preserved verbatim for this reason. Do not delete it.**

### 2.1 One movement stream — legs with a departure and an arrival

The predicate is not "fold the bookings." #882's `locationAt` folded *bookings* only, which was correct there because bookings were the sole movement source.
Slice 1 adds two **non-booking** movements — a **ferry** (owner staff repositions the car) and the **receipt confirmation** itself — so a booking-only fold would make a ferried car vanish from the timeline and would read an in-transit car's `physicalLocationId = NULL` as "nowhere."
So the fold takes **one stream of movement *legs*** (§6.1). A leg is **one physical traversal** — `RENTAL`, `FERRY`, or `TRANSFER` — carrying a **departure** fact *and* an **arrival** fact, never two independent events:

- **Actual baseline (immutable, proves the past).** Legs whose **arrival is confirmed** (`receivedAt` set). The most recent one *is* the materialized `physicalLocationId` — it anchors where the car actually is at `now`.
- **Planned projection (predicts the future).** Legs **not yet arrived** (`receivedAt IS NULL`) — a confirmed booking, or a scheduled ferry/transfer — projecting the car to their `toLocation` at `plannedEndAt`.

A leg's **planned projection is replaced by its actual arrival exactly once**: setting `receivedAt` (the receipt gate, §6) flips it from projected to baseline, guarded by the per-vehicle lock **and a `receivedAt IS NULL` precondition** so a re-fired receipt is a no-op.
An `IN_TRANSIT` car's baseline is therefore its *last arrived leg* (never `NULL`), with the in-flight leg (departed, not yet arrived) as the projection that will next relocate it.
This is exactly #882 §5.1's anticipated `vehicle_movements` source — now made concrete.

**One lock guards the whole stream.** Every operation that mutates the timeline — booking **create / cancel / substitution / class-assignment** (create/cancel already locked, #882 §5.3) **plus leg departure (rental/ferry start) and arrival receipt** — takes the *same* per-vehicle advisory xact-lock (`pg_advisory_xact_lock(hashtext(vehicleId))`), so the check-then-act over the stream is race-free. A receipt that lands between a create's read and its commit must not slip past the feasibility check.
**Two-vehicle operations lock in sorted order.** Substitution mutates *two* cars' timelines (the old car's leg is voided or becomes a recovery leg; the replacement gains one). Both per-vehicle locks are taken, always in ascending `vehicleId` order, so two concurrent substitutions can never deadlock. Where the class-capacity lock is also held (booking create), the order is: combo lock first, then vehicle lock(s) — one documented order everywhere.

```
Learn: Movement Event Identity
One physical traversal needs one durable identity with distinct departure and arrival facts.
Heuristic: do not represent the two ends of one trip as independent movements unless their lifecycle and ordering are explicit.
```

```
Learn: Stored fact vs future feasibility
A materialized current location is an excellent record of completed custody, but it cannot prove a future pickup is feasible.
Heuristic: materialized state answers "where is it now"; a locked schedule predicate answers "can it be there then." Keep both.
```

```
Learn: Actual movements vs planned movements
Bookings predict intended movement; receipts and ferries prove actual movement — a feasibility fold that sees only one is blind to the other.
Heuristic: every feasibility timeline needs both an immutable actual baseline and scheduled future legs, folded as one stream.
```

---

## 3. Core model: separate OWNER from HOST

- **Owner** — the operator that owns the car. Sets price + formula, earns the rental. (= existing `vehicles.operatorId`.)
- **Host** — whoever physically holds the car right now. Earns a per-day custody + handoff fee. **When host == owner, the fee is 0.**

This single split unifies every behavior — same-operator branch return, cross-operator handoff, homeward re-rental, ferry-home, promo-home.
All of them are "the car changed hosts," always owner-priced.
Same-operator is the degenerate case where the host fee collapses to zero and the flow is exactly today's.

---

## 4. Physical-state model — explicit, never inferred

A car's physical situation is **one explicit state plus one location**.
It is never read from an overloaded null, and never inferred from a changed home base.

| Concept | Meaning | Storage |
|---|---|---|
| **Owner operator** | Owns + prices. Fixed. | `vehicles.operatorId` (exists) |
| **Home base** | Canonical resting branch, one of the owner's locations. "Homeward" points here. Owner may re-label it — **a re-label never moves the car.** | reinterpret `vehicles.pickupLocationId` as home base |
| **Custody state** | `AT_STATION` \| `IN_TRANSIT`. The discriminant — *possession*, not ownership. `AT_STATION` = physically parked at some operator's location; `IN_TRANSIT` = on the road (rental or ferry), no station. | new `vehicles.custodyState` |
| **Current host** | The operator physically holding the car (= the operator of `physicalLocationId`). Needed to compute the custody fee **and** as the composite-FK operator component. Null iff `IN_TRANSIT`. | new `vehicles.physicalHostOperatorId` |
| **Physical location** | The location the car was last *received* at. Null iff `IN_TRANSIT`. Written only on a confirmed receipt (§6). | new `vehicles.physicalLocationId` — **composite FK `(physicalHostOperatorId, physicalLocationId) → locations(operatorId, id)`** (may cross operators — §11) |

- **"At home" is derived from *location*, not custody state:** `atHome ⇔ physicalLocationId == homeBase`. A car at a **non-home owner branch** is `AT_STATION`, host-is-owner (fee 0), but **not** at home — the old `AT_OWNER`/`AT_HOST` split conflated these and is gone.
- **"Host is owner" is derived:** `hostIsOwner ⇔ physicalHostOperatorId == operatorId` → custody fee 0. A **foreign host** is `AT_STATION` with `physicalHostOperatorId != operatorId`.
- **Invariant (DB CHECK):** `custodyState == IN_TRANSIT` ⇔ `physicalHostOperatorId IS NULL` ⇔ `physicalLocationId IS NULL`. The discriminant and the nulls can never drift.
- A **home-base re-label** (§8) changes pricing / search region only — it must **never** move `physicalLocationId` / `physicalHostOperatorId`.

```
Learn: Overloaded null / inferred state
One nullable column standing in for "at home", "in transit", and "unknown" makes three states indistinguishable, and inferring location from an unrelated edit (a home-base change) silently corrupts it.
Heuristic: give physical state its own discriminant; let a location be null only in the one state where it is genuinely undefined.
```

---

## 5. Custody state machine (search on/off)

A car is **ON** in search when **all** hold:

- owner status `AVAILABLE`;
- `custodyState == AT_STATION` at an opted-in location (host-is-owner, or a foreign host that opted in — §4 derived);
- not `HELD_OFFLINE` (a listing-suppression flag on a received car — ferry queued, promo-home, maintenance);
- **the feasibility predicate (§2 / §11) admits the requested window** (this is the P0 gate — presence alone is not enough);
- no booking overlap (the existing exclusion constraint).

`IN_TRANSIT` is always off (the §14 Q3 constraint).

Transitions (all under the §2.1 per-vehicle lock):

- **Departure** — a leg (rental or ferry) starts → set the leg's `departedAt`, `custodyState := IN_TRANSIT`, `physicalHostOperatorId := NULL`, `physicalLocationId := NULL`, **and the open custody period closes** (`departedAt := now`, §10). The host stops accruing the moment the car leaves it.
- **Arrival receipt** (§6) at host `H`, location `L` → set the leg's `receivedAt`, `custodyState := AT_STATION`, `physicalHostOperatorId := H`, `physicalLocationId := L`, **and a new custody period opens** (`receivedAt := now`, §10); then, per the owner's per-car setting, either listable (**ON**) or **`HELD_OFFLINE`**. Home vs foreign is derived (§4), not branched here. Two receipt preconditions:
  - **Ordering (rental legs):** the receipt is accepted only once the booking is **terminal** — `COMPLETED` (normal return) or `CANCELLED` (recovery). Receiving a car whose booking is still `ACTIVE` is a 409: the flow is *return → complete → receive*, matching §11 ("`COMPLETED` + the receipt gate drives the host change"). Ferry/transfer legs have no booking and need only be in flight.
  - **No re-targeting on a normal arrival:** `L` must equal the leg's planned `toLocation`. Only a **recovery** receipt (the leg's booking is `CANCELLED`, §5 active-cancel) may land at a different location and re-set the leg's `to*` pair. Condition-data mistakes are fixed by supersession corrections (§6.2), never by moving the arrival.
- **Pre-start cancellation** (`CONFIRMED → CANCELLED`, car never left) → **void the planned leg**; it drops out of the projection. Physical state and the open custody period are untouched — the car never moved.
- **Active cancellation** (`ACTIVE → CANCELLED`, car already departed — operator-only, no fee, #679) → the car is **physically out and cannot be teleported home**. The in-flight rental leg becomes a **recovery leg**: the car **stays `IN_TRANSIT` until a receipt** confirms where it actually landed (which may not be the original drop-off). Only that recovery receipt returns it to `AT_STATION`. (This is the `booking-lifecycle.ts` `updateStatus(→CANCELLED)` path, not renter self-cancel, which is `CONFIRMED`-only.)
- **Class-assignment** (a `CLASS_COMBO` float gets its car — `assignVehicle`) → a float has no car, hence no leg at create; **the booking's `RENTAL` leg is created at assignment**, planned over the booking's window, under the assigned car's timeline lock and the same feasibility check as a SPECIFIC create.
- **Substitution, pre-departure** (booking `CONFIRMED`) → **void the old car's leg, create a planned leg for the replacement** — one transaction, both timeline locks in sorted order (§2.1), replacement feasibility checked like a create.
- **Substitution while `ACTIVE`** → the old car is physically out: its leg **stays in flight as a recovery leg** (a receipt lands it wherever it actually returns, as in active-cancel); the replacement's leg is created **already departed** at the substitution instant. The booking's remaining window rides the new car; the old car's recovery is independent of the booking.
- Auto-relist vs wait-for-owner on receipt is a **per-car owner setting** — default *wait for owner*, one-flip *auto-relist on receipt*.

---

## 6. The receipt gate — procedure **and** an immutable receipt record

The procedure a host completes before a car reappears:

> **receive → confirm booking/identity → photograph → condition inspection**

On completion it (a) advances custody state + physical location (§5), (b) closes/opens the custody period (§10), and (c) writes an **immutable receipt record** — a model of its own, **not** the catalog-photo pipeline.

### 6.1 One leg per traversal — the durable movement identity

A movement is **one physical traversal**, not two events. A rental **departs** its pickup and **arrives** at its drop-off; those are the two ends of *one* leg — not a `BOOKING_PICKUP` handoff and a `BOOKING_DROPOFF` handoff each with a lone `confirmedAt`. (A receipt also cannot be keyed by `(bookingId, kind)`: a **ferry has no booking**.)
So every movement — a rental, a ferry, a transfer — is **one row** in **`movement_legs`**, with a durable `id` and **both** a departure and an arrival fact:

```
movement_legs { id, vehicleId, kind (RENTAL|FERRY|TRANSFER),
                bookingId (NULLABLE — set for RENTAL, null for FERRY/TRANSFER),
                fromOperatorId, fromLocationId, toOperatorId, toLocationId,
                plannedStartAt, plannedEndAt,          -- projection window (§2.1)
                departedAt (NULL until departure), receivedAt (NULL until arrival receipt),
                voidedAt (NULL — set only by a pre-start cancel/substitution, §5),
                idempotencyKey, createdAt }
```

This is the **same movement the §2.1 feasibility stream folds** and the boundary the §10 custody period opens/closes on — one concept, three consumers. A **voided** leg (pre-start cancel or pre-departure substitution, §5) stays as an audit row but drops out of every fold. `toOperatorId`/`toLocationId` may be **re-set on receipt only for a recovery leg** (its booking `CANCELLED`, §5) — a normal arrival never re-targets.

**DB seals:**
- **`UNIQUE(idempotencyKey)`** — a retried create-leg command never duplicates a movement.
- **`UNIQUE(bookingId) WHERE bookingId IS NOT NULL AND voidedAt IS NULL`** — exactly one **live** leg per booking (a booking is one traversal). Scoped to live legs because a pre-departure substitution voids the old car's leg and writes the replacement's for the *same* booking (§5) — the voided audit row stays.
- **`CHECK ((kind = 'RENTAL') = (bookingId IS NOT NULL))`** — a rental leg always names its booking; a ferry/transfer never does.
- **`UNIQUE(vehicleId) WHERE departedAt IS NOT NULL AND receivedAt IS NULL AND voidedAt IS NULL`** — at most **one in-flight leg per vehicle**; the "at most one, by process invariant" claim becomes a constraint.
- **Timestamp coherence** — `CHECK (receivedAt IS NULL OR (departedAt IS NOT NULL AND receivedAt >= departedAt))` (an arrival needs a departure and never precedes it) and `CHECK (voidedAt IS NULL OR departedAt IS NULL)` (a departed leg can never be voided — it becomes a recovery leg instead).
- **`UNIQUE(id, vehicleId)`** — the target that lets receipts pin their vehicle to their leg's vehicle (§6.2).

### 6.2 The receipt record — immutable evidence

**Why not reuse vehicle photos:** vehicle photos are **public catalog assets**, served from a public bucket (`VEHICLE_PHOTOS_PUBLIC_URL`, `composition/repositories.ts:405`).
A receipt is **legal evidence**, not marketing. It needs distinct properties:

```
handoff_receipts { id, legId (FK → movement_legs), phase (DEPARTURE|ARRIVAL), vehicleId,
                   actorUserId, actorOperatorId, atLocationId, capturedAt,
                   condition (structured: fuel, odometer, damage markers, notes),
                   photoStorageKeys (PRIVATE R2 keys),
                   supersedesReceiptId (NULLABLE — a correction points at the row it replaces),
                   idempotencyKey, createdAt }
```

A leg has two ends: the **`ARRIVAL`** receipt is location-authoritative (it sets the leg's `receivedAt`, §5); a **`DEPARTURE`** receipt captures hand-out condition for damage attribution.

**DB seals** (all of them — otherwise duplicate movements and branching correction "heads" remain possible):
- **`UNIQUE(idempotencyKey)`** — a retried upload never double-writes.
- **One canonical receipt per leg-end** — `UNIQUE(legId, phase) WHERE supersedesReceiptId IS NULL`.
- **`UNIQUE(supersedesReceiptId) WHERE supersedesReceiptId IS NOT NULL`** — a receipt is superseded by at most one correction, so the chain stays linear (no branching heads).
- **A correction stays on the same leg-end** — composite FK `(supersedesReceiptId, legId, phase) → handoff_receipts(id, legId, phase)` (backed by a `UNIQUE(id, legId, phase)`), so a correction can never re-point to a different leg or end.
- **A receipt names its leg's vehicle** — composite FK `(legId, vehicleId) → movement_legs(id, vehicleId)` (backed by §6.1's `UNIQUE(id, vehicleId)`), so evidence can never cite a different car than the traversal it documents.
- **Immutable / append-only, DB-enforced** — a receipt is never edited; a correction is a new row. The repository exposing no update/delete is *not* the enforcement: the table is sealed at the database boundary with the #1556 consent-ledger mechanism (role separation — the app role holds INSERT/SELECT only, no UPDATE/DELETE). The current view is the head of the supersession chain.
- **Private access** — reuse the R2 *infra* but a **private** bucket/prefix (never the public catalog base); served only to the booking's parties + the handling host + platform.
- **Structured condition data**, not just photos — the evidence trail for damage attribution (§13 liability).
- **Photos are mandatory at `ARRIVAL`** — the §6 procedure says *photograph*; the server enforces ≥ 1 evidence photo on every arrival receipt (dev/test use the in-memory storage; an environment without the private bucket cannot run custody, by configuration).

**Replay semantics (normative).** A retried receipt command is resolved by **checking `idempotencyKey` first, inside the per-vehicle lock, before any state precondition** — a full replay returns the prior receipt even though the leg is no longer in flight. The unique seal is the backstop for true races only: a 23505 aborts the enclosing transaction (nothing can be queried after it inside the same tx), so check-first ordering is required, not optional. Photo uploads happen before the transaction (object storage is not transactional); a failed tx may orphan private keys — accepted, invisible, and reaped later if ever needed.

```
Learn: Evidence model vs asset model
A public catalog photo and a legal receipt look alike (both are R2 images) but have opposite requirements: one is public, mutable, SEO-served; the other is private, immutable, access-controlled.
Heuristic: don't route evidence through a public-asset pipeline — evidence needs immutability, private access, an actor, and idempotency of its own.
```

---

## 7. Phase 1 policy: homeward-only leash (§14 Q1)

A car is **displaced** when `physicalLocationId != homeBase` — this includes a **same-operator non-home branch**, not just a foreign host.
The building block is the **active-owner-location set**, formalized against the **real columns** (`locations.status`, `operators.deactivatedAt` — locations carry `status`, *not* `deactivatedAt`):

> `ownerActiveLocations(V) = { L ∈ locations : L.operatorId == V.operatorId ∧ L.status = 'ACTIVE' ∧ owner(V).deactivatedAt IS NULL }`

The permitted drop-offs are **state-dependent** — rev.4 stated one location-set for all cars, which contradicted its own "no onward B→C" rule (the set contained every branch). The v1 policy, exactly (this is the predicate search and checkout share, §11):

> `allowedDropoffs(V, pickupAtP) =`
> — **pickup at home** (`P == homeBase`): `ownerActiveLocations(V)` — the one permitted hop out (a one-way A→B, or the A→A round trip);
> — **pickup displaced** (`P != homeBase`): `{ homeBase(V), P } ∩ ownerActiveLocations(V)` — **return home, or a round trip in place (P→P)**. Nothing else.

(`P` is the *projected* pickup of the window under evaluation, so a chained future booking is leashed by where the car will then be, not where it is now.)
**No onward B→C, ever, in v1** — a displaced car cannot drop at another non-home branch, so drift is impossible: after one hop out, every permitted trip either stays put or lands home. The `P→P` round-trip branch keeps a displaced car earning while it waits for a homeward renter; **if the owner prefers the strictest reading (displaced ⇒ home-only, no P→P), delete that one member — flagged in §14 Q1.**

**Location archival guard.** A location that is any car's **home base**, any car's **current `physicalLocationId`**, or an **endpoint (origin *or* destination) of a pending (not-yet-arrived, not-voided) leg** cannot be archived out from under the fleet: archival is **blocked** (409, mirroring the existing service-level 409 behind `locations_operatorId_active_name_unique`) until those references are moved. Origins matter too: a pending leg departs from its `fromLocation` — archiving it strands a planned pickup. This stops a displaced car's homeward set from emptying mid-flight.
**Enforcement is atomic, not check-then-act:** the archive write is a **single conditional `UPDATE … WHERE NOT EXISTS(each reference class)`** — one statement, one snapshot; zero rows updated ⇒ 409. The reference counts are fetched separately only to word the error. The reverse race (a booking created while an archive commits) is accepted as the same operator-recoverable residual already documented for the block-vs-checkout window, and the checkout-side predicate re-reads `status` inside its own locked transaction.

Consequence: **a car is at most one hop from home at a time, then it returns — no multi-hop drift, bounded inventory.**
Free-roam onward is a later phase behind the *same* model; the leash is one policy function (widen `allowedDropoffs`), not an architecture.

---

## 8. Getting a car home (owner tools)

- **Ferry (B1)** — owner marks "bring it home"; car goes `HELD_OFFLINE`; the owner's own staff drives it back; on receipt at home, normal. No customer, no charge. Mechanics: the ferry leg is **created planned and then departed through the one §5 departure transition** (no leg is ever born departed — one definition of "depart" closes the custody period and flips `IN_TRANSIT`, for rentals and ferries alike). **v1 continuity rule: a ferry may start only when the car has no pending legs** — a future booking's pickup would be stranded by the reposition; substitute or cancel those bookings first (409 `CUSTODY_CONFLICT` otherwise). Scheduling a *future* ferry is out of v1.
- **Promo-home (B2)** — owner lists a **discounted one-way** with drop-off locked per §7 + a cutoff date. Whoever books it repositions the car home cheaply. A promo layer on a normal one-way booking. The promo applies iff the trip **lands the car at its home base by the cutoff** — the comparison is against the booking's *arrival* (`effectiveEndAt <= cutoffAt`), never the booking-creation clock: a promo is "home by the 30th", not "booked by the 30th".
- **Reset home base** — owner re-labels the car's home to where it landed (e.g., opens/uses a branch there). **No physical move** (§4) — it changes pricing / search region only, and fires region reassignment + geocode (§13.5).

---

## 9. Money & settlement (§14 Q2, Q4)

- Renter **always pays the owner's price** (owner rate card + formula). One consistent price wherever the car is picked up — no handover, no re-quote.
- Host earns a **per-day custody fee + handoff service fee**.
- The host fee is **deducted from the owner's payout** — the renter never sees it. Platform takes its usual cut. Owner nets `price − host fee − platform cut`.
- `host == owner` → fee 0 → today's single-operator settlement, unchanged.

The *mechanics* — two ledgers, snapshots, states — are §10.

---

## 10. Two ledgers: custody accrual and multi-party settlement

Custody cost is **not** a running total on the car.
Accrual (what is owed) and payout (who pays whom) are **different facts**, so they are two append-only ledgers.

**Accrual — `custody_periods`** (per stint the host *actually holds* the car):

```
custody_periods { id, vehicleId, ownerOperatorId, hostOperatorId, hostLocationId,
                  receivedAt, departedAt,                        -- [held); departedAt NULL = still held
                  openedByLegId, closedByLegId,                  -- the arrival / departure legs (§6.1)
                  dailyRateJpySnapshot, handoffFeeJpySnapshot,   -- snapshotted at receipt
                  accruedJpy,                                     -- derived at close (§13 day-count/rounding)
                  settlementState (ACCRUING|CLOSED|SETTLED),
                  settlementRef, settledAt }
```

- **A period spans `[receivedAt, departedAt)` — the time the host physically holds the car, not the time it *owns* the timeline.** It **opens on** the arrival leg's receipt and **closes the instant the car departs** on the next leg (rental pickup or ferry start → `IN_TRANSIT`, §5), atomically under the §2.1 lock. Otherwise a host would keep accruing while the **renter or owner-staff** physically holds the car in transit — charging for custody it does not have.
- **One open period per vehicle is a DB seal, not prose** — partial unique index `UNIQUE(vehicleId) WHERE departedAt IS NULL`. A second open row (double-receipt race) is rejected by the constraint, not just avoided by convention.
- The **open** row (`departedAt = NULL`) is the current stint — the car is `AT_STATION` at that host. The transit gap between a close and the next open accrues to **no one**.
- **Snapshot** the daily rate + handoff fee **at receipt**, so a later fee-config change never retro-alters an amount already owed.
- `accruedJpy` is **derived** (`rate × heldDays + handoff`); the day-count basis and JPY (zero-decimal) rounding are an open input (§13.7) — computed **at close**, in Slice 2, not before those are decided.
- `hostIsOwner` (§4) → rate 0 → no accrual. Phase 1: at most **one open foreign row** at a time; the ledger already supports multi-hop for later free-roam.

**Payout — a multi-party settlement record** (Slice 2):

- Today's `payment_events` records the **renter → platform** payment (a *single* payer). It cannot express an **owner → host** transfer, so custody settlement is a **separate debit/credit record**: debit owner, credit host, credit platform — referencing the closed `custody_periods` rows.
- **Custody can accrue with no renter payout.** A stale `HELD_OFFLINE` car (§13.6) is owed to the host even though no rental — and therefore no renter payment — ever happened; the owner eats it. The settlement record must **stand on its own**, not hang off a renter payment.
- Each settlement carries a **state** (`PENDING|PAID|FAILED`) + a **reference**, and reuses the `payment_events` idempotency discipline (unique seals; webhook-truth wherever a gateway moves the money).

```
Learn: Accumulator-on-the-Entity
A running per-day total on the car looks simplest but erases the per-host breakdown and can't be reconciled — and a single-payer payment row can't represent an owner→host transfer.
Heuristic: when a cost accrues from many sources over time, store the events and fold; when money moves between more than two parties, use an explicit debit/credit record — never one mutable total.
```

---

## 11. Affected surfaces / schema implications

- **`vehicles`** — reinterpret `pickupLocationId` as *home base*; add `custodyState` (`AT_STATION|IN_TRANSIT`) + `physicalHostOperatorId` + `physicalLocationId` (§4), with the **composite FK `(physicalHostOperatorId, physicalLocationId) → locations(operatorId, id)`** (may cross operators — a foreign host location is legitimate) and the CHECK invariant tying the discriminant to the nulls. A bare, unconstrained location id is not acceptable — the operator component is what makes the FK real.
- **`operators` / `locations`** — add a **host opt-in** flag (operator opts in to hosting other operators' cars) + custody-fee config (per-day rate, handoff fee). This config is the snapshot source for §10.
- **`bookings` — a cross-operator leg needs a *stronger* relation, not a weaker FK.** A homeward booking straddles operators: pickup = B (a foreign host location), drop-off = an A location, booking owned by the **owner**. The #1521 tenant-seal composite FKs must **not** be relaxed to bare ids — that would admit arbitrary foreign stations. Instead:
  - Persist a **host-operator snapshot** on the pickup (and drop-off) leg, and keep **composite FKs to `locations(operatorId, id)`** for *each* leg's true operator, so every referenced station is a real, identified location.
  - **Validate at create:** the pickup host opted in, and a **planned/authorized custody period** covers the leg.
  - Add a **narrowly-scoped host-receipt capability.** Existing booking reads/writes are **owner-tenant row-scoped** (`booking-authz.md:9`) — a host is *not* the owner tenant and today cannot see the booking at all. The host needs a **receipt-only** capability on cars it physically holds (confirm receipt, write the §6 record, advance custody) — **never** general booking read/write, and never cross-tenant enumeration. Model it like the existing correct-actor gates (booking-authz: "a feeder-read inherits its write's gate"), scoped by **physical custody**, not owner tenancy.
- **`movement_legs` / `custody_periods` / settlement / `handoff_receipts`** — new tables (§6.1, §10, §6.2). `movement_legs` is the shared traversal (§2.1 fold, §10 period boundaries, §6.2 receipt parent), one row per rental/ferry/transfer with departure + arrival facts.
- **`locations`** — no schema change, but **archival is guarded** (§7): a location that is a home base / current `physicalLocationId` / pending-leg endpoint cannot be archived (409) until unreferenced.
- **Search / availability — one locked predicate on *every* renter surface.** The feasibility predicate (§2, folding the §2.1 movement stream and applying `allowedDropoffs` §7) replaces the static `pickupLocationId = X` filter (`availability.ts:78`) and must **compose with the existing conditions**: booking overlap (exclusion constraint), scheduled `vehicle_blocks`, road-legality (shaken/insurance valid *through return*), and operator-deactivation (`availability.ts:49-88`). It must apply on **all** renter surfaces — `/availability`, class-availability, storefront, **and** checkout — not just the map search. Search and checkout share the **one** predicate (no read/write drift — #882's still-valid idea). Concretely, four rules keep the surfaces honest:
  - **Checkout runs the FULL condition set, not just the timeline fold**: the §5 custody conditions on the car's *current* state (owner `AVAILABLE`, `custodyState != IN_TRANSIT`, not `HELD_OFFLINE`) **plus** the window predicate. An `IN_TRANSIT` car takes **no** new bookings — even for windows after its projected arrival — because Q3 requires the receipt to exist first. An `AT_STATION` car *may* be booked at a **projected** future pickup (the retained #882 continuity, §2 item 2); search advertises exactly the same, so neither surface drifts.
  - **A SQL prefilter cannot express the fold — widen, then post-filter.** The location prefilter admits a car whose *current* `physicalLocationId` **or** a pending leg's destination matches the requested location; the shared pure predicate then applies the **exact** projection per candidate. Narrow-prefilter-plus-exact-post-filter — never a prefilter that silently drops the continuity case (a car at B whose pending B→A leg settles before the window must match a search at A, and must NOT match one at B).
  - **Every renter-facing *display* of a station uses the physical/projected location, never the home base.** The flat-search SPECIFIC mapping and storefront card grouping currently key off `pickupLocationId` (`flat-search.ts:181`, `storefront-search.ts:157`) — under custody that shows a displaced car at the wrong station. Home base remains pricing/search-*region* input only.
  - **Displaced cars and the class capacity gate.** A displaced car belongs to **no** combo pool (below), so the class `demand >= capacity` gate (`booking-creation.ts:435`) **does not apply** to a SPECIFIC booking of a displaced car — otherwise its capacity is 0 by construction and every displaced booking is rejected. Its guards are the per-car exclusion constraint plus the pending-leg overlap (R1). At-home SPECIFIC bookings keep the gate unchanged.
  - **`CLASS_COMBO` for displaced cars is explicitly deferred.** A car is **displaced** whenever `physicalLocationId != homeBase` — this is *not* only cross-operator: a **same-operator car parked at a non-home branch is displaced too**, and must also drop out of the combo pool. Class-combo counts *unassigned* inventory by owner/location/class; a displaced car has no settled answer for which physical-inventory pool + price it joins. **Phase 1: displaced cars do not participate in `CLASS_COMBO`** — they are bookable only as `SPECIFIC` vehicles. Designing combo for displaced inventory is a later slice (§13.9).
- **Booking lifecycle** — `CONFIRMED → ACTIVE → COMPLETED` drives `IN_TRANSIT`; `COMPLETED` + the receipt gate drives the host change (now via the explicit state model §5).

---

## 12. Build order (each a vertical, shippable slice)

- **Slice 0 — pure core.** Custody state machine (§4/§5) **+ the timeline-feasibility predicate (`locationAt` over the §2.1 movement stream + `allowedDropoffs` §7 continuity)**. Pure, exhaustively unit-tested (FC/IS). **No cost fold** — its day-count + rounding inputs are open (§13.7), so it moves to Slice 2 with settlement rather than being written against undecided rules. **The P0 predicate lives here — it is not optional.**
- **Slice 1 — same-operator homeward.** Home base + `custodyState`/`physicalHostOperatorId`/`physicalLocationId` + `movement_legs` (§6.1) + receipt gate + immutable receipt record (§6.2) + **custody-period open/close lifecycle at rate 0** (§10 — exercises the close-on-departure path with no money) + **cancellation recovery** (pre-start void vs active-cancel recovery leg, §5) + location archival guard (§7) + ferry (B1) + promo-home (B2). Search **and checkout** move to the shared predicate. **No cross-company money.**
- **Slice 2 — cross-operator.** Host opt-in, the stronger booking-leg relation + host-receipt capability (§11), **the cost fold + non-zero rates + multi-party settlement** (§10) — the slice where day-count/rounding (§13.7) is decided. Behind a flag.
- **Later — free-roam onward + `CLASS_COMBO` for displaced cars.** Flip the leash (widen `allowedDropoffs`); design the combo physical-inventory/price model. The ledger and model already support the rest.

Slices 0–1 deliver real value with zero cross-company money (custody periods exist but accrue nothing).
Slice 2 is the multi-party custody + settlement network and should be gated behind a flag.

### 12.1 Flag + kill-switch semantics (rev.5)

Slice 1 itself ships dark behind **one runtime flag, `ONE_WAY_CUSTODY`** (repo dark-ship convention; rev.4 only flagged Slice 2). "Dark" and "killed" are defined precisely — a flag that gates *behavior* must not gate *facts*:

- **Flag OFF stops new movement:** no legs are created, the renter wizard shows no drop-off picker, the homeward-dropoffs read is 404, and the **ferry / promo-home mutations are server-side 404-gated** (not merely hidden in the UI).
- **State-driven operations ignore the flag:** the **arrival receipt** (whenever an in-flight leg exists) and the **listing-hold toggle** stay available. A kill-switch that strands `IN_TRANSIT` cars — receivable by no one — is not a kill-switch; recovery is driven by the state that exists, not by the feature that created it.
- **Facts are always honored:** search reads the custody columns unconditionally. An `IN_TRANSIT` or `HELD_OFFLINE` car stays unlistable even while dark — the alternative advertises phantom cars. While the flag has never been ON this is byte-identical to today (backfill: `physicalLocationId ≡ pickupLocationId`, no legs exist).
- **The OFF booking path is kill-safe, not merely legacy:** besides today's `pickupLocationId` equality it requires the car custody-listable and **at home** (`physicalLocationId == pickupLocationId` when tracked). Equivalent while never-flipped (the backfill makes them equal); after a kill-switch, displaced cars are simply unbookable until received/ferried home rather than bookable at a station they are not at.
- **Flip runbook (both directions):** the movement-leg backfill script (idempotent, print-first) synthesizes legs for pre-flag `CONFIRMED`/`ACTIVE` bookings, **and synthesizes departed recovery legs (kind `TRANSFER`) for cars whose dark-era `COMPLETED` one-way left them physically away from their materialized location** — staff then receive those cars through the normal §6 receipt flow (evidence intact; no silent teleport). Because bookings created between a script run and the flip get no legs, the script runs **immediately before the flip and again immediately after** — the second run closes the race window.

---

## 13. Open questions

1. **Cross-operator liability** — if the receipt inspection finds damage, was it the previous renter's leg or in-custody? The receipt record (§6) is the evidence; the *policy* is a business decision.
2. **Settlement cadence** — pay the host per handoff (on close) or a periodic sweep of closed rows? (Lean: per-handoff.)
3. **Host fee model** — flat per-day, or per-day + fixed handoff? Who sets it — host, with a platform floor/cap?
4. **Insurance on a homeward re-rental from a foreign host** — whose policy covers the leg? (Likely the owner's, since owner-priced — confirm.)
5. **Reset-home-base side effects** — changing home changes the car's search region; ensure region reassignment + geocode fire (and, per §4/§8, that it does *not* move `physicalLocationId`).
6. **Stale car** — if no one ferries or books a homeward promo before the cutoff, the car stays `HELD_OFFLINE` and custody accrues (owed to the host, §10). Surface the drift + cost to the owner; no system-enforced deadline in v1.
7. **Settlement rounding + day-count** — calendar-days vs 24h periods, JPY (zero-decimal) rounding. The ledger *structure* is fixed (§10); the numbers are a business call.
8. **Host-receipt capability shape** — the exact role/scope for a host acting on a foreign car's booking (§11). Confirm it never widens into owner-tenant read.
9. **`CLASS_COMBO` for hosted cars** — confirm the phase-1 deferral (§11) and design the combo inventory/price model for hosted cars in a later slice.

---

## 14. Owner (kaku) decisions — record

- **Q1 — Roam vs homeward.** Phase 1 is **homeward-only**: a car that has left A may only be rented back toward A's locations. Prevents runaway drift / inventory loss. (Note rev.5: formalized *state-dependently* in §7 — from home, any active owner branch is the one permitted hop; once displaced at P, only `{home, P}` (return, or a round trip in place). **Owner to confirm the `P→P` round-trip-in-place branch** — it keeps displaced cars earning and cannot drift; the stricter home-only alternative deletes one set member.)
- **Q2 — Pricing.** Always the **owner's** rate card + formula. The host only adds custody + handoff fees.
- **Q3 — In-transit booking.** A car in transit **cannot** be pre-booked. It must be physically received, confirmed, photographed, and condition-checked before it appears in search. (Note post-review: Q3 gates the *first foreign listing*; future-window feasibility still needs the §2 predicate.)
- **Q4 — Fee incidence.** The host's custody fee is **deducted from the owner's payout**; the renter sees only the owner's price.

A possible **Q5 (settlement cadence)** and a fee-model confirmation are pending — see §13.2, §13.3, §13.7.

---

## 15. Out of scope (v1)

- Free-roam onward (B→C→D) — later phase.
- `CLASS_COMBO` participation for hosted cars — later slice (§11 / §13.9).
- Automated fleet rebalancing / route optimization.
- Cross-operator liability/insurance *settlement* beyond capturing the evidence record.
- Advance booking of a car at a host before it physically arrives (explicitly forbidden by Q3).

---

## 16. Why this approach

- **Owner/Host separation** — one split unifies same-operator and cross-operator; `host == owner` degrades cleanly to today.
- **Present-tense location is a valid *fact and first-listing gate* — not a feasibility oracle.** Because Q3 forbids listing a car before it arrives, the materialized location safely answers *whether to list at all*; the **restored** timeline predicate answers *which future windows are feasible*. Two questions, two mechanisms (§2).
- **Explicit physical state, everything else derived** — a `AT_STATION|IN_TRANSIT` discriminant + a `(host operator, location)` pair (null together only in transit, held consistent by a CHECK); *home* and *host-is-owner* are **derived** from location and operator, never encoded into the state enum (§4).
- **One movement stream** — actual receipt/ferry baseline + planned booking legs, folded together under one per-vehicle lock; a booking-only fold would blind the timeline to non-booking moves (§2.1).
- **Custody tracks possession, not ownership of the timeline** — a period spans only `[receivedAt, departedAt)` and closes the instant the car leaves the host, so nobody is charged for custody they don't have (§10).
- **Two ledgers** — accrual folded from events, payout as an explicit multi-party debit/credit; never a mutable total, never a single-payer row forced to carry a transfer (§10).
- **Evidence at the boundary** — the receipt is a private, immutable record of its own, not a public catalog photo (§6).
- **Policy as a dial** — homeward-only vs free-roam is one flag; the data model, core, and shell don't change.
- **Read/write parity** — search and checkout share the one feasibility predicate, so search never advertises a car checkout would reject.
