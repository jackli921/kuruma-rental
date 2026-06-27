# Same-operator one-way rentals — design

> **Status:** DRAFT for review — rev.3 (movement-history status set, lock-all-mutations, parity-all-surfaces, dropoff turnaround; post-maintainability-review) · **Issue:** #882 · **Date:** 2026-06-21
> **Supersedes the placeholder:** `2026-06-15-search-map-list-redesign.md` §6 (forward-compat note only)
> **Scope note (authoritative):** #882 comment 2026-06-20 — *same-operator* one-way is in scope; *cross-operator* returns are a separate, blocked initiative ("multi-operator return network").

---

## 1. Problem

A renter picks up a car at branch **A** and returns it to branch **B** of the **same operator** (same `operatorId`). The schema already allows this — `bookings` carry separate `pickupLocationId` and `dropoffLocationId` FKs (marketplace proposal line 38). What does **not** exist is the inventory model: once a car can end somewhere other than where it started, **a vehicle's location becomes a function of time**, and every availability decision has to respect that.

Today a vehicle is **immobile**. `vehicles.pickupLocationId` is set once and never changes; `booking-creation.ts:236` hard-rejects any booking whose pickup ≠ that static home ("the car physically lives at its own storefront", #392); the availability scan filters `vehicles.pickupLocationId = X`. Correct only because cars never move.

This design makes location time-dependent **with a seam that lets us ship the smallest correct slice now and grow without a rewrite.**

---

## 2. The trap: a mutable `currentLocationId` is wrong

The tempting design — add `vehicles.currentLocationId`, update it to the dropoff when a booking completes — **is incorrect for an advance-reservation system.** Bookings are made for the *future*, so "where is the car *now*" cannot answer "where will the car *be* at a future pickup."

> Car homed at **A**. A booking exists: **Jul 1 → Jul 3, A→B** (one-way).
> A renter searches *"available at **B**, pickup Jul 5"*.
> Reality: the car is at **B** from Jul 3 onward, so it **should** match.
> A `currentLocationId` column still reads **A** (the Jul 1 booking has not *completed* — it is in the future). → the search **misses** it.
> Symmetrically, *"available at **A**, Jul 5"* would **wrongly** match a car that is no longer there.

A single mutable scalar only ever reflects the *last completed* trip. It is structurally unable to represent a future location. Choosing it now would force a rewrite the first time advance one-way bookings interact.

---

## 3. The model: location is a pure fold over a movement-event stream

A **movement leg** is any booking that actually moved the car: picked up at `pickupLocationId` at `startAt`, settled at `dropoffLocationId` from `effectiveEndAt` onward (`effectiveEndAt` includes turnaround).

**Two status sets — do not conflate them** (a status *projection* is not domain *history*):
- **Occupancy** `{CONFIRMED, ACTIVE}` — bookings that currently *hold* the car. Drives **R1 / the exclusion constraint** (double-booking). A finished trip no longer occupies the car.
- **Movement history** `{CONFIRMED, ACTIVE, COMPLETED}` = *everything except `CANCELLED`* — bookings that *relocated* the car. Drives **`locationAt`**. A **COMPLETED** A→B trip is *precisely why the car is at B*; dropping it would snap the car back to home for every future search. Only `CANCELLED` (the trip that never happened) is excluded. (Enum: `CONFIRMED→ACTIVE→COMPLETED`, `*→CANCELLED`.)

**`locationAt(V, t)`** — where vehicle `V` is at instant `t`:
- Let `B` = `V`'s **movement-history** bookings with `effectiveEndAt ≤ t`.
- `B` empty → `V.homeLocationId` (the reinterpreted `pickupLocationId`).
- else → the `dropoffLocationId` of the booking in `B` with the **greatest** `effectiveEndAt`.

A pure step-function over the booking timeline. In v1 the **only** event source is the booking chain — but the fold is defined over an abstract "movement" so future sources (operator relocation, cross-operator transfer) just *append* without changing the derivation (OCP).

### 3.1 Feasibility of a new booking

New booking `N` = pickup `P`, dropoff `D`, window `[S, E)`, `effectiveEnd EE`. `N` is feasible iff:

- **R1 — No overlap.** No existing CONFIRMED/ACTIVE booking of `V` overlaps `[S, EE)`.
  *Already enforced* by the Postgres exclusion constraint `bookings_no_overlap` (keyed `assignedVehicleId` + `tstzrange`). Unchanged. Because R1 holds, every other booking is either fully before `S` (`effectiveEndAt ≤ S`) or fully after `EE` (`startAt ≥ EE`) — so "the predecessor" and "the successor" below are well-defined, never straddling.
- **R2 — Pickup continuity.** `locationAt(V, S) == P`. The car must actually *be* at the pickup the renter chose. (Today this is implicit: `:236` pins `P` to the static home.)
- **R3 — Dropoff continuity.** The **successor** booking (earliest with `startAt ≥ EE`) must have `pickupLocationId == D`; or there is no successor → no constraint, `N` becomes the new tail and the car rests at `D`.

R2 and R3 are a **sequential, cross-row** constraint. They are **not** expressible as a Postgres `EXCLUDE` (which compares pairs of rows, not ordered neighbors). They are enforced in the application, inside the booking transaction, under a per-vehicle lock (§5.3).

### 3.2 Worked timeline

```
Home(V) = A.   (turnaround omitted for clarity)

Booking 1:  Jun 10–12   A → A   (round trip)          → car at A
Booking 2:  Jun 20–22   A → B   (one-way, tail)       ✓ R2: locationAt(Jun20)=A=P ✓  no successor → R3 n/a
                                                          car at B from Jun 22

New "round trip at A, Jun 15–16":   R2 locationAt(Jun15)=A (pred=Bkg1.dropoff=A) ✓
                                    R3 successor=Bkg2.pickup=A == D=A ✓           → allowed
New "one-way A→C, Jun 25–26":       R2 locationAt(Jun25)=B (pred=Bkg2.dropoff=B) ✗ P=A≠B → 400 "car is at B"
New "one-way B→C, Jun 25–26":       R2 locationAt(Jun25)=B == P=B ✓  tail → allowed → car at C
```

---

## 4. The policy dial — v1 ships tail-only

The three "how much one-way" options are **not three architectures**; they are one architecture with the **feasibility policy dialed**. The data model, the pure core, and the shell are identical. What changes is which rules `assessPickupFeasibility` turns on.

**v1 policy = tail-only one-way:** a one-way (`D ≠ P`) is allowed **only when `N` is the tail** (no successor). Round trips (`D == P`) are allowed anywhere they pass R1+R2 — i.e. unchanged from today when no car has moved. This makes **R3 vacuous** (a tail has no successor), so v1 never has to reason about a downstream handoff, while R2 still guarantees correctness (no phantom-location bookings).

Why tail-only is the right v1: for a 40–50 car fleet with sparse forward bookings the "insert a one-way *before* an existing later reservation" case is rare, and the rejection message is clear ("this car has a later reservation; one-way isn't available for these dates — pick a round trip or different dates"). We trade a slice of utilization for a model with no mid-chain bookkeeping.

**Every later step is additive behind a seam already paid for:**

| Future change | What it costs |
|---|---|
| tail-only → full mid-chain insertion | turn on **R3** in the pure fn (+ its tests). No schema/route/repo change. |
| operator manual relocation (rebalancing) | add a `vehicle_movements` row as a 2nd movement source; the fold is unchanged. |
| cross-operator returns (#882 scope note) | relax the operator-equality guard in the fn + add settlement; location model already supports it. |
| one-way / relocation **drop fee** | already just a `feeSnapshot` term via `composeBookingTotal` (§6 guardrail 4). |
| search perf at scale | optimize the repo's location-at-time query in isolation (callers untouched). |

---

## 5. Architecture — three seams

### 5.1 Data (additive, minimal)

- **Keep `vehicles.pickupLocationId`; reinterpret it as the vehicle's *home / fallback* location** (where it lives when it has no movement history). Document the semantic; **no rename migration** in v1 (YAGNI — a later rename to `homeLocationId` is additive and cosmetic).
- **No `currentLocationId` scalar** (§2).
- **No `vehicle_movements` table in v1.** Location is *derived* from bookings. The table is introduced only when a **non-booking** movement source appears (operator relocation) — at which point the fold gains a source, not a rewrite.
- **Index:** add `idx_bookings_assignedVehicle_effectiveEnd` on `bookings(assignedVehicleId, effectiveEndAt)` to serve the predecessor/successor lookups and the search LATERAL (§5.4).

The existing `bookings_no_overlap` exclusion constraint is **untouched** — it is the orthogonal overlap floor. Continuity layers on top of it; keeping them separate is exactly what lets the continuity policy evolve freely.

### 5.2 Pure core (Functional Core / Imperative Shell)

One pure module — `packages/shared/src/lib/one-way.ts` (or `packages/api/src/services/`), no I/O:

```ts
type Leg = { pickupLocationId: string; dropoffLocationId: string; startAt: Date; effectiveEndAt: Date }

// where the vehicle is at instant t, given its legs + home
function locationAt(legs: Leg[], homeLocationId: string | null, t: Date): string | null

type Feasibility = { ok: true } | { ok: false; reason: 'PICKUP_NOT_AT_LOCATION' | 'ONEWAY_NOT_TAIL' | 'DROPOFF_DISCONTINUITY' }

// the SCOPE DIAL lives here. tail-only enforces R2 (+ the tail guard for one-way);
// flipping to full-chain adds R3.
function assessPickupFeasibility(args: {
  legs: Leg[]; homeLocationId: string | null
  pickup: string; dropoff: string; startAt: Date; effectiveEndAt: Date
  policy: 'TAIL_ONLY' | 'FULL_CHAIN'
}): Feasibility
```

Pure ⇒ exhaustively unit-testable with no DB (timelines as plain arrays). The `reason` codes map to typed `ErrorCode`s (#941) so the route and web surface them without re-deriving policy.

### 5.3 Shell (thin I/O) — booking creation

`booking-creation.ts submitInTx` already runs inside an interactive transaction via the injected `runInTransaction` (wired to `runTx`, the neon-serverless runner — #493). Change, inside that tx:

1. **Serialize per vehicle:** `SELECT pg_advisory_xact_lock(hashtext(:assignedVehicleId))`. R2/R3 are *check-then-act across rows*; two concurrent creates could each read the chain, both pass, both commit, and break it — the exclusion constraint won't catch a *continuity* break (only time overlap). The advisory xact-lock serializes all creates for one vehicle; released automatically at commit/rollback. (Same serialize-per-entity approach #464's capacity guard is slated to use.) **The same lock guards *every* chain mutation — create, self-cancel, operator cancel, substitution — or a concurrent create can slip a dependent booking between a cancel's check and its commit and strand it. Substitution moves a leg between two chains → it locks *both* vehicles, acquired in ascending id order to avoid deadlock.**
2. **Load the movement legs** for `assignedVehicleId` (`status <> 'CANCELLED'`, incl COMPLETED — a finished trip still moved the car; bounded to the bracketing legs, never full history), call `assessPickupFeasibility(... policy: TAIL_ONLY)`.
3. On `ok:false` → `return { ok:false, status:400, error, code }`. The old `:236` static `pickupLocationId` equality check is **replaced** by this (it becomes the `locationAt(legs, home, startAt) == pickup` special case).

The existing same-operator dropoff guard (the one locked by the #1013 test, `booking-creation.ts:247`) stays — it is the *operator-equality* gate, orthogonal to continuity.

### 5.4 Shell — search / availability

The read path must answer the **same question checkout answers** — *"is this car bookable for this exact pickup→dropoff request?"* — not the weaker *"is it physically at the pickup?"*. Otherwise search advertises cars creation rejects (**Policy Drift**: e.g. a car with a Jul-20 future booking, searched for a Jul-10 one-way, is physically at the pickup but fails tail-only → search "yes", checkout "no"). So search **calls the same `assessPickupFeasibility`** — never a re-encoded SQL subset of the policy.

Two-step, FC/IS:
1. **Repo prefilter (cheap, indexed) — a candidate cut, not the answer:** `findAvailableVehicles` keeps the road-legal gate + `NOT EXISTS` overlap and adds a LATERAL that keeps only cars **physically at the pickup** at `requestedStart` (R2):
   ```sql
   LEFT JOIN LATERAL ( SELECT b."dropoffLocationId" FROM bookings b
     WHERE b."assignedVehicleId" = v.id AND b.status <> 'CANCELLED'  -- movement history (incl COMPLETED)
       AND b."effectiveEndAt" <= :requestedStart
     ORDER BY b."effectiveEndAt" DESC LIMIT 1 ) last_leg ON true
   WHERE COALESCE(last_leg."dropoffLocationId", v."pickupLocationId") = :pickupLocationId
   ```
2. **Service authoritative (parity):** `FlatSearchService` batch-loads the candidates' legs (one `assignedVehicleId IN (...)` query + group-by — the #982 batch pattern) and runs `assessPickupFeasibility(pickup, dropoff, window, policy)` per candidate — **the identical pure fn the booking tx uses.** A bookable result is, by construction, one creation will accept. A round-trip request (`dropoff == pickup`) reduces to R2 (today's behavior); a one-way also applies the tail-only check, so the Jul-20-successor car above is correctly **excluded**.

This extends `AvailabilityRepository.findAvailableVehicles` (`types.ts:497`) to carry the requested **dropoff** + **effectiveEnd** (today: only `from/to/filters`). The repo step is the hot-path cost §6 warned about — tractable at 40–50 cars with the new `(assignedVehicleId, effectiveEndAt)` index, and behind the interface so it can be optimized later. `FlatSearchService.toSpecific` maps the **searched pickup** to the card pin (not `vehicle.pickupLocationId`), per the §6 "pin is the *pickup* pin" guardrail.

**Parity applies to *every* renter availability surface, not just flat search** — each calls the one predicate, or is named advisory: `flat-search`, `storefront-search`, `storefront-detail`, and per-vehicle `checkVehicleAvailability` (`GET /availability/:id`, whose signature also gains the dropoff) all run it. **Class-level availability (`vehicle-class-availability.ts`) is explicitly deferred** — one-way v1 is SPECIFIC-fulfillment only (`fulfillmentMode: 'SPECIFIC'`); CLASS_COMBO one-way rides #464. The **InMemory** availability repo must mirror the predicate exactly — a repo-parity test asserts InMemory and Drizzle return identical candidates (the #939 InMemory/Drizzle drift trap).

---

## 6. Lifecycle interactions (correctness, named honestly)

- **Turnaround follows the *dropoff* (one-way):** `effectiveEndAt = endAt + turnaround` is set by the `0037` trigger from the **pickup** location's `defaultTurnaroundMinutes`. For a one-way the car is returned and cleaned at the **dropoff**, so the trigger *and* `booking-creation.ts:251` must use the **dropoff** location's turnaround when `pickup ≠ dropoff` — otherwise the car's next-bookable time at B is computed from A's buffer and it's advertised before it's actually ready. (New migration; same-location bookings unchanged.)
- **Substitution** (`booking-lifecycle.ts substitute`): today it requires `replacement.pickupLocationId == booking.pickupLocationId`. Under the model it must require **`locationAt(replacement, booking.startAt) == booking.pickupLocationId`** (and, full-chain, that the replacement can satisfy R3). Shell change, same pure fn.
- **Cancellation (continuity repair — a v1 slice, not ops debt):** cancelling a one-way leg can **strand a later booking** that picked up at its dropoff. Tail-only shields *creation* (a one-way has no successor when made) but **not** the runtime state: a round-trip later booked at `B` (valid then) is stranded if the A→B leg is cancelled. Crucially, the existing alert infra is **document-expiry only** (#916) — no movement-chain concept — so "surface it to the dashboard" was **not a real mechanism**. The slice that *can* create the impossible state ships the one that stops it:
  - **Detector (pure, same fold style):** `findStrandedSuccessors(legs, cancelledLeg)` → successors whose `pickupLocationId ≠ locationAt` once the leg is removed. Wired into the cancel path (`booking-lifecycle.ts:303`).
  - **v1 = prevent (recommended):** self-serve cancel of a leg with dependents is **blocked** with a typed reason; resolving it is an operator action (cancel/relocate the dependent), so the system never enters the impossible state — no new UI.
  - **alt = detect + alert:** allow the cancel, emit a real *stranded-booking* operator alert + queue. Better renter UX, but requires **building** an operator alert surface (the doc-expiry one can't represent it). Decision in §8 Q1.

---

## 7. Vertical slices (each shippable, TDD)

1. **Pure core + tests** — `locationAt` + `assessPickupFeasibility(TAIL_ONLY)`, exhaustive timeline unit tests (incl. R1 boundary `[closed, open)`, no-predecessor=home, one-way-not-tail rejection). No wiring. *Pure, zero-risk, no behavior change.*
2. **Booking-creation + cancellation continuity** — advisory lock + legs load + replace `:236` with the pure check; **plus `findStrandedSuccessors` wired into cancel (§6)**, so the slice that *can* break continuity also prevents it. Real-PG integration tests (round-trip-after-one-way pickup mismatch → 400; valid tail one-way → 201; concurrent-create serialization; **cancel-with-dependent → blocked**). Drop fee **not** included.
3. **Search/availability parity** — repo prefilter + new index **and** the service calling `assessPickupFeasibility` so **bookable == creatable** (§5.4); the pin-mapping fix. Tests: car visible at its dropoff branch after a one-way / invisible at home, **plus an explicit search↔create parity test** (anything search returns, creation accepts). Migration = the index (generate → migrate → `db:verify`).
4. **Web surface** — the "Return to a different location" toggle + dropoff field (§6 industry UX), one-way badge, route line on the map adapter (the §6 guardrails make this additive). Modeled on Hertz/Avis/Turo's one-way pattern (support, not invention — per renter-UI guidance).
5. **Drop fee** *(optional, post-MVP)* — a `feeSnapshot` term; no architectural change.

Slices 1–3 are the backend epic; 1 is pure and lands first. 4 is independent web work. Each is a vertical PR closing a sub-issue. The dropoff-turnaround fix (§6, maintainability F1) is broken out as its own no-dep issue since it's independently shippable. Maintainability findings F1–F7 (review 2026-06-21) are folded into the relevant slices as acceptance criteria and tracked as the #882 sub-issues.

---

## 8. Open questions (for sign-off)

1. **Cancellation strand (§6)** — both options are **detector-backed** (no hand-wave). Recommend **v1 = prevent**: block self-serve cancel of a depended-on one-way; operator resolves. Correct, no new UI. Choose **detect + alert** only if you want to build the stranded-booking operator surface now.
2. **Drop fee in v1?** The owner ask didn't mention a fee. Ship one-way *free* in v1 (slice 5 deferred), or require the fee from day one?
3. **Operator override** — should an operator be able to create a one-way that *violates* tail-only (they'll reposition manually)? If yes, it's a `policy` argument already (`FULL_CHAIN` for staff context) — cheap, but expands test surface.
4. **Home semantics** — keep reusing `pickupLocationId` as "home", or spend a rename migration to `homeLocationId` now for clarity? (Recommend reuse; revisit if it confuses operators.)

## 9. Out of scope (named distinctly)

- **Cross-operator returns** — the "multi-operator return network" (#882 scope note): no shared custody/rate/liability/settlement model exists; it is a business alliance to negotiate, not a feature to build. The location model *supports* it, but it stays gated.
- **Fleet rebalancing optimization** (suggesting/automating repositioning moves).
- **Vehicle in-transit / maintenance state machine.**
- **Pushing search pagination into SQL** (#727) — orthogonal.

---

## 10. Why this approach

- **Functional Core / Imperative Shell** — `assessPickupFeasibility` is a pure decision over plain data; the tx, advisory lock, and SQL are the thin shell. The scope policy is a function argument, so changing *how much one-way* never leaves the core.
- **Open/Closed** — location is a fold over a movement *stream*; new movement sources (operator relocation, cross-operator) append without editing the fold or the callers.
- **Derived state over stored state** — location is computed from the booking timeline, never stamped into a column that can't see the future. Fewer invariants to hold; no reconciliation job.
- **Read/write parity (no Policy Drift)** — one predicate (`assessPickupFeasibility`) answers feasibility for *both* search and creation; the read path **calls** it, never re-encodes a subset in SQL. If search can say "yes" where checkout says "no", trust dies and support load spikes.
- **Invariant → prevention or detection in the same slice** — the slice that can create an impossible future state (cancel stranding a booking) ships the mechanism that prevents or detects it. A defined invariant is never left to manual cleanup.
- **Projection ≠ history** — a status filter (`CONFIRMED/ACTIVE`) is occupancy, not the record of what moved the car. The `locationAt` fold keeps `COMPLETED` legs; only `CANCELLED` is dropped. Ask "does this state still matter after completion?" before filtering it out of a derived-state fold.
- **Same invariant → same lock** — every operation that mutates a vehicle's movement chain (create, cancel, substitute) takes the *same* per-vehicle advisory lock; a check-then-act split across two unlocked operations lets both pass and the combined result violate the rule.
