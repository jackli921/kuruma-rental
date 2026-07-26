# One-way custody network — design

> **Status:** DRAFT for review · **Date:** 2026-07-26
> **Supersedes:** `docs/plans/2026-06-21-one-way-rentals-design.md` (#882) and its derived-location model.
> **Confirmed with owner (kaku):** four business decisions, recorded in §14.

---

## 1. What we're building

One-way rentals where a car picked up at location **A** can be dropped at a *different* location — a branch of the **same** operator, or a **different** operator's station that opted in to host cars. The dropped car is **received, inspected, and photographed**, then either held for return home, re-rented on a homeward trip, or (in a later phase) rented onward.

Everywhere the car goes, **the owner sets the price**; **whoever holds it earns a custody fee**. That one separation is the whole design.

---

## 2. This supersedes the old model — and the old objection dissolves

The old #882 design *derived* a car's location as a fold over its **future** booking timeline, specifically to avoid a mutable `currentLocationId`. It had to, **because it allowed advance one-way bookings** — you could book a car at B *before it arrived*, so "where is the car now" couldn't answer "where will it be at a future pickup."

We are dropping that. Per kaku's rule (§14 Q3): **a car is bookable from B only after B physically receives, confirms, photographs, and inspects it.** Present physical presence is now a *precondition* of bookability. There is no future location to predict — so the car's **current** location is a complete and correct basis for search. A present-tense `currentLocationId` scalar is **valid here**, not the trap it was there. Documenting this so a future reader doesn't "fix" it back into a fold or think we repeated the old mistake.

---

## 3. Core model: separate OWNER from HOST

- **Owner** — the operator that owns the car. Sets price + formula, earns the rental. (= existing `vehicles.operatorId`.)
- **Host** — whoever physically holds the car right now. Earns a per-day custody + handoff fee. **When host == owner, the fee is 0.**

This single split unifies every behavior — same-operator branch return, cross-operator handoff, homeward re-rental, ferry-home, promo-home. All of them are just "the car changed hosts," always owner-priced. Same-operator is the degenerate case where the host fee collapses to zero and the flow is exactly today's.

---

## 4. The three locations a car tracks

| Concept | Meaning | Storage |
|---|---|---|
| **Owner operator** | Who owns + prices the car. Fixed. | `vehicles.operatorId` (exists) |
| **Home base** | Canonical resting branch, one of the owner's locations. "Homeward"/"drive it back" point here. Owner can reset it. | Reinterpret `vehicles.pickupLocationId` as home base |
| **Current host location** | Where the car physically is *now*. Moves only on a confirmed receipt. | New `vehicles.currentLocationId` (nullable = at home base) |

---

## 5. Custody state machine (search on/off)

A car is **ON** in search when **all** of: owner status `AVAILABLE` · received at a host that opted in (or the owner's own branch) · not manually held · no booking overlap.

Two **new** dark states:

- **IN_TRANSIT** — out on a rental or being driven. Not bookable (the §14 Q3 constraint).
- **HELD_OFFLINE** — received but parked: ferry-home queued, promo-home listing, or maintenance.

Transitions:

- Rental starts → **IN_TRANSIT**.
- Receipt confirmed (§6) → `currentLocationId` set to the drop-off; then, per the owner's setting, either back **ON** (homeward-listable) or **HELD_OFFLINE**.
- Whether a received car auto-relists or waits for the owner to choose is a **per-car owner setting** — default *wait for owner*, with a one-flip *auto-relist on receipt*. One flag, safe default, changeable anytime.

---

## 6. The receipt gate

A car reappears only after the host completes a defined procedure:

> **receive → confirm booking/identity → photograph → condition inspection**

This produces a **timestamped, photo-backed inspection record at each handoff** (reuses the existing vehicle photo storage / R2 infra). Bonus: it is the evidence trail for damage attribution. Detailed liability policy is an open question (§13).

---

## 7. Phase 1 policy: homeward-only leash (§14 Q1)

Once a car leaves its owner's locations, it may **only** be listed for trips whose drop-off returns it toward the **owner's own locations**. No onward B→C in v1.

Consequence: **a car is at most at one foreign host at a time, then it goes home — no multi-hop drift, bounded inventory.** Free-roam onward is a later phase behind the *same* model; the leash is one policy flag, not an architecture.

---

## 8. Getting a car home (owner tools)

- **Ferry (B1)** — owner marks "bring it home"; car goes **HELD_OFFLINE**; the owner's own staff drives it back; on receipt at home, normal. No customer, no charge.
- **Promo-home (B2)** — owner lists a **discounted one-way** with drop-off locked to the owner's branches + a cutoff date. Whoever books it drives it home cheaply — the customer repositions the car for the owner. A pricing/promo layer on a normal one-way booking.
- **Reset home base** — owner re-labels the car's home to where it landed (e.g., opens/uses a branch there). No physical move.

---

## 9. Money & settlement (§14 Q2, Q4)

- Renter **always pays the owner's price** (owner rate card + formula). One consistent price wherever the car is picked up — no handover, no re-quote.
- Host earns a **per-day custody fee + handoff service fee**.
- The host fee is **deducted from the owner's payout** — the renter never sees it. Platform takes its usual cut. Owner nets `price − host fee − platform cut`.
- `host == owner` → fee 0 → today's single-operator settlement, unchanged.

---

## 10. Custody-cost ledger (not a scalar)

Custody cost is **not** a running total on the car. It is an **append-only custody-period ledger**:

```
custody_periods { vehicleId, ownerOperatorId, hostOperatorId, hostLocationId,
                  startAt, endAt, dailyRateJpy, settledAt }
```

- The **open** row (`endAt = null`) is the current stint — it mirrors `vehicles.currentLocationId`.
- A handoff **closes** the current row and **opens** the next. Each host owns its own rows and its own fee.
- Cost is **derived** (`rate × days`), folded over unsettled rows; each host is paid for *its* rows, deducted from the owner.
- Phase 1: at most **one open foreign row** at a time. The ledger already supports multi-hop for later free-roam — no special case.

```
Learn: Accumulator-on-the-Entity
A running per-day total on the car looks simplest but erases the per-host breakdown and can't be reconciled.
Heuristic: when a cost accrues from many sources over time, store the events and fold — never one mutable total.
```

---

## 11. Affected surfaces / schema implications

- **`vehicles`** — reinterpret `pickupLocationId` as *home base*; add `currentLocationId` (nullable; composite FK to `locations` that may cross operators — **not** tenant-sealed to the owner, because a foreign host location is legitimate).
- **`operators` / `locations`** — add a **host opt-in** flag (operator opts in to hosting other operators' cars) + custody-fee config (per-day rate, handoff fee).
- **`bookings`** — pickup/drop-off can now **straddle operators**: a car at B, booked homeward, has pickup = B's location (foreign) and drop-off = an A location. The booking still belongs to the **owner** (pricing/earnings). The #1521 tenant-seal composite FKs on booking pickup/drop-off must be **relaxed for cross-operator legs**. This is the trickiest schema change — **slice 2 only**.
- **`custody_periods`** — new ledger table (§10).
- **Receipt/inspection record** — photos + condition per handoff (§6); reuse photo storage.
- **Search / availability** — filter on `currentLocationId` (present-tense) instead of static `pickupLocationId`; the homeward-only policy constrains *listable drop-offs* when the car is not at a home-base location. Search and booking-creation must share **one feasibility predicate** (no policy drift — the one genuinely good idea to carry over from #882).
- **Settlement** — extend payout to deduct host custody fees, with the `payment_events`-style ledger discipline.
- **Booking lifecycle** — `CONFIRMED → ACTIVE → COMPLETED` drives IN_TRANSIT; `COMPLETED` + the receipt gate drives the host change.

---

## 12. Build order (each a vertical, shippable slice)

- **Slice 0 — pure core.** Custody state + homeward-only feasibility predicate + cost fold, pure and exhaustively unit-tested (FC/IS). No wiring, no behavior change.
- **Slice 1 — same-operator homeward.** Reinterpret home base + `currentLocationId` + receipt gate + ferry (B1) + promo-home (B2). **No cross-company money.** Search moves to `currentLocationId`.
- **Slice 2 — cross-operator.** Host opt-in, relax the booking-location seal for foreign legs, custody-period ledger + settlement deduction, receipt inspection record.
- **Later — free-roam onward.** Flip the leash; the ledger and model already support it.

Slices 0–1 deliver real value with zero cross-company complexity. Slice 2 is the multi-party custody + settlement network and should be gated behind a flag.

---

## 13. Open questions

1. **Cross-operator liability** — if the receipt inspection finds damage, was it the previous renter's leg or in-custody? The inspection record is the evidence; the *policy* is a business decision.
2. **Settlement cadence** — pay the host per handoff (on close) or a periodic sweep of closed rows? (Lean: per-handoff.)
3. **Host fee model** — flat per-day, or per-day + fixed handoff? Who sets it — host, with a platform floor/cap?
4. **Insurance on a homeward re-rental from a foreign host** — whose policy covers the leg? (Likely the owner's, since owner-priced — confirm.)
5. **Reset-home-base side effects** — changing home changes the car's search region; ensure region reassignment + geocode fire.
6. **Stale car** — if no one ferries or books a homeward promo before the cutoff, the car stays HELD_OFFLINE and custody cost accrues. Surface the drift + cost to the owner; no system-enforced deadline in v1.

---

## 14. Owner (kaku) decisions — record

- **Q1 — Roam vs homeward.** Phase 1 is **homeward-only**: a car that has left A may only be rented back toward A's locations. Prevents runaway drift / inventory loss.
- **Q2 — Pricing.** Always the **owner's** rate card + formula. The host only adds custody + handoff fees.
- **Q3 — In-transit booking.** A car in transit **cannot** be pre-booked. It must be physically received, confirmed, photographed, and condition-checked before it appears in search.
- **Q4 — Fee incidence.** The host's custody fee is **deducted from the owner's payout**; the renter sees only the owner's price.

---

## 15. Out of scope (v1)

- Free-roam onward (B→C→D) — later phase.
- Automated fleet rebalancing / route optimization.
- Cross-operator liability/insurance *settlement* beyond capturing the evidence record.
- Advance booking of a car at a host before it physically arrives (explicitly forbidden by Q3).

---

## 16. Why this approach

- **Owner/Host separation** — one split unifies same-operator and cross-operator; `host == owner` degrades cleanly to today.
- **Present-tense location is valid *here*** — because bookability requires physical presence (Q3), `currentLocationId` is correct, not the old trap. The old design's central objection simply doesn't apply once advance foreign bookings are forbidden.
- **Derived cost over stored total** — the custody ledger is folded, never a mutable accumulator.
- **Policy as a dial** — homeward-only vs free-roam is one flag; the data model, core, and shell don't change.
- **Read/write parity** — search and booking-creation share one feasibility predicate, so search never advertises a car creation would reject.
- **Evidence at the boundary** — the receipt inspection captures proof exactly where custody changes hands.
