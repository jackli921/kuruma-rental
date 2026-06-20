# Shaken / Insurance Compliance Enforcement — Design

- **Date:** 2026-06-16
- **Status:** Approved — decisions locked 2026-06-16
- **Base branch:** `marketplace-pivot`
- **Worktree / branch:** `../kuruma-shaken-compliance` / `feat/shaken-compliance`
- **Issue:** TBD (file before implementation)
- **Builds on:** #226 (closed) — shaken/insurance expiry *tracking + display*
- **Review:** two architect-review passes (2026-06-16) incorporated — substitution +
  direct availability folded into enforcement (§5.2–§5.3b), expiry boundary fixed once
  (§4), one time-basis clock across all gates (§4), null/UNKNOWN gated out + required at
  create (D5/§5.0), cron matched to the Sentry-wrapped handler (§5.4).

---

## 1. Problem

Japan requires **shaken (車検)** vehicle inspection every 2 years; operating a car
with expired shaken is illegal, and insurance has its own renewal date. Today the
platform **stores and displays** these dates but does nothing else:

- No operator is **notified** when a deadline approaches or passes — the data is
  pull-only (operator must open the fleet page and read a badge).
- An **expired-shaken car is still fully bookable and rentable** — neither renter
  search, availability, nor booking creation checks the dates.

This is a legal/liability gap, not a UX nicety. With 40–50 cars, tracking renewals
by eyeballing badges does not scale.

## 2. What exists today (do NOT rebuild)

| Capability | Location |
|---|---|
| `shakenExpiryDate`, `insuranceExpiryDate` columns | `packages/shared/src/db/schema.ts` (`vehicles`) |
| `computeExpiryStatus(date, todayIso)` → `OK / EXPIRING_SOON (30d) / EXPIRED / UNKNOWN` | `packages/shared/src/lib/expiry.ts` |
| Expiry badge/cells, "expiring soon" fleet filter, summary bar | `packages/web/src/vite/operator-fleet/*` (`cells.tsx`, `FleetSummaryBar.tsx`, `FleetFilters.tsx`), `lib/fleet-filters.ts` |
| Notification pipeline (idempotent log → claim → render → send) | `packages/api/src/services/notification-dispatcher.ts` |
| Email sender (Resend) + templates | `packages/api/src/services/email/*` |
| Active-member fan-out (operator → all active members, Bcc) | `resolveActiveMemberEmails`, `operator-membership` repo |
| Vehicle status enum: `AVAILABLE | MAINTENANCE | RETIRED` | `schema.ts`, `validators/vehicle.ts` |

## 3. Goals / Non-goals

**Goals**
1. **Block** booking/rental of a vehicle whose shaken or insurance is expired.
2. **Block at booking time** any reservation whose rental period runs past either expiry.
3. **Notify** all active operators of upcoming and passed expiries (email + in-app).
4. Apply identically to **shaken and insurance**.

