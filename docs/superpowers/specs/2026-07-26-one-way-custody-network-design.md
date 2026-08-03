# One-way custody network — design

> **Status:** DRAFT for review · rev.10.1 (P→P per-vehicle opt-in + Q1 provenance correction; round-10 review folded) · **Date:** 2026-08-03
> **Supersedes:** `docs/plans/2026-06-21-one-way-rentals-design.md` (#882).
> Review history lives in git and Appendix A — this document states the current design only.

---

## 1. What we're building

One-way rentals where a car picked up at location **A** can be dropped at a *different* location — a branch of the **same** operator, or a **different** operator's station that opted in to host cars.
The dropped car is **received and confirmed**, then either held for return home, re-rented on a homeward trip, or (in a later phase) rented onward.

Everywhere the car goes, **the owner sets the price**; **whoever holds it earns a custody fee**.
That one separation is the whole design.

---

## 2. Core model: separate OWNER from HOST

- **Owner** — the operator that owns the car. Sets price + formula, earns the rental. (= existing `vehicles.operatorId`.)
- **Host** — whoever physically holds the car right now. Earns a per-day custody + handoff fee. **When host == owner, the fee is 0.**

This single split unifies every behavior — same-operator branch return, cross-operator handoff, homeward re-rental, staff reposition, promo-home.
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
| **Custody state** | `NULL` \| `AT_STATION` \| `IN_TRANSIT`. `NULL` = **custody-untracked** (§13 bootstrap — the car has no home base and behaves exactly as today). `AT_STATION` = physically parked at some operator's location. `IN_TRANSIT` = on the road (rental or staff reposition). | new `vehicles.custodyState` |
| **Current host** | The operator physically holding the car (= the operator of `physicalLocationId`). Non-null iff `AT_STATION`. | new `vehicles.physicalHostOperatorId` |
| **Physical location** | The location the car was last *received* at. Non-null iff `AT_STATION`. Written only on a confirmed receipt (§6). | new `vehicles.physicalLocationId` — **composite FK `(physicalHostOperatorId, physicalLocationId) → locations(operatorId, id)`** (may cross operators) |
| **In-flight leg** | The one leg currently moving the car. Non-null iff `IN_TRANSIT`. | new `vehicles.inFlightLegId` — **composite FK `(inFlightLegId, id) → movement_legs(id, vehicleId)`** so the referenced leg is the car's own |
| **Open custody period** | The current custody stint. Non-null iff `AT_STATION`. | new `vehicles.openCustodyPeriodId` — **composite FK `(openCustodyPeriodId, id, physicalHostOperatorId, physicalLocationId) → custody_periods(id, vehicleId, hostOperatorId, hostLocationId)`** so the open period always matches the car's host and location |
| **Listing hold** | Received but deliberately not listed (reposition queued, promo-home, maintenance, awaiting owner relist). | new `vehicles.heldOffline` boolean NOT NULL default false |
| **Relist policy** | On receipt: relist immediately, or wait for the owner. | new `vehicles.autoRelistOnReceipt` boolean NOT NULL default false (default = wait for owner) |
| **Round trips while away** | May this car be rented on round trips from wherever it is parked while displaced? (§7). Default: no — a displaced car is home-only. A plain policy flag with no lifecycle coupling — no CHECK, no FK, no trigger. | new `vehicles.allowRoundTripsWhileAway` boolean NOT NULL default false |

**The three-way CHECK (DB seal).** Exactly one of:

- `custodyState IS NULL` — every custody column null (untracked);
- `custodyState = 'IN_TRANSIT'` — host/location/period null, `inFlightLegId` **not** null;
- `custodyState = 'AT_STATION'` — host/location/period **not** null, `inFlightLegId` null.

The two composite FKs above prove the referenced leg/period **belongs to this car** — not that it is in the right lifecycle state (an FK is equally satisfied by a received leg or a closed period).
Two **deferred constraint triggers** complete the seal at commit time, checked from **both directions**: an `IN_TRANSIT` car's `inFlightLegId` must reference a leg that is departed, unreceived, and unvoided (and any leg update that ends its in-flight state — setting `receivedAt`/`voidedAt` **or clearing `departedAt`** — fails while a vehicle still references it); an `AT_STATION` car's `openCustodyPeriodId` must reference a period with `departedAt` null (and closing a period fails while a vehicle still references it as open).
**Trigger functions re-read the current row(s) by id — never trust `NEW`/`OLD` alone.** A deferred trigger's captured row is a snapshot from event time: an insert-untracked-then-place transaction queues an event whose `NEW` is the pre-placement row, and a check written against it fails a perfectly legal sequence. Every custody trigger therefore evaluates the FINAL committed state (`SELECT ... WHERE id = NEW.id`), and fires on every lifecycle column, not a hand-picked subset.
Only with CHECK + FKs + lifecycle triggers together are these invariants constraints, not process discipline — each layer is raw-SQL-tested (a plausible bad write must fail at commit).

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

Every physical traversal — a rental, a staff reposition, an administrative transfer — is **one row** in **`movement_legs`**, with a durable `id` and **both** a departure and an arrival fact:

```
movement_legs { id, vehicleId,
                kind (RENTAL | STAFF_REPOSITION — internal staff drive, §9 | TRANSFER — synthesized/administrative, §14.1),
                bookingId (NULLABLE — set for RENTAL, null otherwise),
                fromOperatorId, fromLocationId, toOperatorId, toLocationId,
                plannedStartAt, plannedEndAt,
                departedAt (NULL until departure), receivedAt (NULL until arrival receipt),
                voidedAt (NULL — set only by a pre-departure cancel/substitution),
                checklistSnapshot (JSONB — evidence items required at arrival, copied from owner config at departure, §6),
                idempotencyKey, requestFingerprint, createdAt }
```

A leg is **born `PLANNED`** (`departedAt` null). `departedAt` is set **only** by the single departure transition (§5), and `receivedAt` only by the single receipt transition (§6) — each flipped exactly once.
Operations that need a leg already moving (ACTIVE substitution/assignment, §5) **compose create-planned + depart in one transaction**; the transition is still the only writer of `departedAt`.
A **voided** leg stays as an audit row but drops out of every fold and every constraint scope below.

This one stream is folded by feasibility (§8), bounds custody periods (§11), and parents receipts (§6) — one concept, three consumers.

**DB seals:**

- `UNIQUE(idempotencyKey)` — a retried create never duplicates a movement. **A key names one COMMAND.** Booking-create legs use `booking:<bookingId>` (one create per booking). Substitution and class-assignment legs carry a **client-supplied idempotency key** bound to a request fingerprint (booking, target vehicle, window) — replay returns the original outcome as a no-op. This solves both failure shapes at once: repeated swaps (X→Y→X→Y) are distinct commands with distinct keys, so nothing jams on a voided leg's key; and a **delayed duplicate** of an old swap (X→Y arriving again after Y→X already ran) hits its original key, replays, and never re-executes — a server-derived key (static or generation-counted) can distinguish only one of the two.
- **`UNIQUE(bookingId, vehicleId) WHERE bookingId IS NOT NULL AND voidedAt IS NULL`** — uniqueness follows **traversal identity**: at most one live leg per (booking, car). A booking that swaps cars mid-trip legitimately owns **two** live legs — the old car's detached recovery leg and the new car's current leg (§5). The booking's **current leg** is the live leg whose `vehicleId` equals the booking's current vehicle; the recovery leg keeps `bookingId` for audit but is excluded from every "the booking's leg" read by the vehicle mismatch.
- `CHECK ((kind = 'RENTAL') = (bookingId IS NOT NULL))` — a rental leg always names its booking; a reposition/transfer never does.
- `UNIQUE(vehicleId) WHERE departedAt IS NOT NULL AND receivedAt IS NULL AND voidedAt IS NULL` — at most **one in-flight leg per vehicle**.
- Timestamp coherence — `CHECK (receivedAt IS NULL OR (departedAt IS NOT NULL AND receivedAt >= departedAt))` and `CHECK (voidedAt IS NULL OR departedAt IS NULL)` (a departed leg is never voided — it becomes a recovery leg).
- `UNIQUE(id, vehicleId)` — the composite-FK target that lets receipts (§6) and `vehicles.inFlightLegId` (§3) pin their leg to its vehicle.

**One lock guards the whole stream.** Every timeline mutation — booking create/cancel/substitution/class-assignment, leg departure, arrival receipt — takes the same per-vehicle advisory xact-lock, with ONE canonical key formula everywhere (API and scripts alike): `pg_advisory_xact_lock(hashtextextended('vehicle-timeline:' || vehicleId, 0))`.
**Lock first, read second.** Any vehicle/leg/booking state a custody-bearing write depends on is (re-)read INSIDE the transaction, after the lock — never carried in from before it. A pre-lock read is at most a cheap pre-gate; the locked re-read is the authoritative one (checkout's anchor/presence checks, substitution/assignment feasibility, vehicle placement/sync all follow this).
Two-vehicle operations (substitution) take both locks in ascending `vehicleId` order; where the class-capacity combo lock is also held, the order is combo lock first, then vehicle lock(s).
**Every write that newly references a location reads that `locations` row `FOR SHARE` (and re-checks it ACTIVE) inside the same transaction** — booking/leg creation (both endpoints), vehicle placement and home re-label, the dark-mode home sync, the arrival receipt's receiving location, and a recovery re-target. Location archival (§7) serializes against all of them — the reference-vs-archive race is closed in both directions, not accepted.

```
Learn: Movement Event Identity
One physical traversal needs one durable identity with distinct departure and arrival facts.
Heuristic: uniqueness must follow traversal identity — a booking that swaps cars is one contract over two traversals, so scope "one live leg" per (booking, vehicle), not per booking.
```

---

## 5. Custody transitions (all under the §4 lock)

- **Departure** — the one transition that starts any leg (rental pickup, staff-reposition/transfer start). Preconditions: leg `PLANNED` (not voided), car `AT_STATION`, leg's `from` == car's physical location. Effects, atomically: set `departedAt`; **snapshot the owner's receipt checklist onto the leg** (`checklistSnapshot`, §6); car → `IN_TRANSIT` (host/location null, `inFlightLegId` := leg); close the open custody period (§11) and clear `openCustodyPeriodId`. For `STAFF_REPOSITION`/`TRANSFER` legs the **minimal `DEPARTURE` confirmation is written in the same transaction — mandatory** (§6). For `RENTAL` legs departure evidence is optional in v1 (the existing pickup-verification flow).
  **The transition is validate-first and all-or-nothing:** the custody precondition is checked before any write, and every constituent write (leg flip, period close, vehicle transition) must succeed or the whole transaction aborts — a booking can never turn `ACTIVE` while its car silently stays `AT_STATION`. Sole idempotent exception: a car already `IN_TRANSIT` **on this same leg** is a completed retry and no-ops.
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

## 6. The receipt gate — minimal mandatory core, configurable checklist

The procedure a host completes before a car reappears:

> **receive → confirm booking/identity → complete the snapshotted checklist**

On completion it (a) advances custody state + physical location (§5), (b) closes/opens the custody period (§11), and (c) writes an **immutable receipt record** — a model of its own, **not** the catalog-photo pipeline (vehicle photos are public catalog assets; a receipt is evidence).

**The mandatory core of every receipt is exactly: vehicle, location, receiver, time** — the NOT NULL columns of the row itself (`vehicleId`, `atOperatorId`/`atLocationId`, `actorUserId`, `capturedAt`). Nothing more is universally required.
**Everything else — photos, condition inspection, fuel, odometer — is checklist-driven:** the owner configures a receipt checklist (per-operator config, §12); the §5 departure transition **snapshots it onto the leg** (`checklistSnapshot`), so a config change mid-flight never alters what the receiver on the road must provide. The service enforces the leg's snapshot at receipt time (400 on missing items). There is **no unconditional DB photo CHECK** — the DB cannot express a config-dependent requirement; it seals the core and the structure. The private photo bucket is required only where the config enables photo items — and **enabling `PHOTOS` in a checklist is rejected while the environment has no receipt storage configured**: an owner can never create an obligation the receiver cannot satisfy.
The platform default checklist is a business call (§16.8); v1 ships with the minimal core only.

```
handoff_receipts { id, legId (FK → movement_legs), phase (DEPARTURE|ARRIVAL), vehicleId,
                   actorUserId, atOperatorId, atLocationId, capturedAt,
                   condition (structured, NULLABLE: fuel, odometer, damage markers, notes — per checklist),
                   photoStorageKeys (PRIVATE R2 keys; may be empty — per checklist),
                   supersedesReceiptId (NULLABLE — a correction points at the row it replaces),
                   idempotencyKey, requestFingerprint, createdAt }
```

**DB seals:**

- `UNIQUE(idempotencyKey)` — a retried upload never double-writes.
- One canonical receipt per leg-end — `UNIQUE(legId, phase) WHERE supersedesReceiptId IS NULL`.
- `UNIQUE(supersedesReceiptId) WHERE supersedesReceiptId IS NOT NULL` — the correction chain stays linear; `CHECK (supersedesReceiptId <> id)` — a receipt can never supersede itself.
- A correction stays on the same leg-end — composite FK `(supersedesReceiptId, legId, phase) → handoff_receipts(id, legId, phase)` (backed by `UNIQUE(id, legId, phase)`).
- A receipt names its leg's vehicle — composite FK `(legId, vehicleId) → movement_legs(id, vehicleId)`.
- **The receipt's location is real and correctly attributed** — composite FK `(atOperatorId, atLocationId) → locations(operatorId, id)`.
- **The receipt matches its leg's endpoint** — a deferred constraint trigger asserts `ARRIVAL.atLocationId == leg.toLocationId` and `DEPARTURE.atLocationId == leg.fromLocationId`. A recovery re-target updates the leg's `to*` in the same transaction first, so the trigger always sees a consistent pair. **The guard is bidirectional:** an `UPDATE` of a leg's endpoint pair likewise fails when a receipt already pinned to that leg-end would no longer match — a later re-target can never silently orphan recorded evidence.
- **Immutable / append-only, DB-enforced** — the #1556 consent-ledger mechanism (role separation: the app role holds INSERT/SELECT only, no UPDATE/DELETE). A correction is a new row; the current view is the head of the supersession chain.
- **Private access** — a private R2 bucket/prefix (never the public catalog base); served only to the booking's parties + the handling host + platform.

**Replay semantics (normative).** A retried receipt command is resolved by **checking `idempotencyKey` first, inside the per-vehicle lock, before any state precondition**, and comparing the stored `requestFingerprint` — a hash of the canonical payload **plus the command's identity (`vehicleId`, `legId`, `phase`) and the sorted SHA-256 content hash of every photo**. Payload alone is not enough: two minimal-core receipts at the same location have identical payloads, so a reused key would replay *another car's* receipt; and a photo *count* would let a reused key return evidence for different images — different pictures are a different claim. (On a retry the in-flight leg may already be settled, so the comparison recomputes the fingerprint using the **stored receipt's** `legId` with the **request's** `vehicleId` — a cross-vehicle reuse mismatches and 409s.)

- same key, same fingerprint → return the prior receipt (idempotent replay, even though the leg is no longer in flight);
- same key, **different** fingerprint → `409 IDEMPOTENCY_MISMATCH` — a reused key never silently returns evidence for a different claim.

The unique seal is the backstop for true races only (a 23505 aborts the transaction, so check-first ordering is required, not optional).
**Preflight before upload — ALL deterministic checks:** authorization (tenant-bound vehicle), replay resolution, the in-flight-leg check, the booking-ordering gate (terminal status), the no-re-target rule, the receiving-location check, and the checklist-completeness gate all run **before** any photo bytes touch storage — an unauthorized, replayed, premature, mis-targeted, or incomplete command writes nothing (a receiver who forgot the odometer must not orphan a photo set per retry). Uploads then happen before the transaction (R2 is not transactional); the locked transaction re-validates everything, so orphaned private keys arise only from a true race or crash — accepted, invisible, reaped later if ever needed.

```
Learn: Evidence model vs asset model
A public catalog photo and a legal receipt look alike (both are R2 images) but have opposite requirements.
Heuristic: seal the invariant core (who/where/when, immutability, idempotency) in the DB; enforce the configurable evidence surface in the service against a snapshot taken when the obligation was created.
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
> — **displaced at P**: `({homeBase(V)} ∩ ownerActiveLocations(V)) ∪ (allowRoundTripsWhileAway(V) ? ({P} ∩ activeReceivingLocations(V)) : ∅)` — **return home, or — only if this car's round-trips-while-away toggle (§3) is on — a round trip in place (P→P)**, each only while that station remains active and authorized. Nothing else.

**No onward B→C, ever, in v1** — after one hop out, every permitted trip either stays put or lands home, so drift is impossible.
The `P→P` member is a **per-vehicle opt-in, default OFF** (`vehicles.allowRoundTripsWhileAway`, §3 — decided 2026-08-03, §15 Q1).
Off, a displaced car is **home-only** — it earns nothing until a homeward renter appears; on, it keeps earning where it sits and still cannot drift, since the only permitted moves remain stay-put or go-home.
The at-home branch is untouched by the toggle.
**The toggle is evaluated when a leg is created** — at booking-create, and at substitution/class-assignment against the **replacement/assigned car's** fresh row (it rides rule 5's leash like every per-vehicle condition, §8) — and **never re-evaluated against existing legs**: a round trip booked while on runs to completion (departs, receives) after the toggle is turned off, exactly as §14.1 defines for the runtime flag.
**If the resulting displaced set is empty** (home base unavailable and the toggle off), the car is bookable nowhere despite being parked at `P` — an accepted, owner-recoverable state (assign/re-label an active home base, then rent homeward or reposition, §9), the same surface-drift stance as §16.6's stale car.
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
  6. tail       — if D ≠ P: no live leg starts at/after E
                  (a one-way must be the schedule's TAIL, or the successor's
                   pickup at P would be stranded — ONEWAY_NOT_TAIL; round trips exempt)
```

*Live* = not voided, not yet received. Rule 3's benign case is an earlier `P→P` round trip (permitted at home always, while displaced only under the §7 opt-in — either way it lands back at `P`, so it never excludes); its blocking case is a pending one-way, which makes the car temporarily unbookable everywhere until its arrival receipt reopens it at the new station.
Rule 6 is rule 3's **create-side completion**, not a new product policy: rule 3 promises every accepted booking's anchor stays valid, which holds only if no later create may relocate the car out from under an existing leg. The same fold (rules 3–4 + 6) is what the cutover script validates before synthesizing legs (§14.1).

Consequences, stated explicitly:

- **Advance chaining at a destination does not exist in v1.** A car with a pending A→B booking cannot be pre-booked at B for a later window — B lists it only after the receipt (this supersedes #882's promotion half; the fold survives only as rules 3–4).
- **The SQL prefilter is the anchor, not the fold:** `physicalLocationId = P AND custodyState = 'AT_STATION' AND NOT heldOffline` plus the existing filters; the pure predicate then applies rules 3–5 per candidate. The prefilter never admits a pending destination.
- **Checkout runs the full predicate again inside its locked transaction** (§4 lock), so search never advertises what checkout would reject, and no receipt can slip between read and commit.
- **Every renter-facing display of a station uses `physicalLocationId`** — never the home base (`flat-search.ts:181`, `storefront-search.ts:157` currently key off `pickupLocationId` and must move). Home base remains a pricing / search-region input only.
- **Displaced cars skip the class capacity gate.** A displaced car belongs to no combo pool, so the class `demand >= capacity` gate (`booking-creation.ts:435`) does not apply to a SPECIFIC booking of a displaced car — its guards are the exclusion constraint plus rules 3–4. At-home SPECIFIC bookings keep the gate unchanged.
- **`CLASS_COMBO` for displaced cars is out of v1 — owner-decided (§15 Q6).** A displaced car (same-operator branch included) drops out of the combo pool and is bookable only as `SPECIFIC` — including its homeward and (when opted in, §7) `P→P` trips, which may still carry promo-home pricing (§9). Combo for displaced inventory needs its own pool/price design and is deferred until product-critical.

```
Learn: Projection vs evidence
A projection predicts feasibility; it cannot substitute for required physical evidence.
Heuristic: use schedule projections to EXCLUDE what will not be true; require the physical receipt to PROMOTE what has become true.
```

---

## 9. Getting a car home (owner tools)

- **Staff reposition** — owner marks "bring it home"; car goes `heldOffline`; the owner's staff drive it back; on receipt at home, normal. **This is an internal fleet operation, not a product** — no renter surface ever shows it; there is no "ferry" feature or naming anywhere in UI or API paths. Mechanically it is a `STAFF_REPOSITION` leg: created `PLANNED`, departed through the §5 transition (mandatory minimal `DEPARTURE` confirmation — who drove it out, from where, when), received through the normal §6 gate.
  **The destination is always the car's current home base — there is no destination choice.** "Bring it home" is the whole v1 scope; because every reposition is homeward recovery, it is **never flag-gated** (§14.1). A deliberate outward move is two explicit owner steps: re-label the home base (below), then reposition home. `TRANSFER` legs are reserved for administrative/synthesized recovery (§14.1) — never an operator-facing movement command.
  **v1 continuity rule:** a reposition may start only when the car has no live legs — a future booking's pickup would be stranded (409 `CUSTODY_CONFLICT`; substitute or cancel those bookings first). Scheduling a future reposition is out of v1.
- **Promo-home** — owner lists a **discounted one-way** with drop-off locked per §7 + a cutoff date. The promo applies iff the trip **lands the car at its home base by the cutoff** — compared against the booking's *arrival* (`effectiveEndAt <= cutoffAt`), never the booking-creation clock.
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

- A period spans `[receivedAt, departedAt)` — the time the host physically holds the car. It opens on the arrival receipt and **closes the instant the car departs** (§5), atomically under the §4 lock — no host accrues while a renter or repositioning staff holds the car.
- **One open period per vehicle** — partial unique `UNIQUE(vehicleId) WHERE departedAt IS NULL`, plus `UNIQUE(id, vehicleId, hostOperatorId, hostLocationId)` as the §3 composite-FK target tying the open period to the car's current host/location.
- **Provenance is DB-sealed:** composite FK `(ownerOperatorId, vehicleId) → vehicles(operatorId, id)` — a period's recorded owner is the car's actual owner, never free text; composite FKs `(openedByLegId, vehicleId)` and `(closedByLegId, vehicleId) → movement_legs(id, vehicleId)` — the legs that bound a period are that same car's legs (NULL leg refs — baseline/administrative — pass by MATCH SIMPLE).
- **Snapshot** the daily rate + handoff fee at receipt; a later config change never retro-alters an amount owed.
- `accruedJpy` is derived at close (`rate × heldDays + handoff`) — day-count basis and JPY rounding are Slice 2 decisions (§16.7).
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

- **`vehicles`** — the §3 columns, three-way CHECK, composite FKs (`physical*` → locations; `inFlightLegId` → its own leg; `openCustodyPeriodId` → its own matching period), the §3 lifecycle triggers, and the §13 home-base⇒tracked trigger (contract migration, post-deploy). The per-car round-trips-while-away toggle (§3/§7) is set from the owner's fleet listing controls, alongside `heldOffline`/`autoRelistOnReceipt`.
- **`operators`** — **receipt-checklist config** (owner-level, §6 — Slice 1, default minimal core only) + host opt-in flag & custody-fee config (Slice 2; the §11 snapshot source).
- **`bookings`** — cross-operator legs keep the #1521 composite-FK discipline: persist host-operator snapshots per leg end with composite FKs to `locations(operatorId, id)`; never relax to bare ids. Host access is the §5.1 leg-derived capability — never owner-tenant read.
- **`movement_legs` / `custody_periods` / `handoff_receipts` / settlement** — new tables (§4, §11, §6).
- **`locations`** — no schema change; archival guarded (§7).
- **Search / availability / checkout** — the §8 predicate everywhere; display via `physicalLocationId`; displaced cars skip the capacity gate; displaced `CLASS_COMBO` out of v1 (§15 Q6).
- **Booking lifecycle** — `CONFIRMED → ACTIVE → COMPLETED` drives departure; terminal status + receipt drives arrival (§5).

---

## 13. Bootstrap, migration, and the untracked on-ramp

`vehicles.pickupLocationId` is **nullable today** (`fleet.ts:105`) — a blanket "backfill `physicalLocationId := pickupLocationId`" cannot satisfy the §3 CHECK for every row. The migration is therefore explicit:

- **Columns are added additively** (all nullable or defaulted; no flag flip in the migration). The §7 `allowRoundTripsWhileAway` toggle rides in this same additive set — its `false` default reproduces current intent for every existing row, so it needs no backfill and no separate migration.
- **Backfill** (same migration, idempotent): vehicles **with** a home base → `AT_STATION`, host = owner, location = home base, plus a **baseline custody period** (owner-host, rate 0, `receivedAt` = migration time, `openedByLegId` NULL — the only rows permitted null). Vehicles **without** a home base → `custodyState` NULL (**untracked**).
- **Untracked cars behave exactly as today**: no custody gating, no one-way participation, invisible to location search (they have no location). **Assigning a home base is the tracking on-ramp** — it initializes `AT_STATION` at home + a baseline period, **in the same transaction as the write that assigns the home base** (vehicle create included — never a follow-up write).
- **A car with a home base is never untracked — DB-sealed, deploy-safely.** A deferred constraint trigger asserts `pickupLocationId IS NOT NULL ⇒ custodyState IS NOT NULL` at commit (re-reading the final row per §3 — an insert-untracked-then-place transaction must pass). Without it, any insert path that skips placement mints a car search would list (it has a location) but checkout must reject (rule 2's anchor is null) — breaking §8's search/checkout parity. **Expand–contract:** the deploy pipeline migrates BEFORE deploying code, so this trigger cannot ship with the feature migration — old Workers still create home-based untracked cars in the migrate→deploy window (and on rollback). The feature PR ships additive schema + backfill + atomically-placing code; the trigger lands in a **separate follow-up migration PR merged only after the placing code is deployed and stable**.
- **Seeds place their own vehicles.** Seed scripts run after migration, so the backfill cannot cover them. The real inserts live in `packages/shared/src/db/seed.ts` (`scripts/seed.ts` is only the CLI wrapper) and run on **neon-http, which cannot open transactions** — and Postgres CTE snapshot rules forbid insert-and-update-the-same-row in one statement. The shape is therefore two-step per vehicle: insert **untracked, without a home base**, then ONE data-modifying-CTE statement that inserts the baseline period and sets home + `AT_STATION` + the physical pair together (a single statement is a single implicit transaction — trigger-safe under autocommit).
- **No movement legs exist at bootstrap**; the first leg is created by the first post-flip booking/reposition (or by the flip script below for in-flight dark-era bookings).

---

## 14. Build order (each a vertical, shippable slice)

- **Slice 0 — pure core.** Custody state machine (§3/§5) + the §8 feasibility predicate + `allowedDropoffs` (§7). Pure, exhaustively unit-tested (FC/IS). No cost fold (its inputs are open, §16.7).
- **Slice 1 — same-operator homeward.** §3 columns + bootstrap (§13) + `movement_legs` (§4) + receipt gate & evidence with checklist config (§6) + custody-period lifecycle at rate 0 (§11) + cancellation recovery + substitution/assignment legs (§5) + archival guard + the per-car round-trips-while-away toggle (§7) + staff reposition + promo-home (§9). Search **and** checkout move to the §8 predicate. No cross-company money.
- **Slice 2 — cross-operator.** Host opt-in (widening the §7 receiving set), the stronger booking-leg relation + leg-derived host capability (§5.1/§12), the cost fold + non-zero rates + multi-party settlement (§11). Behind a flag.
- **Later — free-roam onward + `CLASS_COMBO` for displaced cars.**

### 14.1 Flag + kill-switch semantics

Slice 1 ships dark behind **one runtime flag, `ONE_WAY_CUSTODY`**. A flag gates *behavior*, never *facts*:

- **Flag OFF gates outbound movement only:** no one-way bookings (drop-off ≠ pickup), no promo mutations — those are server-side 404-gated, not merely hidden. (Staff repositions are homeward-only by §9, so there is no outbound reposition to gate.)
- **Recovery is never gated:** departing/receiving **existing** legs, creating + running a staff reposition (always homeward, §9), and the listing-config toggles (`heldOffline`, `autoRelistOnReceipt`, `allowRoundTripsWhileAway`) all remain available while OFF. A displaced or `IN_TRANSIT` car can always be brought home and received — a kill-switch that strands cars is not a kill-switch.
- **The §7 round-trips-while-away toggle needs no flag gate of its own.** A displaced `P→P` round trip has drop-off equal to pickup — it is not outbound movement, so `ONE_WAY_CUSTODY` OFF does not gate it. From booking-**create** it is unreachable while dark anyway: the OFF booking path below requires a tracked car to be **at home**, and a car at home has no displaced branch to evaluate. The one dark path that does evaluate the displaced branch is the never-gated **substitution of an existing commitment** (replacement legs, above) — deliberate: the §7 leash, toggle included, is per-vehicle policy the replacement car must satisfy, distinct from the runtime flag. Stated explicitly so nobody wires the toggle into the flag.
- **Pending planned legs at flip-OFF are defined:** existing confirmed one-way bookings keep their legs and run to completion through the state-driven transitions (commitments are honored), or staff cancel/substitute them normally; planned repositions may depart (homeward) or be voided.
- **Facts are always honored:** search reads the custody columns unconditionally — an `IN_TRANSIT` or `heldOffline` car stays unlistable even while dark. While the flag has never been ON this is byte-identical to today (§13 backfill makes `physicalLocationId ≡ pickupLocationId`; no legs exist).
- **The OFF booking path is kill-safe:** besides today's `pickupLocationId` equality it requires the car custody-listable, **at home** (when tracked), **and clean under §8 rules 3–4 over its live legs** — a car an existing leg will relocate is not bookable for the stranded window even while dark. Facts are honored on the write side too, not just in search (the search SQL already folds legs unconditionally; a checkout that didn't would accept what search hides — and manufacture stranded schedules for the cutover script to trip over). Equivalent while never-flipped (no legs exist); after a kill, displaced cars are unbookable until received or repositioned home — never bookable at a station they are not at.
- **Cutover fence:** the leg-synthesis script (idempotent, print-first) runs **immediately before and immediately after** each flip. It synthesizes legs for pre-flag `CONFIRMED`/`ACTIVE` bookings and departed `TRANSFER` recovery legs for cars whose dark-era `COMPLETED` one-way left them away from their materialized location (staff then receive them through §6 — evidence intact, no silent teleport; script-synthesized legs carry no departure confirmation, since no witnessed departure event existed, and a minimal-core checklist snapshot). Between the two runs, the never-gated state-driven endpoints own every in-flight movement, so no request spanning the flip is lost.
  **The script validates before it writes — twice.** Pass 0 folds every affected vehicle's complete would-be schedule (existing live legs + every leg it would synthesize) through §8 rules 3–4 + 6 and, on any violation, prints a per-vehicle conflict report and exits non-zero before writing anything — the operator's full picture. Under `--apply`, each vehicle's synthesis then runs in its own transaction under the §4 vehicle lock, and **the ENTIRE fold is re-run inside that lock against freshly-read state** — a booking can land between pass 0 and the lock, and a state-only re-check would miss it. A vehicle that fails the locked re-validation is skipped and reported; the script exits non-zero listing it. **`--apply` atomicity is per-vehicle and the run is resumable** (idempotent re-run picks up skipped/remaining vehicles) — it is NOT a global all-or-nothing write; pass 0's abort-before-anything is the only global gate. A migration must never materialize a schedule the model calls impossible.

---

## 15. Owner (kaku) decisions — record

- **Q1 — Roam vs homeward (amended 2026-08-03).** Phase 1 is **homeward-only** (§7). No onward B→C.
  **Displaced `P→P` round trips in place are a per-vehicle opt-in, default OFF** (`vehicles.allowRoundTripsWhileAway`, §3/§7) — **decided 2026-08-03**. When on, the round trip additionally requires `P` still active and authorized (the §7 intersection).
  *Provenance correction:* this line previously recorded "approved 2026-07-26" — that approval was never given. rev.5 (`ab6216b0`) introduced the branch explicitly flagged **"Owner to confirm"**; rev.6's canonical rewrite recorded it as approved with no owner decision in between. The per-vehicle opt-in above replaces that unconfirmed blanket approval.
  *Rationale on record, both sides:* toggle off, a stranded car earns nothing until a homeward renter appears; toggle on, it keeps working and still cannot drift — the only permitted moves remain stay-put or go-home.
- **Q2 — Pricing.** Always the **owner's** rate card + formula. The host only adds custody + handoff fees.
- **Q3 — In-transit booking (exact reading re-confirmed 2026-07-26; evidence scope refined 2026-07-28).** A car in transit cannot be booked, for any window. It must be physically received and confirmed before it appears anywhere. **Every return requires the arrival confirmation receipt — the minimal core (vehicle, location, receiver, time) is always mandatory; photos/inspection apply per the configured checklist (Q5). `autoRelistOnReceipt` changes only the post-receipt listing choice and never bypasses the receipt.**
- **Q4 — Fee incidence.** The host's custody fee is **deducted from the owner's payout**; the renter sees only the owner's price.
- **Q5 — Receipt evidence model (approved 2026-07-28).** Minimal mandatory arrival confirmation (vehicle, location, receiver, time); photos, inspection, fuel, odometer are an **owner-configurable checklist**, snapshotted onto the leg when movement begins (§6). No universal photo mandate, no unconditional DB photo CHECK.
- **Q6 — v1 combo scope (decided 2026-07-28).** Displaced cars stay **out of `CLASS_COMBO`**; renter-driven homeward return ships as regular `SPECIFIC` rentals (including promo-home pricing). Combo-based homeward rentals are deferred until product-critical — they require their own inventory-pool and assignment design.
- Staff repositioning is an **internal movement, not a product** — no ferry feature or naming (2026-07-28, §9).

---

## 16. Open questions

1. **Cross-operator liability** — receipt inspection finds damage: previous renter's leg or in-custody? The §6 record is the evidence; the policy is a business decision.
2. **Settlement cadence** — per handoff or periodic sweep of closed rows? (Lean: per-handoff.)
3. **Host fee model** — flat per-day, or per-day + fixed handoff? Who sets it — host, with a platform floor/cap?
4. **Insurance on a homeward re-rental from a foreign host** — whose policy covers the leg? (Likely the owner's — confirm.)
5. **Reset-home-base side effects** — region reassignment + geocode fire; never a physical move (§3/§9).
6. **Stale car** — no reposition or homeward booking happens: the car stays `heldOffline`, custody accrues (owed to the host). Surface drift + cost to the owner; no system deadline in v1.
7. **Settlement rounding + day-count** — calendar days vs 24h periods, JPY rounding. Structure fixed (§11); numbers are a business call.
8. **Default receipt checklist contents** — what the platform default requires beyond the minimal core (photos on or off by default; which condition fields). Structure fixed (§6); the default is a business call.

---

## 17. Out of scope (v1)

- Free-roam onward (B→C→D).
- `CLASS_COMBO` participation for displaced/hosted cars (owner-decided deferral, §15 Q6).
- Automated fleet rebalancing / route optimization.
- Cross-operator liability/insurance *settlement* beyond capturing the evidence record.
- Advance booking of a car at any location before it is physically received there (Q3-strict, §8).
- Scheduling future staff repositions.

---

## 18. Why this approach

- **Owner/Host separation** — one split unifies same-operator and cross-operator; `host == owner` degrades cleanly to today.
- **Physical location is the only listing basis; projection only excludes.** Q3-strict removes the read/write drift class entirely: search, storefront, and checkout share one small predicate anchored on a received fact (§8).
- **Explicit physical state, everything else derived** — a three-way discriminant whose dependent references are tied on by CHECK + composite FKs; *home* and *host-is-owner* are derived, never encoded (§3).
- **Uniqueness follows traversal identity** — a mid-trip swap makes one booking own two traversals; the constraints model that instead of fighting it (§4/§5).
- **Authorization from the intended transition** — the receipt that establishes custody is authorized by the leg's destination, not by the custody it hasn't established yet (§5.1).
- **Custody tracks possession** — a period spans only `[receivedAt, departedAt)`; nobody is charged for custody they don't have (§11).
- **Evidence at the boundary, proportionate to configuration** — private, immutable, endpoint-coherent, fingerprint-idempotent receipts; a sealed minimal core plus an owner-configured checklist snapshotted when movement begins (§6).
- **Kill-safe by construction** — outbound gated, recovery never gated, facts always honored (§14.1).
- **Policy as a dial** — homeward vs free-roam is one function over an explicit receiving set (§7).

---

## Appendix A — review history

- **rev.1** — initial design (materialized location).
- **rev.2–rev.4** — three design-review rounds: restored the timeline predicate alongside the materialized fact, movement-leg identity, custody-period possession semantics, archival guard, one-open-period seal.
- **rev.5** — folded eight plan-review blockers (state-dependent leash, substitution legs, ferry transition, receipt ordering/idempotency, flag semantics, capacity-gate skip, display mapping, added seals).
- **rev.6** — canonical rewrite after the rev.5 review: projection-excludes-never-promotes feasibility (§8) replacing destination promotion; traversal-identity leg uniqueness admitting ACTIVE substitution/assignment (§4/§5); receiving set split from homeward set, foreign drop-offs restored (§7); leg-derived receipt authorization (§5.1); recovery-only operations while OFF + cutover fence (§14.1); bootstrap/untracked on-ramp + baseline periods (§13); state↔reference composite-FK seals, endpoint trigger, `FOR SHARE` archival serialization (§3/§6/§7); fingerprint-bound idempotency (§6).
- **rev.7** — owner corrections 2026-07-28: product-facing ferry removed — staff repositioning is an internal `STAFF_REPOSITION` movement (§4/§9); receipt evidence minimized — mandatory core (vehicle, location, receiver, time) + owner-configurable checklist snapshotted onto the leg at departure, unconditional photo CHECK dropped (§5/§6, Q5); v1 combo scope decided — displaced cars stay `SPECIFIC`-only, combo deferred (§8, Q6).
- **rev.8** — plan-rev.3 review (2 P0 + 6 P1) folded: cutover script validates schedules before synthesizing, per-vehicle tx under the §4 lock (§14.1); home-base⇒tracked trigger + atomic create placement + self-placing seeds (§13); lifecycle constraint triggers completing the state⇔reference seals + bidirectional leg-endpoint guard (§3/§6); validate-first all-or-nothing departure (§5); FOR SHARE widened to every location-referencing write (§4); staff reposition restricted to home base, never gated (§9/§14.1); photo content hashes in fingerprints + preflight-before-upload + PHOTOS-requires-storage (§6); tail rule promoted from plan decision to §8 rule 6.
- **rev.9** — plan-rev.4 review (4 P0 + 5 P1) folded, all concurrency/deployment: custody triggers re-read final row state and cover every lifecycle column (§3); home-base⇒tracked trigger moved to an expand–contract follow-up migration (deploy pipeline migrates before code) + seed shape corrected to the real insert site under neon-http's no-transaction constraint (§13); lock-then-reread discipline for every custody-bearing write (§4); cutover `--apply` re-runs the full fold inside each vehicle lock, per-vehicle atomicity + resumable semantics stated (§14.1); receipt fingerprints bind command identity (vehicle/leg/phase) and preflight covers ALL deterministic checks (§6); substitution/assignment idempotency moved to client command keys, replacing rev.8's generation keys — a delayed duplicate must replay, not re-execute (§4); custody-period provenance FKs (§11); one canonical advisory-lock formula (§4); receipt self-supersession CHECK (§6).
- **rev.10 / rev.10.1 (this)** — owner change request 2026-08-03: displaced `P→P` round trips become a **per-vehicle opt-in, default OFF** (`allowRoundTripsWhileAway` — §3 column, §7 displaced branch, §8 combo consequence + benign-case wording, §12 owner surface, §13 additive set, §14 Slice 1, §14.1 no-flag-gate note). Plus a **provenance correction** in §15 Q1: the "approved 2026-07-26" it recorded was never an owner decision (rev.5 flagged the branch "Owner to confirm"; rev.6's rewrite recorded approval with no decision in between). rev.10.1 folds the round-10 review of the fold (1 P0 + 5 P1): create-time-only toggle semantics + empty-set recovery stated in §7; the §14.1 "unreachable while dark" claim scoped to booking-create (never-gated substitution does evaluate the displaced branch, deliberately).

Full diffs: `git log -- docs/superpowers/specs/2026-07-26-one-way-custody-network-design.md`.