**Non-goals (YAGNI)**
- Per-operator configurable thresholds (30/14/7/1 is fixed; revisit if asked).
- Document image upload / OCR of the shaken certificate.
- Auto-renewal, payment, or any integration with an inspection vendor.
- Per-location timezone handling for the digest (all ops are Japan/JST; reuse #680/#818 stance).

## 4. Key decisions

| # | Decision | Choice |
|---|---|---|
| D1 | On expiry | **Auto-disable**: non-bookable + hidden from renter search; auto-re-enables when the date is updated. |
| D2 | Booking-time guard | **Block**: reject a create whose JST return date is **after** (`>`) shaken/insurance expiry. |
| D3 | Notification channels | **Both** scheduled email digest **and** in-app banner. |
| D4 | Scope | **Shaken + insurance**, treated identically. |
| D5 | Listing prerequisite | **Require** valid, future-dated shaken + insurance at vehicle create (validator). DB column stays nullable — legacy/lapsed rows tolerated, gated out by D1. |

### D1 refinement — derived gate, NOT a `status` mutation

The chosen "auto-disable" is implemented as a **derived compliance gate**, not by
writing `vehicles.status`. Rationale:

- The enum has **no "disabled" value**; flipping `AVAILABLE → MAINTENANCE` is
  semantically wrong and **lossy** (it clobbers the operator's manual intent and
  cannot auto-reverse cleanly when the date is renewed).
- A pure predicate is auto-reversible, needs **no migration**, and keeps `status`
  meaning exactly what the operator set.

```
bookable(vehicle, asOf) :=
  vehicle.status === 'AVAILABLE'
  && isDocCurrent(vehicle.shakenExpiryDate, asOf)
  && isDocCurrent(vehicle.insuranceExpiryDate, asOf)

isDocCurrent(date, asOf) := date != null && date >= asOf   // UNKNOWN (null) = NOT road-legal (§11.1)
```

**Time basis — one clock per evaluation (fixes policy-drift between gates).** `asOf`
is the JST date the car must be road-legal *for*. **Availability (list + direct),
booking create, and substitution all pass the requested rental-end (`to`/`endAt`) JST
date** — so a future-dated search never surfaces a car whose docs lapse before `to`
only for create to then reject it. (Plain catalog browsing with no window uses today.)
The **digest/banner** are a *different* question — "when does it expire" — and use
today + the threshold bands, not `asOf`.

**Boundary (legal meaning, fixed once).** A shaken/insurance certificate is valid
**through** its printed expiry date — expired only the day *after*. Therefore
`isDocCurrent` uses `>=` — valid *through* the date — (consistent with
`computeExpiryStatus`, which marks expired only when `date < today`), and the
booking/substitution guard rejects when
the **JST calendar date of the rental end (`endAt`) is *after* expiry** — a return
*on* the expiry date is allowed (`> expiry`, not `>= expiry`).

A **missing** date (UNKNOWN) is **not** road-legal for gating: a car with no
recorded shaken/insurance is never searchable or bookable (§11.1 — a marketplace
listing must be a valid, road-legal car). The 4-state `ExpiryBadge` still shows
`UNKNOWN` to operators; only the binary bookable-gate collapses UNKNOWN to non-compliant.

> **Learn: Anemic Domain Model / derived state.** "Disabled-because-expired" is a
> *computed* fact, not stored state. Storing it (a status flip) forces a lossy
> write + a reverse-write and a place for them to drift. Heuristic: if a flag can
> be computed from data you already hold, derive it — don't persist it.

The same visible outcome as a status flip (blocked + hidden), without the costs.

## 5. Architecture

Six units, each independently testable. Import direction respected
(routes → services → repositories; shared has no runtime deps).

### 5.0 Create-time requirement (validator) — `createVehicleSchema` (D5)
- `shakenExpiryDate` and `insuranceExpiryDate` move from `.nullish()` to **required and
  future-dated** in `packages/shared/src/validators/vehicle.ts` — a vehicle can't be
  created without valid docs (clear 400 at the boundary, not a silently invisible car).
- The **DB column stays nullable** — no NOT NULL migration; legacy rows and cars whose
  docs later lapse are tolerated and handled by the D1 derived gate.
- `updateVehicleSchema` keeps them editable for renewal; a renewal must also be future-dated.

### 5.1 Compliance predicate (shared, pure) — `@kuruma/shared/lib/compliance`
- `isDocCurrent(date, asOf)` and `isRoadLegal(vehicle, asOf)` (`asOf` per §4 time basis).
- Built on the existing `computeExpiryStatus`; no new date math.
- Exported for both API (gate + guard) and web (banner/labels).

### 5.2 Availability gate — BOTH endpoints (API)
`AvailabilityService` is the single compliance decision point so the list and the
direct-lookup paths can never diverge:
- **List** (`findAvailableVehicles` → `repositories/drizzle/availability.ts`, currently
  `eq(vehicles.status, 'AVAILABLE')`): add predicates requiring both docs **valid
  through the requested `to` JST date** (`shakenExpiryDate >= to AND insuranceExpiryDate
  >= to`, NULL non-compliant) to the SQL `where` — the **same clock** as direct/create
  (§4 time basis), so a future-dated search never surfaces a car whose docs lapse before
  `to` only for create to reject it.
- **Direct** (`/availability/:vehicleId` → `checkVehicleAvailability`, `availability.ts:39`):
  today only checks booking conflicts, so an expired car still returns
  `available: true`. The service overrides the result to **unavailable** when the
  returned vehicle row is not road-legal **for the requested `to` JST date** — no extra
  query (the repo already returns the vehicle row, which carries the expiry columns).
- Mirror the list predicate in the in-memory availability repo so unit tests stay infra-agnostic.

### 5.3 Booking-time guard (API service) — `services/booking.ts` create path
- After the vehicle is resolved, before insert: if the **JST date of `endAt` is
  after** `shakenExpiryDate` or `insuranceExpiryDate` (`> expiry`, per §4 boundary)
  → `400 VEHICLE_DOCS_EXPIRE_BEFORE_RETURN`. Compare calendar dates: `endAt` is a
  `timestamptz`, expiry is a `date`; project `endAt` to its JST day first.
- Covers the future-booking legal case (a date the car won't be road-legal for),
  which the today-only gate misses.
- Applies to **all** create paths: renter instant-book + operator manual booking + walk-in.

### 5.3b Substitution enforcement (API service) — `booking-lifecycle.ts`
Substitution selects and assigns a vehicle on a path independent of create, so the
gate must live here too — otherwise the rule silently lapses (policy drift):
- **`substitute()`** (`:78`): after the existing status/location/class checks, reject
  when the replacement is not road-legal for the booking's `endAt` JST date
  → `400` ("Replacement vehicle's shaken/insurance expires before the booking ends").
- **`findSubstitutionCandidates()`** (`:204`): add the same road-legal-through-`endAt`
  predicate to the candidate `.filter(...)` so expired cars never surface as options.

> **Learn: Policy Drift.** A legal/safety gate implemented only on the "main" path
> quietly stops being a rule. Heuristic: enforce it on *every* transition that can
> select or assign the resource — create, substitute, and the candidate list alike.

### 5.4 Scheduled digest (API — new cron + service)
**Cron handler.** `worker.ts` default-exports `Sentry.withSentry(...)(handler)` where
`handler = { fetch }`. Add a **`scheduled(controller, env, ctx)` method to that same
`handler` object** (NOT a parallel unwrapped export) so the cron keeps Sentry's async
context and the lazy `getApp()` memoisation. Add a `triggers.crons` entry to the API
wrangler config — **`crons = ["0 23 * * *"]`** (daily 23:00 UTC = 08:00 JST). The handler
resolves the DI-composed `ComplianceDigestService` from the composition root (the same
source routes use) and runs it.

**`ComplianceDigestService`.** For every operator with vehicles whose shaken/insurance
hits a threshold band (`30 / 14 / 7 / 1` days out, or `EXPIRED`):
- Resolve recipients by **reusing the active-member fan-out** (extract the
  `membershipRepo + userRepo → emails` helper currently private to the dispatcher
  so both callers share it — see §6).
- Render a new **`renderComplianceDigest`** email template (one mail per operator,
  listing each vehicle + document + days-remaining), send via `EmailSender`.
- **Idempotency:** one alert per `(vehicleId, documentType, thresholdBand)` — never
  re-send the same band on subsequent daily runs (see §6 for where this is recorded).

**In-app feed.** The same computed list backs an operator API route
(`GET /operator/compliance/alerts` or fold into fleet-overview) for the banner.

### 5.5 In-app banner (web)
- Operator dashboard / fleet page banner: "N vehicles need attention" linking to a
  filtered fleet view (reuse the existing "expiring soon" filter + expiry cells/badge
  under `packages/web/src/vite/operator-fleet/`).
- Pure presentation over the §5.4 feed / existing fleet-overview data; no new date logic.

## 6. Notification plumbing — the one real fork

`NotificationDispatcher` is **booking-centric**: every method takes a `Booking`,
and `notification_log` rows are keyed by `bookingId`. A compliance alert is
**vehicle/operator-coupled** and has no booking. Options:

- **A. Generalize `notification_log`** (make `bookingId` nullable, add `vehicleId`,
  branch the dispatcher). Unifies the ledger but mutates the hot booking-notification
  path + its schema — higher blast radius.
- **B (recommended). Dedicated compliance ledger.** New small table
  `compliance_alert_log (vehicleId, documentType, thresholdBand, sentAt, recipient)`
  with a unique key on `(vehicleId, documentType, thresholdBand)` for idempotency.
  Reuse only the **leaf mechanics**: the extracted member-fan-out helper, `EmailSender`,
  and a new template. The booking dispatcher is **untouched**.

Recommendation: **B** — keeps two unrelated concerns (booking lifecycle vs. fleet
compliance) in separate ledgers, each independently queryable, and avoids a risky
migration of a path that just had a production incident (#887).

> **Learn: Bounded Context.** "Notification" means two different things here — a
> per-booking lifecycle event vs. a recurring fleet-compliance reminder. Forcing
> both through one booking-keyed table is a Bounded Context Violation. Heuristic:
> when the same word needs a different primary key, it's two models.

## 7. Data model changes

- **No change to `vehicles`** (dates already exist; status stays operator-owned).
- **New `compliance_alert_log`** table (option B). Drizzle migration via the standard
  `db:generate → db:migrate → db:verify` flow; new table only, append-only, no
  back-fill. Mirror in the in-memory store for unit tests.

## 8. Error codes / contracts

| Code | HTTP | When |
|---|---|---|
| `VEHICLE_DOCS_EXPIRE_BEFORE_RETURN` | 400 | Create: JST `endAt` date is *after* shaken/insurance expiry |
| Replacement-expires message | 400 | `substitute()`: replacement not road-legal through `endAt` |
| (gate) | — | Expired vehicles silently absent from search **and direct** availability (not an error) |

## 9. Testing strategy

- **Pure unit:** `isDocCurrent` / `isRoadLegal` boundary cases (asOf == expiry,
  null, far future); threshold-band mapping for the digest.
- **Validator (D5):** create rejects missing or past-dated shaken/insurance; a
  future-dated create succeeds; renewal via update must be future-dated.
- **Integration (real pg):** list **and direct** availability both exclude/mark an
  expired vehicle; booking-create guard returns 400 for an end-after-expiry period and
  201 within expiry — including the boundary (return *on* the expiry date = allowed);
  `substitute()` rejects an expired replacement and `findSubstitutionCandidates`
  omits it; digest idempotency (two consecutive runs → exactly one alert per band).
- **Service:** `ComplianceDigestService` fans out to all active members; no alert
  for a vehicle with no threshold crossing.
- **Web:** banner renders the count; links to the filtered fleet view.
- Mutation-resistant assertions (exact codes, exact recipient sets), per house rules.

## 10. Slicing (vertical, independently shippable)

1. **Slice 1 — Enforcement (highest value, legally urgent).** Create-time requirement
   (§5.0) + compliance predicate (§5.1) + availability gate on BOTH endpoints (§5.2) +
   booking-time guard (§5.3) + substitution guard & candidate filter (§5.3b) + tests.
   Ships the "an expired car can't be created, booked, rented, OR substituted in" guarantee.
2. **Slice 2 — Scheduled digest.** Cron handler + `ComplianceDigestService` +
   `compliance_alert_log` + template + member-fan-out extraction (§5.4, §6, §7).
3. **Slice 3 — In-app banner.** Operator feed route + web banner (§5.5).

## 11. Resolved decisions (2026-06-16)

1. **NULL expiry (UNKNOWN) → not road-legal.** A car with no shaken/insurance date is
   excluded from search and unbookable — a marketplace listing must be a valid,
   road-legal car. Legacy null rows stay hidden until backfilled; the digest flags them
   as `missing dates`.
2. **Required at create (D5, §5.0).** Shaken + insurance are required and future-dated in
   `createVehicleSchema`; the DB column stays nullable (no NOT NULL migration — legacy
   and lapsed rows tolerated, gated by D1).
3. **Digest cadence: daily, idempotent.** One run per day; an operator is emailed only
   when a vehicle *newly* crosses a 30/14/7/1/expired band, so a quiet fleet sends zero mail.
4. **Cron time: 08:00 JST** (`0 23 * * *` UTC), §5.4.
