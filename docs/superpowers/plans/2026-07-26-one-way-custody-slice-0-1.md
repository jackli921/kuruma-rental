# One-Way Custody Network — Slice 0 + Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Plan rev.4** (2026-08-02) — folded the plan-rev.3 review (2 P0 + 6 P1) against **spec rev.8**. The finding→task map is in "rev.4 changes at a glance" below; the rev.3 map is kept for history.

**Goal:** Implement Slice 0 (pure custody state machine + Q3-strict feasibility predicate) and Slice 1 (same-operator homeward one-way rentals: movement legs, receipt gate with configurable checklist, custody periods at rate 0, cancellation recovery, substitution/assignment legs, archival guard, staff reposition, promo-home, shared predicate on search + checkout) of the one-way custody network design.

**Spec (source of truth):** `docs/superpowers/specs/2026-07-26-one-way-custody-network-design.md` (rev.8).

**Architecture:** Pure Functional Core in `packages/shared/src/lib/` (fold + feasibility + custody transitions + fingerprint), imperative shell in `packages/api` (drizzle tables with full DB seals incl. state⇔reference FKs, repos behind ports, services orchestrating under a per-vehicle advisory lock inside `runInTransaction`), web surfaces in `packages/web` (operator custody actions, renter dropoff picker). Everything behavior-changing is dark behind one runtime flag `ONE_WAY_CUSTODY`; recovery operations are state-driven and never gated (§14.1).

**Tech stack:** Bun workspaces, Drizzle + Neon Postgres, Hono on CF Workers, TanStack Router + React + TanStack Query, vitest, Playwright.

---

## Plan-level decisions (concretizations of the spec — surface at review if any looks wrong)

1. **One flag, outbound-only gating (§14.1).** Registry flag `ONE_WAY_CUSTODY` (web flag with `env: 'VITE_FEATURE_ONE_WAY_CUSTODY'`, `runtimeControlled: true`, read server-side like `OPERATOR_TERMS` — `packages/api/src/index.ts:433-438`). While OFF: no one-way bookings (dropoff ≠ pickup ⇒ 404-style rejection), no promo mutations. Never gated: departing/receiving existing legs, staff repositions (always homeward — decision 18), the listing-hold toggle. A kill-switch must never strand a displaced or `IN_TRANSIT` car.
2. **Flag-off equivalence instead of flag-conditional search SQL.** The availability repo *always* uses the new custody columns; the backfill (Task 6) plus the vehicle-service sync rule (Task 12) make them degenerate to today's behavior while OFF (`physicalLocationId ≡ pickupLocationId`, no legs, `heldOffline=false`). The OFF booking path is additionally **kill-safe**: it requires the car custody-listable, at home when tracked, **and clean under §8 rules 3–4 over its live legs** (the search SQL folds legs unconditionally — a checkout that didn't would accept what search hides and manufacture stranded schedules for the Task 22 fence to trip over). Byte-equivalent while never-flipped (no legs exist), correct (displaced/committed cars unbookable) after a kill.
3. **`custodyState` is NULLABLE** (= "custody-untracked", spec §13). `vehicles.pickupLocationId` is nullable today (`fleet.ts:105`); untracked cars behave exactly as today. Assigning a home base is the tracking on-ramp: it initializes `AT_STATION` at home **plus a baseline custody period**, atomically (Task 12).
4. **`voidedAt` column on `movement_legs`** (spec §4): nullable timestamp, only while un-departed (CHECK-sealed); keeps the table append-only-ish and drops the leg from every fold. Set by pre-departure cancel and pre-departure substitution.
5. **The fold is seeded by the materialized present.** The pure predicate takes `(physicalLocationId, pending legs)` — `projectedLocationAt(current, pendingLegs, t)` — not full-history replay. Under rev.7 §8 the projection **only excludes**: any live leg settling before the window that lands anywhere else makes the car bookable **nowhere** for that window (its destination is unreceived, Q3-strict). There is no promoted-destination search and no widened prefilter.
6. **`packages/shared/src/lib/one-way.ts` is superseded and deleted** (zero production importers — verified 2026-07-26). The #882 promotion half (advance chaining at destinations) is **removed by rev.7 §8**, so nothing replaces it; the fold survives only as §8 rules 3–4.
7. **Promo-home = two nullable vehicle columns** (`homewardPromoPercent`, `homewardPromoCutoffAt`). Applies only when the booking lands the car at its home base **by the cutoff — compared against the booking's arrival (`effectiveEndAt <= cutoffAt`), never the creation clock** (spec §9); cleared automatically on a receipt at home.
8. **Receipt photos go through a private `ReceiptStorage` port** (R2 binding `HANDOFF_RECEIPTS`, streamed through the Worker, never public). **Photos are checklist-conditional (spec Q5)** — an environment without the bucket can still run custody with a minimal checklist; `DisabledReceiptStorage` only throws if a photo is actually uploaded.
9. **The per-vehicle advisory lock does not exist yet** — `drizzle/0082` *claims* it does but only `lockComboCapacity` exists (`drizzle/availability.ts:191-203`). Task 8 adds `lockVehicleTimeline(vehicleId)`; every timeline mutation takes it. Two-vehicle operations lock in ascending `vehicleId` order; where the combo lock is also held: combo first, then vehicle(s) (§4 — the one documented order).
10. **Every booking gets a movement leg while the flag is ON** — round trips included. A `CLASS_COMBO` float gets its leg **at assignment**; pre-departure substitution voids the old leg and creates the replacement's planned leg; **ACTIVE substitution/assignment compose create-planned + depart in one transaction** — the §5 depart transition stays the only writer of `departedAt` (no leg is ever born departed). Consequence while ON: a car is `IN_TRANSIT` during any active rental and every return needs a receipt (after completion) to relist — the owner-locked Q3 model.
11. **DEPARTURE receipts:** the depart transition writes a **mandatory minimal `DEPARTURE` receipt for `STAFF_REPOSITION`/`TRANSFER` legs in the same transaction** (who/where/when — §5); `RENTAL` departure evidence is optional in v1 (existing pickup-verification flow). Departure-capture UI for rentals is Slice 2.
12. **Custody scoping is service-level** (like `ConsentRepository`): custody ports take explicit ids, not `CallerContext`; routes/services enforce fleet-write + tenant binding first. **Slice 1 receive-authorization note (spec §5.1):** every Slice-1 actor is the owner's staff, and the tenant-bound location check already pins the receipt to the leg's `toOperatorId` (same operator); the leg-derived foreign-host capability is Slice 2.
13. **Receipt checklist model (spec Q5).** `RECEIPT_CHECKLIST_ITEMS = ['PHOTOS','FUEL','ODOMETER','DAMAGE_NOTES']`. Owner config = `operators.receiptChecklist text[] NOT NULL DEFAULT '{}'` (empty = minimal core only — the v1 default). The §5 depart transition snapshots it onto the leg (`movement_legs.checklistSnapshot`); the receive service enforces the **snapshot** (400 `RECEIPT_CHECKLIST_INCOMPLETE` naming the missing items). A `NULL` snapshot (dark-era/synthesized legs) = minimal core.
14. **Request fingerprints (spec §6).** `requestFingerprint(payload)` = SHA-256 hex over a key-sorted canonical JSON (pure helper, `lib/request-fingerprint.ts`). Replay resolution: same `idempotencyKey` + same fingerprint ⇒ return the prior row; same key + different fingerprint ⇒ 409 `IDEMPOTENCY_MISMATCH`. Photo storage keys are excluded from the fingerprint (they regenerate per upload); the **sorted SHA-256 content hash of each photo** is included (`photoHashes` — a count would let a reused key return evidence for different images; rev.4).
15. **Tail rule — now spec §8 rule 6 (owner-approved as enforcement, not policy).** Rule 3 guarantees every live leg's own anchor stays valid — but only if creates cannot invalidate it retroactively. A one-way inserted **before** an existing future leg would strand that leg's pickup. So a one-way (dropoff ≠ pickup) is feasible only when no live leg occupies at/after the window's end (`ONEWAY_NOT_TAIL`); round trips are exempt. This is #882's TAIL_ONLY; the FULL_CHAIN dial is dropped (YAGNI). The same fold gates the Task 22 cutover synthesis.
16. **State⇔reference seals land in a custom migration.** `vehicles.inFlightLegId`/`openCustodyPeriodId` FK into `movement_legs`/`custody_periods`, which FK back into `vehicles` — drizzle modules would import each other circularly. The columns are bare in `fleet.ts`; the two composite FKs + the three-way CHECK + the receipt endpoint-match trigger + **the rev.4 lifecycle triggers (§3: referenced leg in flight / referenced period open, both directions) and the leg-endpoint update guard (§6)** are one hand-written migration (Task 5 Step 5c); **the home-base⇒tracked trigger (§13) lands in the Task 6 backfill migration, after the backfill UPDATE** (adding it earlier would fail old-code writes to not-yet-backfilled rows). Drizzle never diffs custom SQL, so no snapshot drift.
17. **The booking's current leg is identified by (bookingId, vehicleId).** The §4 seal is `UNIQUE(bookingId, vehicleId) WHERE bookingId IS NOT NULL AND voidedAt IS NULL` — an ACTIVE substitution legitimately leaves TWO live legs on one booking (old car's detached recovery + new car's current). Every "the booking's leg" read is `findLiveByBookingAndVehicle(bookingId, booking.assignedVehicleId)`.
18. **Staff reposition is home-only and never flag-gated (spec §9 rev.8).** The service takes NO destination — it is always the car's current home base (`vehicle.pickupLocationId`); the UI is a confirm-only "Send home" dialog. Every reposition is homeward recovery, so the §14.1 flag gate on repositions disappears entirely. A deliberate outward move = re-label home (§9) then reposition home — two explicit steps, capability preserved. `TRANSFER` stays script/admin-only.
19. **Leg idempotency keys carry a traversal generation (spec §4 rev.8).** Booking-driven legs use `booking:<bookingId>:<vehicleId>:g<n>` where `n = countByBookingAndVehicle(bookingId, vehicleId)` (all states, counted inside the tx under the vehicle locks). A voided leg keeps its key, so the static `booking:<id>:<vehicleId>` form permanently jams an X→Y→X→Y swap sequence. Retry safety is service-level: substitution/assignment whose target already equals `booking.assignedVehicleId` no-ops before creating anything.
20. **Receipt commands preflight before any photo upload (spec §6 rev.8).** Order: resolve tenant + load vehicle (404) → replay-resolve the idempotency key (fingerprint compare) → in-flight-leg existence — all BEFORE `receiptStorage.put`. The locked tx re-checks everything; orphaned keys now require a true race/crash, not a bad request. `setReceiptChecklist` rejects enabling `PHOTOS` while `receiptStorage.isConfigured()` is false (400) — no obligation the receiver cannot satisfy.
21. **Seeds place their own vehicles (spec §13 rev.8).** `scripts/seed.ts` writes `AT_STATION` + baseline periods for every vehicle it inserts with a home base (Task 6 Step 2b) — seed runs after migration, so the backfill cannot cover it. Vehicle-service create places in the SAME transaction as the insert. The §13 trigger makes any straggler a hard failure instead of a car search lists but checkout rejects.

## rev.4 changes at a glance (plan-rev.3 review finding → where it landed)

| # | Finding | Spec | Plan tasks |
|---|---|---|---|
| P0-A | Cutover could synthesize an impossible (stranded) schedule | §14.1 validate-before-write fence; §8 rule 6 | 22 (validation pass + per-vehicle tx under lock), 15 (OFF path folds legs) |
| P0-B | Seeded cars untracked → search lists, checkout rejects | §13 self-placing seeds + home-base⇒tracked trigger + atomic create | 6 (trigger after backfill + Step 2b seed), 9 (case 20), 12 (same-tx create), 21 (pre-assert) |
| P1-C | FKs prove ownership, not lifecycle state; endpoint trigger one-directional | §3 lifecycle triggers; §6 bidirectional endpoint guard | 5 (Step 5c), 9 (cases 17–19) |
| P1-D | `departVehicleInTx` could commit partially (ACTIVE booking, car AT_STATION) | §5 validate-first, all-or-nothing | 13 (Step 1 rewrite), 14 |
| P1-E | Placement / re-label / receipt / re-target skipped the location FOR SHARE | §4 widened FOR SHARE rule | 12 (placement + sync + re-label), 13 (receive) |
| P1-F | Reposition exceeded "bring it home" (arbitrary destination + UI selector) | §9 home-only, never gated; §14.1 scrubbed | 13, 18 (schema), 19 (confirm-only dialog) — decision 18 |
| P1-G | Substitution idempotency keys jam X→Y→X→Y | §4 generation keys | 7 (`countByBookingAndVehicle`), 14, 15 — decision 19 |
| P1-H | Photo replay under-bound; uploads before auth; PHOTOS w/o bucket | §6 photo hashes + preflight + storage guard | 2 (fingerprint doc), 11 (`isConfigured`), 13, 18 — decision 20 |

## rev.3 changes at a glance (rev.6 review finding / rev.7 correction → where it landed)

| # | Finding / correction | Spec | Plan tasks |
|---|---|---|---|
| P0-1 | Projected-destination search violated Q3 | §8 anchor-only, projection excludes | 4, 15, 16 |
| P0-2 | ACTIVE substitution vs the live-leg unique seal | §4 `(bookingId, vehicleId)` + §5 compose create+depart | 5, 7, 9, 14 |
| P0-3 | `allowedDropoffs` excluded cross-operator hosting | §7 receiving set split from owner set | 3, 4, 15, 18 |
| P0-4 | Arrival authz cannot use current custody while `IN_TRANSIT` | §5.1 leg-derived | 13 (decision 12 note; Slice 2 for foreign hosts) |
| P1-5 | Kill-switch stranded parked displaced cars | §14.1 outbound-only gating + cutover fence | 13, 15, 18, 22 |
| P1-6 | Bootstrap/storage incomplete | §13 untracked NULL + baseline periods + on-ramp | 5, 6, 12 |
| P1-7 | "DB-enforced" only partial | §3 state⇔reference FKs + three-way CHECK; §6 endpoint trigger; §4 FOR SHARE | 5, 9, 15, 17 |
| P1-8 | Evidence semantics incomplete | §6 fingerprints + mandatory reposition departure receipt | 2, 5, 7, 13 |
| C-1 | No ferry product — internal staff reposition | §4/§9 `STAFF_REPOSITION` | 2, 5, 13, 18, 19 |
| C-2 | Minimal receipt core + configurable checklist, no photo CHECK | §6 / Q5 | 5, 7, 13, 18, 19, 21 |
| C-3 | v1 combo scope decided: displaced stays SPECIFIC-only | §8 / Q6 | 16 (pool excludes displaced) |

## Execution context (read once, applies to every task)

- **Worktree:** `git worktree add ../kuruma-custody -b feat/one-way-custody-slice-0-1 origin/develop && cd ../kuruma-custody && bun install`. All paths below are relative to the worktree root.
- **Local DB for migration/integration tasks:** disposable docker Postgres, NOT the shared dev DB:
  `docker run -d --name kuruma-custody-pg -p 5499:5432 -e POSTGRES_USER=kuruma -e POSTGRES_PASSWORD=kuruma -e POSTGRES_DB=kuruma_custody postgres:16`
  then for every db/integration command: `DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody"`. Apply all existing migrations first (`bun run db:migrate`). Tear down at the end: `docker rm -f kuruma-custody-pg`.
- **api unit tests must run WITHOUT `DATABASE_URL`** (setting it flips composition to real-DB mode and fails ~9 in-memory route tests). Integration tests (`packages/api/tests/integration`) REQUIRE it.
- **Migration workflow** (CLAUDE.md, mandatory): `bun run db:generate --name <name>` → `bun run db:migrate` → `bun run db:verify` (3 green checks). Hand-written SQL only via `bun run db:generate --custom --name <name>`. Never edit merged migrations; never hand-rename one. Migration numbers below say `01NN` — use whatever `db:generate` assigns.
- **Commit style:** conventional commits, no co-author, one commit per task step-group as written.
- **Lints that will bite:** `bun run --filter @kuruma/api lint:boundaries` (routes→services→repositories), `bun run lint:size` (800 hard cap — `repositories/types.ts` is AT 800, `index.ts` at 762: new ports go in `types-custody.ts`, new wiring goes through a `composition/` builder), `lint:fk-indexes` (every FK's leading column needs an index), `lint:tenant-anchor-immutability`, `lint:i18n-parity` (3 locales), `lint:modules` (web barrels), biome (run `bun run lint` before every push, not just husky's staged check).
- **Key file anchors** (verified 2026-07-26): vehicles table `packages/shared/src/db/fleet.ts:87-192`; operators `db/auth.ts`; locations `db/location.ts:37-98` (`locations_operatorId_id_unique` :91); bookings `db/booking.ts:51-213`; enums `packages/shared/src/enums.ts`; availability predicate `packages/api/src/repositories/drizzle/availability.ts:49-88` (static location filter :78) with in-memory mirror `in-memory/availability.ts`; booking create `packages/api/src/services/booking-creation.ts` (`submitInTx` :253, pickup equality :331, `resolveDropoffEffectiveEnd` :226-246, combo lock :354-375, `submitSpecificInTxLocked` :378, class capacity gate :420-442); lifecycle `packages/api/src/services/booking-lifecycle.ts` (`updateStatus` :408, renter `cancel` :495, `substitute` :93/:105, `assignVehicle` :250/:267); search display mapping `packages/api/src/services/flat-search.ts:181` (SPECIFIC `toSpecific` keys off `pickupLocationId`) + `packages/api/src/services/storefront-search.ts:157` (`groupByLocation` same); location archive `packages/api/src/services/location.ts:209-240`; tx bundle `packages/api/src/repositories/types-transactions.ts` + `repositories/drizzle/transaction.ts`; composition `packages/api/src/composition/repositories.ts`; flag registry `packages/shared/src/feature-flags/registry.ts`; error codes `packages/shared/src/lib/error-codes.ts` (+ membership test); wizard `packages/web/src/vite/reservation/ReservationWizard.tsx:107-115`; fleet actions `packages/web/src/vite/operator-fleet/FleetRowActions.tsx:106-115`.

## File structure (what gets created/modified where)

```
packages/shared/src/enums.ts                          MODIFY  custody enums + checklist items
packages/shared/src/lib/custody-state.ts              CREATE  pure transitions + listability      (+ .test.ts)
packages/shared/src/lib/custody-timeline.ts           CREATE  PendingLeg, fold, overlap, dropoff policy (+ .test.ts)
packages/shared/src/lib/custody-feasibility.ts        CREATE  assessOneWayFeasibility (§8)        (+ .test.ts)
packages/shared/src/lib/request-fingerprint.ts        CREATE  canonical SHA-256 fingerprint       (+ .test.ts)
packages/shared/src/lib/one-way.ts                    DELETE  superseded (+ tests/lib/one-way.test.ts)
packages/shared/src/db/fleet.ts                       MODIFY  vehicles custody columns (+ bare state-ref cols)
packages/shared/src/db/auth.ts                        MODIFY  operators.receiptChecklist
packages/shared/src/db/custody.ts                     CREATE  movement_legs, custody_periods, handoff_receipts
packages/shared/src/db/schema.ts                      MODIFY  export * barrel line
packages/shared/src/validators/custody.ts             CREATE  zod for custody routes
packages/shared/src/feature-flags/registry.ts         MODIFY  ONE_WAY_CUSTODY entry
packages/shared/src/lib/error-codes.ts                MODIFY  8 new codes (+ membership test)
drizzle/01NN_one_way_custody_schema.sql               GENERATE
drizzle/01NN_custody_state_reference_seals.sql        CUSTOM  vehicles state⇔reference FKs + three-way CHECK + endpoint trigger
drizzle/01NN_receipts_append_only_grants.sql          CUSTOM  #1556-style role-separation immutability
drizzle/01NN_backfill_vehicle_custody.sql             CUSTOM  backfill + baseline custody periods
packages/api/src/repositories/types-custody.ts        CREATE  ports
packages/api/src/repositories/in-memory/{movement-leg,custody-period,handoff-receipt}.ts  CREATE
packages/api/src/repositories/drizzle/{movement-leg,custody-period,handoff-receipt}.ts    CREATE
packages/api/src/repositories/types-storage.ts        MODIFY  ReceiptStorage port
packages/api/src/repositories/r2-receipt-storage.ts   CREATE  (+ in-memory/receipt-storage.ts, disabled-receipt-storage.ts)
packages/api/src/repositories/types-transactions.ts   MODIFY  bundle gains custody repos + locks
packages/api/src/repositories/drizzle/transaction.ts  MODIFY  rebind custody repos per-tx
packages/api/src/repositories/types.ts                MODIFY  re-export lines only (stay ≤800!)
packages/api/src/pg-errors.ts                         MODIFY  named constraint consts
packages/api/src/services/custody-motion.ts           CREATE  shared in-tx depart/void helpers
packages/api/src/services/custody.ts                  CREATE  CustodyService (+ .test.ts)
packages/api/src/services/vehicle.ts                  MODIFY  placement (baseline period) / sync / relabel rule
packages/api/src/services/booking-creation.ts         MODIFY  predicate + leg insert + promo + capacity-gate skip
packages/api/src/services/booking-lifecycle.ts        MODIFY  depart / void / recovery + substitution/assignment leg hooks
packages/api/src/services/flat-search.ts              MODIFY  SPECIFIC display via physical location
packages/api/src/services/storefront-search.ts        MODIFY  card grouping via physical location
packages/api/src/services/location.ts                 MODIFY  archival guard (atomic conditional UPDATE)
packages/api/src/routes/custody.ts                    CREATE  custody routes (+ tests)
packages/api/src/composition/custody-service.ts       CREATE  builder (index.ts cap protection)
packages/api/src/composition/repositories.ts          MODIFY  wire repos + ReceiptStorage
packages/api/src/app-overrides.ts                     MODIFY  test override slots
packages/api/src/index.ts                             MODIFY  mount routes (lean — builder does the rest)
packages/api/wrangler.toml                            MODIFY  HANDOFF_RECEIPTS binding (commented in prod)
packages/web/src/vite/operator-fleet/{CustodyBadge,ReceiveVehicleDialog,RepositionDialog,ListingDialog,PromoHomeDialog,ChecklistSettingsDialog}.tsx  CREATE
packages/web/src/vite/operator-fleet/{api.ts,FleetRowActions.tsx,FleetTable.tsx,FleetVehicleCard.tsx}  MODIFY
packages/web/src/vite/reservation/{DropoffSelect.tsx,homewardApi.ts}  CREATE
packages/web/src/vite/reservation/ReservationWizard.tsx  MODIFY  dropoff state + promo estimate
packages/web/messages/{en,ja,zh}.json                 MODIFY  i18n keys
e2e/real-db/one-way-custody.auth.spec.ts              CREATE
playwright.real-db.config.ts                          MODIFY  VITE_FEATURE_ONE_WAY_CUSTODY
scripts/backfill-movement-legs.ts                     CREATE  flip runbook script (before AND after each flip)
scripts/seed.ts                                       MODIFY  place seeded vehicles (baseline periods, §13)
```

---

## Phase 0 — Setup

### Task 1: Worktree + baseline

**Files:** none (environment only).

- [ ] **Step 1: Create the worktree and install**

```bash
git worktree add ../kuruma-custody -b feat/one-way-custody-slice-0-1 origin/develop
cd ../kuruma-custody && bun install
```

- [ ] **Step 2: Start the isolated DB and migrate**

```bash
docker run -d --name kuruma-custody-pg -p 5499:5432 -e POSTGRES_USER=kuruma -e POSTGRES_PASSWORD=kuruma -e POSTGRES_DB=kuruma_custody postgres:16
sleep 3
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:migrate
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:verify
```

Expected: migrate applies all existing migrations; verify shows 3 green checks.
(If darwin one-tx rollback makes `db:migrate` exit 1, apply `drizzle/*.sql` via `docker exec -i kuruma-custody-pg psql -U kuruma -d kuruma_custody` — known local quirk, CI migrates fine.)

- [ ] **Step 3: Baseline verify**

```bash
bun run --filter @kuruma/shared test && bun run --filter @kuruma/api test
bunx tsc -p packages/api --noEmit
```

Expected: green (no `DATABASE_URL` in env for the unit run). Commit nothing.

---

## Phase 1 — Slice 0: pure core (`packages/shared/src/lib`)

Spec §14 Slice 0: custody state machine (§3/§5) + the §8 feasibility predicate + `allowedDropoffs` (§7). Pure, no I/O, exhaustively unit-tested. No cost fold (day-count/rounding open, §16.7 — Slice 2).

### Task 2: Custody enums + pure state machine + fingerprint helper

**Files:**
- Modify: `packages/shared/src/enums.ts` (append near the other status sets)
- Create: `packages/shared/src/lib/custody-state.ts` (+ `custody-state.test.ts`)
- Create: `packages/shared/src/lib/request-fingerprint.ts` (+ `request-fingerprint.test.ts`)

- [ ] **Step 1: Add the enums** (single source shared by Zod, pgEnum, and the pure core — repo convention):

```ts
// append to packages/shared/src/enums.ts
/** Custody discriminant (one-way custody network §3): possession, not ownership. */
export const CUSTODY_STATES = ['AT_STATION', 'IN_TRANSIT'] as const
export type CustodyState = (typeof CUSTODY_STATES)[number]

/** One physical traversal (§4): a rental, an internal staff drive, or a
 *  synthesized/administrative transfer. There is NO renter-facing "ferry"
 *  product — STAFF_REPOSITION is a fleet operation (owner correction 2026-07-28). */
export const MOVEMENT_LEG_KINDS = ['RENTAL', 'STAFF_REPOSITION', 'TRANSFER'] as const
export type MovementLegKind = (typeof MOVEMENT_LEG_KINDS)[number]

/** The two ends of one leg (§6): hand-out record vs location-authoritative arrival. */
export const HANDOFF_PHASES = ['DEPARTURE', 'ARRIVAL'] as const
export type HandoffPhase = (typeof HANDOFF_PHASES)[number]

/** Custody-period settlement lifecycle (§11). Slice 1 uses ACCRUING→CLOSED at rate 0. */
export const CUSTODY_SETTLEMENT_STATES = ['ACCRUING', 'CLOSED', 'SETTLED'] as const
export type CustodySettlementState = (typeof CUSTODY_SETTLEMENT_STATES)[number]

/** Owner-configurable receipt-checklist items (§6, Q5). The minimal core
 *  (vehicle, location, receiver, time) is always mandatory and not listed here. */
export const RECEIPT_CHECKLIST_ITEMS = ['PHOTOS', 'FUEL', 'ODOMETER', 'DAMAGE_NOTES'] as const
export type ReceiptChecklistItem = (typeof RECEIPT_CHECKLIST_ITEMS)[number]
```

- [ ] **Step 2: Write the failing state-machine tests**

```ts
// packages/shared/src/lib/custody-state.test.ts
import { describe, expect, it } from 'vitest'
import {
  type CustodySnapshot,
  departCustody,
  isAtHome,
  isCustodyListable,
  isHostOwner,
  placeCustody,
  receiveCustody,
} from './custody-state'

const atStation: CustodySnapshot = {
  custodyState: 'AT_STATION',
  physicalHostOperatorId: 'op-a',
  physicalLocationId: 'loc-1',
}
const inTransit: CustodySnapshot = {
  custodyState: 'IN_TRANSIT',
  physicalHostOperatorId: null,
  physicalLocationId: null,
}
const untracked: CustodySnapshot = {
  custodyState: null,
  physicalHostOperatorId: null,
  physicalLocationId: null,
}

describe('departCustody', () => {
  it('AT_STATION departs to IN_TRANSIT with both ids nulled', () => {
    expect(departCustody(atStation)).toEqual({ ok: true, next: inTransit })
  })
  it('rejects departure while IN_TRANSIT', () => {
    expect(departCustody(inTransit)).toEqual({ ok: false, reason: 'NOT_AT_STATION' })
  })
  it('rejects departure while untracked', () => {
    expect(departCustody(untracked)).toEqual({ ok: false, reason: 'NOT_AT_STATION' })
  })
})

describe('receiveCustody', () => {
  it('IN_TRANSIT is received AT_STATION at the given host + location', () => {
    expect(receiveCustody(inTransit, 'op-b', 'loc-9')).toEqual({
      ok: true,
      next: { custodyState: 'AT_STATION', physicalHostOperatorId: 'op-b', physicalLocationId: 'loc-9' },
    })
  })
  it('rejects a receipt while AT_STATION (double-receipt)', () => {
    expect(receiveCustody(atStation, 'op-b', 'loc-9')).toEqual({ ok: false, reason: 'NOT_IN_TRANSIT' })
  })
})

describe('placeCustody', () => {
  it('places an untracked vehicle AT_STATION at its owner + home', () => {
    expect(placeCustody(untracked, 'op-a', 'loc-1')).toEqual({ ok: true, next: atStation })
  })
  it('rejects placing an already-tracked vehicle', () => {
    expect(placeCustody(atStation, 'op-a', 'loc-2')).toEqual({ ok: false, reason: 'ALREADY_PLACED' })
    expect(placeCustody(inTransit, 'op-a', 'loc-2')).toEqual({ ok: false, reason: 'ALREADY_PLACED' })
  })
})

describe('derived facts (§3 — derived, never stored)', () => {
  it('isAtHome compares physical location to home base', () => {
    expect(isAtHome(atStation, 'loc-1')).toBe(true)
    expect(isAtHome(atStation, 'loc-2')).toBe(false)
    expect(isAtHome(inTransit, 'loc-1')).toBe(false)
    expect(isAtHome(atStation, null)).toBe(false)
  })
  it('isHostOwner compares physical host to owner', () => {
    expect(isHostOwner(atStation, 'op-a')).toBe(true)
    expect(isHostOwner(atStation, 'op-b')).toBe(false)
    expect(isHostOwner(inTransit, 'op-a')).toBe(false)
  })
})

describe('isCustodyListable (§8 rule 1 — the presence conditions)', () => {
  it('AT_STATION + AVAILABLE + not held offline is listable', () => {
    expect(isCustodyListable({ status: 'AVAILABLE', custodyState: 'AT_STATION', heldOffline: false })).toBe(true)
  })
  it('IN_TRANSIT is always off (Q3)', () => {
    expect(isCustodyListable({ status: 'AVAILABLE', custodyState: 'IN_TRANSIT', heldOffline: false })).toBe(false)
  })
  it('heldOffline suppresses listing', () => {
    expect(isCustodyListable({ status: 'AVAILABLE', custodyState: 'AT_STATION', heldOffline: true })).toBe(false)
  })
  it('untracked (legacy/unassigned) stays listable — flag-off equivalence', () => {
    expect(isCustodyListable({ status: 'AVAILABLE', custodyState: null, heldOffline: false })).toBe(true)
  })
  it('owner status gates regardless of custody', () => {
    expect(isCustodyListable({ status: 'MAINTENANCE', custodyState: 'AT_STATION', heldOffline: false })).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `bun run --filter @kuruma/shared test -- custody-state`
Expected: FAIL — module `./custody-state` not found.

- [ ] **Step 4: Implement**

```ts
// packages/shared/src/lib/custody-state.ts
// One-way custody network §3/§5 — the pure custody state machine (FC/IS: the
// CustodyService shell does the I/O; this decides what the next state is).
// AT_STATION|IN_TRANSIT is possession, not ownership; atHome and hostIsOwner
// are DERIVED from location/operator, never encoded in the enum.
import type { CustodyState } from '../enums'

export interface CustodySnapshot {
  readonly custodyState: CustodyState | null
  readonly physicalHostOperatorId: string | null
  readonly physicalLocationId: string | null
}

export const CUSTODY_TRANSITION_ERRORS = ['NOT_AT_STATION', 'NOT_IN_TRANSIT', 'ALREADY_PLACED'] as const
export type CustodyTransitionError = (typeof CUSTODY_TRANSITION_ERRORS)[number]

export type CustodyTransition =
  | { ok: true; next: CustodySnapshot }
  | { ok: false; reason: CustodyTransitionError }

/** A leg (rental or staff reposition) starts: the car leaves its station (§5 Departure). */
export function departCustody(current: CustodySnapshot): CustodyTransition {
  if (current.custodyState !== 'AT_STATION') return { ok: false, reason: 'NOT_AT_STATION' }
  return {
    ok: true,
    next: { custodyState: 'IN_TRANSIT', physicalHostOperatorId: null, physicalLocationId: null },
  }
}

/** An arrival receipt confirms where the car actually landed (§5 Arrival receipt). */
export function receiveCustody(
  current: CustodySnapshot,
  hostOperatorId: string,
  locationId: string,
): CustodyTransition {
  if (current.custodyState !== 'IN_TRANSIT') return { ok: false, reason: 'NOT_IN_TRANSIT' }
  return {
    ok: true,
    next: { custodyState: 'AT_STATION', physicalHostOperatorId: hostOperatorId, physicalLocationId: locationId },
  }
}

/** First placement of a custody-untracked vehicle (home base assigned — the §13 on-ramp). */
export function placeCustody(
  current: CustodySnapshot,
  operatorId: string,
  locationId: string,
): CustodyTransition {
  if (current.custodyState !== null) return { ok: false, reason: 'ALREADY_PLACED' }
  return {
    ok: true,
    next: { custodyState: 'AT_STATION', physicalHostOperatorId: operatorId, physicalLocationId: locationId },
  }
}

export function isAtHome(s: CustodySnapshot, homeBaseLocationId: string | null): boolean {
  return s.physicalLocationId !== null && s.physicalLocationId === homeBaseLocationId
}

export function isHostOwner(s: CustodySnapshot, ownerOperatorId: string): boolean {
  return s.physicalHostOperatorId !== null && s.physicalHostOperatorId === ownerOperatorId
}

/**
 * §8 rule 1 (presence). IN_TRANSIT is always off (Q3); NULL custodyState
 * (untracked legacy/unassigned) stays listable so the dark-flag behavior is
 * byte-identical to today. Window feasibility and booking overlap are separate
 * conditions layered by the caller.
 */
export function isCustodyListable(v: {
  status: string
  custodyState: CustodyState | null
  heldOffline: boolean
}): boolean {
  return v.status === 'AVAILABLE' && v.custodyState !== 'IN_TRANSIT' && !v.heldOffline
}
```

- [ ] **Step 5: Fingerprint helper — failing test, then implement**

```ts
// packages/shared/src/lib/request-fingerprint.test.ts
import { describe, expect, it } from 'vitest'
import { requestFingerprint } from './request-fingerprint'

describe('requestFingerprint (§6 replay binding)', () => {
  it('is stable across key order', async () => {
    const a = await requestFingerprint({ locationId: 'L1', fuelPercent: 80 })
    const b = await requestFingerprint({ fuelPercent: 80, locationId: 'L1' })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
  it('differs when any field differs', async () => {
    const a = await requestFingerprint({ locationId: 'L1', photoHashes: ['aa'] })
    const b = await requestFingerprint({ locationId: 'L1', photoHashes: ['bb'] })
    expect(a).not.toBe(b)
  })
  it('treats null and absent as distinct', async () => {
    const a = await requestFingerprint({ locationId: 'L1', notes: null })
    const b = await requestFingerprint({ locationId: 'L1' })
    expect(a).not.toBe(b)
  })
})
```

```ts
// packages/shared/src/lib/request-fingerprint.ts
// §6 replay semantics: an idempotency key is bound to a request fingerprint so
// a reused key can never silently return evidence for a DIFFERENT claim.
// SHA-256 over key-sorted canonical JSON; Web Crypto (Workers-safe).
type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

function sortKeysDeep(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeysDeep(value[k] as Json)]),
    )
  }
  return value
}

export async function requestFingerprint(payload: Record<string, Json>): Promise<string> {
  const canonical = JSON.stringify(sortKeysDeep(payload))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
```

- [ ] **Step 6: Run to verify pass**

Run: `bun run --filter @kuruma/shared test -- custody-state request-fingerprint`
Expected: PASS (16 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/enums.ts packages/shared/src/lib/custody-state.ts packages/shared/src/lib/custody-state.test.ts packages/shared/src/lib/request-fingerprint.ts packages/shared/src/lib/request-fingerprint.test.ts
git commit -m "feat(custody): pure custody state machine + enums + request fingerprint (slice 0)"
```

### Task 3: Movement-timeline fold + the §7 drop-off policy

**Files:**
- Create: `packages/shared/src/lib/custody-timeline.ts`
- Test: `packages/shared/src/lib/custody-timeline.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/lib/custody-timeline.test.ts
import { describe, expect, it } from 'vitest'
import {
  type PendingLeg,
  allowedDropoffIds,
  ownerActiveLocationIds,
  pendingLegOverlaps,
  projectedLocationAt,
} from './custody-timeline'

const d = (iso: string): Date => new Date(iso)
const leg = (over: Partial<PendingLeg>): PendingLeg => ({
  kind: 'RENTAL',
  fromLocationId: 'A',
  toLocationId: 'B',
  plannedStartAt: d('2026-08-01T10:00:00Z'),
  plannedEndAt: d('2026-08-03T10:00:00Z'),
  departedAt: null,
  ...over,
})

describe('projectedLocationAt (§8 rule 3 building block)', () => {
  it('no pending legs → the car stays where it physically is', () => {
    expect(projectedLocationAt('A', [], d('2026-09-01T00:00:00Z'))).toBe('A')
  })
  it('a settled projection relocates the car from its plannedEndAt onward', () => {
    expect(projectedLocationAt('A', [leg({})], d('2026-08-03T10:00:00Z'))).toBe('B')
  })
  it('before the projection settles, the car is still at its current location', () => {
    expect(projectedLocationAt('A', [leg({})], d('2026-08-01T09:00:00Z'))).toBe('A')
  })
  it('the LATEST settled projection wins (P→P chains land back at P)', () => {
    const rt1 = leg({ toLocationId: 'A' })
    const rt2 = leg({
      toLocationId: 'A',
      plannedStartAt: d('2026-08-05T10:00:00Z'),
      plannedEndAt: d('2026-08-06T10:00:00Z'),
    })
    expect(projectedLocationAt('A', [rt1, rt2], d('2026-08-07T00:00:00Z'))).toBe('A')
  })
  it('an IN_TRANSIT car (null current) is nowhere until received', () => {
    const inFlight = leg({ departedAt: d('2026-08-01T10:00:00Z') })
    expect(projectedLocationAt(null, [inFlight], d('2026-08-02T00:00:00Z'))).toBe(null)
  })
})

describe('pendingLegOverlaps (§8 rule 4, generalized to non-booking legs)', () => {
  it('a planned window overlapping the requested window is an overlap', () => {
    expect(pendingLegOverlaps([leg({})], d('2026-08-02T00:00:00Z'), d('2026-08-04T00:00:00Z'))).toBe(true)
  })
  it('[closed, open) — windows that only touch do not overlap', () => {
    expect(pendingLegOverlaps([leg({})], d('2026-08-03T10:00:00Z'), d('2026-08-05T00:00:00Z'))).toBe(false)
    expect(pendingLegOverlaps([leg({})], d('2026-07-30T00:00:00Z'), d('2026-08-01T10:00:00Z'))).toBe(false)
  })
  it('an in-flight leg occupies from its ACTUAL departure', () => {
    const early = leg({ departedAt: d('2026-08-01T08:00:00Z') })
    expect(pendingLegOverlaps([early], d('2026-08-01T08:30:00Z'), d('2026-08-01T09:00:00Z'))).toBe(true)
  })
})

describe('ownerActiveLocationIds (§7 building block)', () => {
  const locations = [
    { id: 'L1', operatorId: 'owner', status: 'ACTIVE' },
    { id: 'L2', operatorId: 'owner', status: 'ARCHIVED' },
    { id: 'L3', operatorId: 'other', status: 'ACTIVE' },
  ]
  it('active owner locations only', () => {
    expect(ownerActiveLocationIds({ ownerOperatorId: 'owner', ownerDeactivatedAt: null, locations })).toEqual(new Set(['L1']))
  })
  it('a deactivated owner has an empty set', () => {
    expect(
      ownerActiveLocationIds({ ownerOperatorId: 'owner', ownerDeactivatedAt: d('2026-01-01T00:00:00Z'), locations }),
    ).toEqual(new Set())
  })
})

describe('allowedDropoffIds (§7 rev.7 — receiving set split from owner set)', () => {
  const ownerActive = new Set(['HOME', 'B', 'C'])
  // Slice 1 (no host opt-in yet): receiving == ownerActive. The FOREIGN host
  // cases below pin the Slice-2 semantics the function must already carry.
  const receiving = new Set(['HOME', 'B', 'C', 'F'])
  it('at home: the whole receiving set (the one permitted hop out, incl. a foreign F)', () => {
    expect(
      allowedDropoffIds({
        physicalPickupLocationId: 'HOME',
        homeBaseLocationId: 'HOME',
        ownerActiveLocationIds: ownerActive,
        receivingLocationIds: receiving,
      }),
    ).toEqual(new Set(['HOME', 'B', 'C', 'F']))
  })
  it('displaced at owner branch B: return home or a round trip in place — never onward B→C', () => {
    expect(
      allowedDropoffIds({
        physicalPickupLocationId: 'B',
        homeBaseLocationId: 'HOME',
        ownerActiveLocationIds: ownerActive,
        receivingLocationIds: receiving,
      }),
    ).toEqual(new Set(['HOME', 'B']))
  })
  it('displaced at FOREIGN F: home comes from the owner set, P→P from the receiving set', () => {
    expect(
      allowedDropoffIds({
        physicalPickupLocationId: 'F',
        homeBaseLocationId: 'HOME',
        ownerActiveLocationIds: ownerActive,
        receivingLocationIds: receiving,
      }),
    ).toEqual(new Set(['HOME', 'F']))
  })
  it('displaced with an archived home: only the round trip in place remains', () => {
    expect(
      allowedDropoffIds({
        physicalPickupLocationId: 'B',
        homeBaseLocationId: 'HOME',
        ownerActiveLocationIds: new Set(['B', 'C']),
        receivingLocationIds: new Set(['B', 'C']),
      }),
    ).toEqual(new Set(['B']))
  })
  it('no home base assigned: round trip in place only', () => {
    expect(
      allowedDropoffIds({
        physicalPickupLocationId: 'B',
        homeBaseLocationId: null,
        ownerActiveLocationIds: ownerActive,
        receivingLocationIds: receiving,
      }),
    ).toEqual(new Set(['B']))
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --filter @kuruma/shared test -- custody-timeline`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/lib/custody-timeline.ts
// One-way custody network §4/§7/§8 — the movement-stream fold + drop-off
// policy, pure (FC/IS). The materialized vehicles.physicalLocationId IS the
// fold evaluated at `now` so future feasibility only needs the PENDING legs
// (receivedAt and voidedAt both NULL) layered on top of that baseline.
import type { MovementLegKind } from '../enums'

/** A not-yet-arrived, not-voided movement leg (the live projection). */
export interface PendingLeg {
  readonly kind: MovementLegKind
  readonly fromLocationId: string
  readonly toLocationId: string
  readonly plannedStartAt: Date
  readonly plannedEndAt: Date
  readonly departedAt: Date | null
}

/**
 * Where the vehicle is expected at instant `t`: the destination of the latest
 * pending leg whose projection has settled (`plannedEndAt <= t`), else where it
 * physically is now (`null` while IN_TRANSIT/untracked). Under §8 this is used
 * ONLY to exclude — a projected destination is never searchable (Q3-strict).
 */
export function projectedLocationAt(
  currentLocationId: string | null,
  pendingLegs: readonly PendingLeg[],
  t: Date,
): string | null {
  let latest: PendingLeg | undefined
  for (const l of pendingLegs) {
    if (l.plannedEndAt.getTime() <= t.getTime()) {
      if (!latest || l.plannedEndAt.getTime() > latest.plannedEndAt.getTime()) latest = l
    }
  }
  return latest ? latest.toLocationId : currentLocationId
}

/**
 * §8 rule 4: does any pending leg's occupancy window intersect
 * `[startAt, effectiveEndAt)`? For RENTAL legs this duplicates the DB exclusion
 * constraint (defense in depth); for STAFF_REPOSITION/TRANSFER legs it is the
 * only guard — they are not bookings, so `bookings_no_overlap` never sees them.
 */
export function pendingLegOverlaps(
  pendingLegs: readonly PendingLeg[],
  startAt: Date,
  effectiveEndAt: Date,
): boolean {
  return pendingLegs.some((l) => {
    const occupiedFrom = (l.departedAt ?? l.plannedStartAt).getTime()
    return occupiedFrom < effectiveEndAt.getTime() && startAt.getTime() < l.plannedEndAt.getTime()
  })
}

/**
 * §7 building block, formalized against the real columns: the ACTIVE locations
 * of a (not-deactivated) owner.
 */
export function ownerActiveLocationIds(args: {
  ownerOperatorId: string
  ownerDeactivatedAt: Date | null
  locations: readonly { id: string; operatorId: string; status: string }[]
}): Set<string> {
  if (args.ownerDeactivatedAt !== null) return new Set()
  return new Set(
    args.locations
      .filter((l) => l.operatorId === args.ownerOperatorId && l.status === 'ACTIVE')
      .map((l) => l.id),
  )
}

/**
 * §7 rev.7 — the v1 leash over TWO location sets. The receiving set is who may
 * take custody (owner branches ∪ opted-in foreign hosts); the owner set is
 * where "home" may point. Slice 1 passes receiving == ownerActive (no opt-in
 * yet); the shape already carries Slice 2. At home: the whole receiving set
 * (the one permitted hop out). Displaced at P: ({home} ∩ ownerActive) ∪
 * ({P} ∩ receiving) — return home or a round trip in place, never onward.
 * The pickup is the car's PHYSICAL location (§8 anchor — never a projection).
 * Search and checkout must share this one function — never re-derive it.
 */
export function allowedDropoffIds(args: {
  physicalPickupLocationId: string
  homeBaseLocationId: string | null
  ownerActiveLocationIds: ReadonlySet<string>
  receivingLocationIds: ReadonlySet<string>
}): Set<string> {
  const {
    physicalPickupLocationId: pickup,
    homeBaseLocationId: home,
    ownerActiveLocationIds: ownerActive,
    receivingLocationIds: receiving,
  } = args
  if (home !== null && pickup === home) return new Set(receiving)
  const out = new Set<string>()
  if (home !== null && ownerActive.has(home)) out.add(home)
  if (receiving.has(pickup)) out.add(pickup)
  return out
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun run --filter @kuruma/shared test -- custody-timeline`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/lib/custody-timeline.ts packages/shared/src/lib/custody-timeline.test.ts
git commit -m "feat(custody): movement-timeline fold + rev.7 drop-off policy (slice 0)"
```

### Task 4: The §8 feasibility predicate + supersede `one-way.ts`

**Files:**
- Create: `packages/shared/src/lib/custody-feasibility.ts`
- Test: `packages/shared/src/lib/custody-feasibility.test.ts`
- Delete: `packages/shared/src/lib/one-way.ts`, `packages/shared/tests/lib/one-way.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/lib/custody-feasibility.test.ts
import { describe, expect, it } from 'vitest'
import { assessOneWayFeasibility } from './custody-feasibility'
import type { PendingLeg } from './custody-timeline'

const d = (iso: string): Date => new Date(iso)
const leg = (over: Partial<PendingLeg>): PendingLeg => ({
  kind: 'RENTAL',
  fromLocationId: 'A',
  toLocationId: 'B',
  plannedStartAt: d('2026-08-01T10:00:00Z'),
  plannedEndAt: d('2026-08-03T10:00:00Z'),
  departedAt: null,
  ...over,
})
const active = new Set(['A', 'B', 'C'])
const base = {
  physicalLocationId: 'A' as string | null,
  pendingLegs: [] as readonly PendingLeg[],
  pickupLocationId: 'A',
  dropoffLocationId: 'A',
  startAt: d('2026-09-01T10:00:00Z'),
  effectiveEndAt: d('2026-09-03T10:00:00Z'),
  homeBaseLocationId: 'A' as string | null,
  ownerActiveLocationIds: active,
  receivingLocationIds: active,
}

describe('assessOneWayFeasibility (§8 — anchor, exclude-only projection, leash, tail)', () => {
  it('round trip at home is feasible', () => {
    expect(assessOneWayFeasibility(base)).toEqual({ ok: true })
  })
  it('from home, a one-way to any receiving location is feasible as the tail', () => {
    expect(assessOneWayFeasibility({ ...base, dropoffLocationId: 'B' })).toEqual({ ok: true })
  })
  it('displaced at B: the homeward B→A trip is feasible (the headline case)', () => {
    expect(
      assessOneWayFeasibility({ ...base, physicalLocationId: 'B', pickupLocationId: 'B', dropoffLocationId: 'A' }),
    ).toEqual({ ok: true })
  })
  it('displaced at B: a round trip in place (B→B) is feasible (Q1 approval)', () => {
    expect(
      assessOneWayFeasibility({ ...base, physicalLocationId: 'B', pickupLocationId: 'B', dropoffLocationId: 'B' }),
    ).toEqual({ ok: true })
  })
  it('displaced at B: onward B→C is rejected even though C is owner-active', () => {
    expect(
      assessOneWayFeasibility({ ...base, physicalLocationId: 'B', pickupLocationId: 'B', dropoffLocationId: 'C' }),
    ).toEqual({ ok: false, reason: 'DROPOFF_NOT_HOMEWARD' })
  })
  it('ANCHOR (rule 2): the pickup must be the physically received location — never a projection', () => {
    // Car at A with a pending A→B leg settling before the window: NOT bookable
    // at B (destination unreceived, Q3-strict) — this is the rev.6 P0-1 pin.
    const relocates = leg({}) // A→B settles 08-03, before startAt
    expect(
      assessOneWayFeasibility({ ...base, pendingLegs: [relocates], pickupLocationId: 'B', dropoffLocationId: 'B' }),
    ).toEqual({ ok: false, reason: 'PICKUP_NOT_AT_LOCATION' })
  })
  it('EXCLUDE (rule 3): a pending one-way makes the car unbookable at its origin for later windows', () => {
    const relocates = leg({}) // A→B settles before startAt — the car will be gone
    expect(assessOneWayFeasibility({ ...base, pendingLegs: [relocates] })).toEqual({
      ok: false,
      reason: 'PICKUP_NOT_AT_LOCATION',
    })
  })
  it('rule 3 benign case: earlier P→P round trips land back at P and do not exclude', () => {
    const roundTrip = leg({ toLocationId: 'A' })
    expect(assessOneWayFeasibility({ ...base, pendingLegs: [roundTrip] })).toEqual({ ok: true })
  })
  it('rule 4: a window overlapping a pending leg (e.g. a scheduled reposition) is rejected', () => {
    const repo = leg({
      kind: 'STAFF_REPOSITION',
      plannedStartAt: d('2026-09-02T00:00:00Z'),
      plannedEndAt: d('2026-09-04T00:00:00Z'),
    })
    expect(assessOneWayFeasibility({ ...base, pendingLegs: [repo] })).toEqual({
      ok: false,
      reason: 'WINDOW_OVERLAPS_MOVEMENT',
    })
  })
  it('a dropoff outside the receiving set is rejected', () => {
    expect(assessOneWayFeasibility({ ...base, dropoffLocationId: 'X' })).toEqual({
      ok: false,
      reason: 'DROPOFF_NOT_HOMEWARD',
    })
  })
  it('TAIL (decision 15): a one-way inserted before a successor leg is rejected', () => {
    const successor = leg({
      fromLocationId: 'A',
      toLocationId: 'A',
      plannedStartAt: d('2026-09-10T10:00:00Z'),
      plannedEndAt: d('2026-09-12T10:00:00Z'),
    })
    expect(
      assessOneWayFeasibility({ ...base, pendingLegs: [successor], dropoffLocationId: 'B' }),
    ).toEqual({ ok: false, reason: 'ONEWAY_NOT_TAIL' })
  })
  it('a round trip BEFORE a successor stays feasible (car ends where it started)', () => {
    const successor = leg({
      fromLocationId: 'A',
      toLocationId: 'A',
      plannedStartAt: d('2026-09-10T10:00:00Z'),
      plannedEndAt: d('2026-09-12T10:00:00Z'),
    })
    expect(assessOneWayFeasibility({ ...base, pendingLegs: [successor] })).toEqual({ ok: true })
  })
  it('an IN_TRANSIT car (null physical) is never bookable anywhere (Q3)', () => {
    expect(assessOneWayFeasibility({ ...base, physicalLocationId: null })).toEqual({
      ok: false,
      reason: 'PICKUP_NOT_AT_LOCATION',
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --filter @kuruma/shared test -- custody-feasibility`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/lib/custody-feasibility.ts
// One-way custody network §8 — THE one feasibility predicate, shared verbatim
// by search and checkout (read/write parity: search must never advertise a car
// checkout would reject). Q3-STRICT: the pickup anchor is the physically
// received location; the movement projection has exactly one job — EXCLUDING
// windows the car will not be there for. A planned/in-flight leg never makes
// its destination bookable (that needs the arrival receipt). Rule 1 (presence:
// isCustodyListable + road-legality + operator active) is composed by the
// caller against the car's CURRENT state; this module owns rules 2-5 + tail.
import {
  type PendingLeg,
  allowedDropoffIds,
  pendingLegOverlaps,
  projectedLocationAt,
} from './custody-timeline'

export const ONE_WAY_CUSTODY_REASONS = [
  'WINDOW_OVERLAPS_MOVEMENT',
  'PICKUP_NOT_AT_LOCATION',
  'ONEWAY_NOT_TAIL',
  'DROPOFF_NOT_HOMEWARD',
] as const
export type OneWayCustodyReason = (typeof ONE_WAY_CUSTODY_REASONS)[number]

export type CustodyFeasibility = { ok: true } | { ok: false; reason: OneWayCustodyReason }

export function assessOneWayFeasibility(args: {
  physicalLocationId: string | null
  pendingLegs: readonly PendingLeg[]
  pickupLocationId: string
  dropoffLocationId: string
  startAt: Date
  effectiveEndAt: Date
  homeBaseLocationId: string | null
  ownerActiveLocationIds: ReadonlySet<string>
  receivingLocationIds: ReadonlySet<string>
}): CustodyFeasibility {
  // Rule 2 (anchor) — pickup IS where the car was last received. No promotion.
  if (args.physicalLocationId === null || args.pickupLocationId !== args.physicalLocationId) {
    return { ok: false, reason: 'PICKUP_NOT_AT_LOCATION' }
  }
  // Rule 3 (projection excludes) — any live leg settling before the window that
  // lands anywhere else means the car will be gone, and its destination is not
  // received, so the car is bookable NOWHERE for this window.
  if (projectedLocationAt(args.physicalLocationId, args.pendingLegs, args.startAt) !== args.physicalLocationId) {
    return { ok: false, reason: 'PICKUP_NOT_AT_LOCATION' }
  }
  // Rule 4 (overlap) — no live leg may occupy any part of the window.
  if (pendingLegOverlaps(args.pendingLegs, args.startAt, args.effectiveEndAt)) {
    return { ok: false, reason: 'WINDOW_OVERLAPS_MOVEMENT' }
  }
  // Rule 5 (leash) — §7 over the receiving/owner sets.
  const allowed = allowedDropoffIds({
    physicalPickupLocationId: args.pickupLocationId,
    homeBaseLocationId: args.homeBaseLocationId,
    ownerActiveLocationIds: args.ownerActiveLocationIds,
    receivingLocationIds: args.receivingLocationIds,
  })
  if (!allowed.has(args.dropoffLocationId)) {
    return { ok: false, reason: 'DROPOFF_NOT_HOMEWARD' }
  }
  // A round trip leaves the car where it was — successors stay anchored.
  if (args.dropoffLocationId === args.pickupLocationId) return { ok: true }
  // Tail rule (decision 15): a one-way must not strand an existing future leg's
  // pickup — rule 3's guarantee must survive this create.
  const hasSuccessor = args.pendingLegs.some(
    (l) => (l.departedAt ?? l.plannedStartAt).getTime() >= args.effectiveEndAt.getTime(),
  )
  if (hasSuccessor) return { ok: false, reason: 'ONEWAY_NOT_TAIL' }
  return { ok: true }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun run --filter @kuruma/shared test -- custody-feasibility`
Expected: PASS (13 tests).

- [ ] **Step 5: Delete the superseded module** (zero production importers — re-verify, then delete):

```bash
grep -rn "one-way" packages/api/src packages/web/src packages/shared/src --include='*.ts' --include='*.tsx' | grep -v one-way-custody | grep -v test
# Expected: no hits outside packages/shared/src/lib/one-way.ts itself
git rm packages/shared/src/lib/one-way.ts packages/shared/tests/lib/one-way.test.ts
```

- [ ] **Step 6: Full shared suite + commit**

Run: `bun run --filter @kuruma/shared test` — Expected: PASS, nothing else referenced the deleted module.

```bash
git add -A packages/shared
git commit -m "feat(custody): Q3-strict feasibility predicate; supersede one-way.ts (slice 0)"
```

---

## Phase 2 — Slice 1 schema

### Task 5: Custody columns + three new tables + seals migrations

**Files:**
- Modify: `packages/shared/src/db/fleet.ts` (vehicles columns + extras)
- Modify: `packages/shared/src/db/auth.ts` (operators.receiptChecklist)
- Create: `packages/shared/src/db/custody.ts`
- Modify: `packages/shared/src/db/schema.ts` (barrel line)
- Generate: `drizzle/01NN_one_way_custody_schema.sql`
- Custom: `drizzle/01NN_custody_state_reference_seals.sql`, `drizzle/01NN_receipts_append_only_grants.sql`

No RED test here — the check is `db:verify` + generated SQL review + the Task 9 real-pg seal tests.

- [ ] **Step 1: Add vehicle custody columns** in `packages/shared/src/db/fleet.ts`, after `insuranceExpiryDate` (line ~132), before `createdAt`:

```ts
    // --- One-way custody network (§3). pickupLocationId is REINTERPRETED as the
    // vehicle's HOME BASE (a re-label never moves the car); the pair below is the
    // materialized physical state, written ONLY by placement/receipt/departure.
    // NULL custodyState = custody-untracked (no home base assigned yet, §13).
    custodyState: custodyStateEnum('custodyState'),
    physicalHostOperatorId: text('physicalHostOperatorId'),
    physicalLocationId: text('physicalLocationId'),
    // §3 state⇔reference seals: the in-flight leg (IN_TRANSIT) / open custody
    // period (AT_STATION). Bare columns here — their composite FKs + the
    // three-way CHECK live in the custom seals migration (plan decision 16:
    // fleet.ts↔custody.ts would otherwise import each other circularly).
    inFlightLegId: text('inFlightLegId'),
    openCustodyPeriodId: text('openCustodyPeriodId'),
    // §3: listing suppression on a received car (reposition queued / promo-home
    // / owner hold) + the per-car relist policy (default wait-for-owner).
    heldOffline: boolean('heldOffline').notNull().default(false),
    autoRelistOnReceipt: boolean('autoRelistOnReceipt').notNull().default(false),
    // §9 promo-home: discount for a booking that lands the car at its home base
    // by the cutoff (compared against ARRIVAL). Cleared by a receipt at home.
    homewardPromoPercent: integer('homewardPromoPercent'),
    homewardPromoCutoffAt: timestamp('homewardPromoCutoffAt', { withTimezone: true, mode: 'date' }),
```

Add the enum at the top of `fleet.ts` (next to the existing pgEnums; import `CUSTODY_STATES` from `'../enums'`; `boolean` may need adding to the drizzle-orm/pg-core import list):

```ts
export const custodyStateEnum = pgEnum('custody_state', CUSTODY_STATES)
```

- [ ] **Step 2: Add vehicle extras** in the `fleet.ts` vehicles extras array (after the existing composite FKs, ~line 185):

```ts
    // Physical state may cross operators in Slice 2; the operator component is
    // what makes the FK real (§3). Target: locations_operatorId_id_unique.
    foreignKey({
      columns: [table.physicalHostOperatorId, table.physicalLocationId],
      foreignColumns: [locations.operatorId, locations.id],
      name: 'vehicles_physical_location_fk',
    }),
    index('idx_vehicles_physicalHostOperatorId').on(table.physicalHostOperatorId),
    index('idx_vehicles_physicalLocationId').on(table.physicalLocationId),
    index('idx_vehicles_inFlightLegId').on(table.inFlightLegId),
    index('idx_vehicles_openCustodyPeriodId').on(table.openCustodyPeriodId),
    check(
      'vehicles_homeward_promo_pair',
      sql`(${table.homewardPromoPercent} IS NULL) = (${table.homewardPromoCutoffAt} IS NULL)`,
    ),
    check(
      'vehicles_homeward_promo_percent_range',
      sql`${table.homewardPromoPercent} IS NULL OR (${table.homewardPromoPercent} BETWEEN 1 AND 100)`,
    ),
```

(The three-way custody CHECK is deliberately NOT here — Step 5c.)

- [ ] **Step 3: Operators checklist config** — in `packages/shared/src/db/auth.ts`, add to the `operators` table columns:

```ts
    // §6/Q5: owner-configurable receipt checklist (RECEIPT_CHECKLIST_ITEMS
    // values). Empty = minimal core only (vehicle, location, receiver, time) —
    // the v1 default. Snapshotted onto the leg at departure; the snapshot, not
    // this live value, is what the receiver must satisfy.
    receiptChecklist: text('receiptChecklist').array().notNull().default([]),
```

- [ ] **Step 4: Create the custody bounded-context module**

```ts
// packages/shared/src/db/custody.ts
// One-way custody network (spec rev.8): movement_legs is ONE row per physical
// traversal (§4) — the shared movement identity consumed by the §8 feasibility
// fold, the §11 custody-period boundaries, and the §6 receipt records.
// custody_periods is the accrual ledger [receivedAt, departedAt) — the time a
// host ACTUALLY holds the car. handoff_receipts is immutable evidence with a
// sealed minimal core (append-only, private photos — NOT the catalog pipeline).
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { CUSTODY_SETTLEMENT_STATES, HANDOFF_PHASES, MOVEMENT_LEG_KINDS } from '../enums'
import { operators, users } from './auth'
import { bookings } from './booking'
import { vehicles } from './fleet'
import { locations } from './location'

export const movementLegKindEnum = pgEnum('movement_leg_kind', MOVEMENT_LEG_KINDS)
export const handoffPhaseEnum = pgEnum('handoff_phase', HANDOFF_PHASES)
export const custodySettlementStateEnum = pgEnum('custody_settlement_state', CUSTODY_SETTLEMENT_STATES)

export const movementLegs = pgTable(
  'movement_legs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    vehicleId: text('vehicleId')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    kind: movementLegKindEnum('kind').notNull(),
    // Set for RENTAL, null for STAFF_REPOSITION/TRANSFER (§4).
    bookingId: text('bookingId').references(() => bookings.id, { onDelete: 'restrict' }),
    fromOperatorId: text('fromOperatorId').notNull(),
    fromLocationId: text('fromLocationId').notNull(),
    // May be RE-SET on receipt only for a recovery leg (§5) — the only mutable
    // pair on the row, updated in the same tx BEFORE the endpoint trigger fires.
    toOperatorId: text('toOperatorId').notNull(),
    toLocationId: text('toLocationId').notNull(),
    plannedStartAt: timestamp('plannedStartAt', { withTimezone: true, mode: 'date' }).notNull(),
    plannedEndAt: timestamp('plannedEndAt', { withTimezone: true, mode: 'date' }).notNull(),
    // The planned→actual flips: each set EXACTLY ONCE, never cleared.
    departedAt: timestamp('departedAt', { withTimezone: true, mode: 'date' }),
    receivedAt: timestamp('receivedAt', { withTimezone: true, mode: 'date' }),
    // Pre-departure cancellation/substitution voids the planned leg (§5); a
    // departed leg can never be voided — it becomes the recovery leg instead.
    voidedAt: timestamp('voidedAt', { withTimezone: true, mode: 'date' }),
    // §6/Q5: the receipt checklist copied from the owner's config at DEPARTURE.
    // NULL (undeparted or dark-era/synthesized) = minimal core only.
    checklistSnapshot: text('checklistSnapshot').array(),
    idempotencyKey: text('idempotencyKey').notNull(),
    // §6: binds the idempotency key to the payload it was first used for.
    requestFingerprint: text('requestFingerprint').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_movement_legs_vehicleId').on(table.vehicleId),
    index('idx_movement_legs_bookingId').on(table.bookingId),
    index('idx_movement_legs_fromOperatorId').on(table.fromOperatorId),
    index('idx_movement_legs_toOperatorId').on(table.toOperatorId),
    // The feasibility fold reads exactly this slice (live legs).
    index('idx_movement_legs_pending')
      .on(table.vehicleId)
      .where(sql`${table.receivedAt} IS NULL AND ${table.voidedAt} IS NULL`),
    uniqueIndex('movement_legs_idempotencyKey_unique').on(table.idempotencyKey),
    // §4 rev.7: uniqueness follows TRAVERSAL identity — one live leg per
    // (booking, car). An ACTIVE substitution leaves two live legs on one
    // booking (old car's detached recovery + new car's current); the booking's
    // current leg is the one matching booking.assignedVehicleId (decision 17).
    uniqueIndex('movement_legs_booking_vehicle_unique')
      .on(table.bookingId, table.vehicleId)
      .where(sql`${table.bookingId} IS NOT NULL AND ${table.voidedAt} IS NULL`),
    foreignKey({
      columns: [table.fromOperatorId, table.fromLocationId],
      foreignColumns: [locations.operatorId, locations.id],
      name: 'movement_legs_from_location_fk',
    }),
    foreignKey({
      columns: [table.toOperatorId, table.toLocationId],
      foreignColumns: [locations.operatorId, locations.id],
      name: 'movement_legs_to_location_fk',
    }),
    // A rental leg always names its booking; a reposition/transfer never does.
    check('movement_legs_kind_booking', sql`(${table.kind}::text = 'RENTAL') = (${table.bookingId} IS NOT NULL)`),
    // At most ONE in-flight leg per vehicle — the process invariant as a constraint.
    uniqueIndex('movement_legs_one_in_flight_per_vehicle')
      .on(table.vehicleId)
      .where(sql`${table.departedAt} IS NOT NULL AND ${table.receivedAt} IS NULL AND ${table.voidedAt} IS NULL`),
    // Receipts + vehicles.inFlightLegId pin their vehicle through this target.
    unique('movement_legs_id_vehicleId_unique').on(table.id, table.vehicleId),
    check('movement_legs_planned_window', sql`${table.plannedEndAt} > ${table.plannedStartAt}`),
    check(
      'movement_legs_received_after_departed',
      sql`${table.receivedAt} IS NULL OR (${table.departedAt} IS NOT NULL AND ${table.receivedAt} >= ${table.departedAt})`,
    ),
    check('movement_legs_void_only_undeparted', sql`${table.voidedAt} IS NULL OR ${table.departedAt} IS NULL`),
  ],
)

export const custodyPeriods = pgTable(
  'custody_periods',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    vehicleId: text('vehicleId')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    ownerOperatorId: text('ownerOperatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    hostOperatorId: text('hostOperatorId').notNull(),
    hostLocationId: text('hostLocationId').notNull(),
    // [held): opens on the arrival receipt, closes the instant the car departs (§11).
    receivedAt: timestamp('receivedAt', { withTimezone: true, mode: 'date' }).notNull(),
    departedAt: timestamp('departedAt', { withTimezone: true, mode: 'date' }),
    // NULLABLE only for the §13 bootstrap baseline rows (no leg existed yet).
    openedByLegId: text('openedByLegId').references(() => movementLegs.id, { onDelete: 'restrict' }),
    closedByLegId: text('closedByLegId').references(() => movementLegs.id, { onDelete: 'restrict' }),
    // Snapshotted at receipt so a later fee-config change never retro-alters an
    // amount already owed (§11). Slice 1: always 0 (hostIsOwner).
    dailyRateJpySnapshot: integer('dailyRateJpySnapshot').notNull().default(0),
    handoffFeeJpySnapshot: integer('handoffFeeJpySnapshot').notNull().default(0),
    // Derived at close in Slice 2 (day-count/rounding are open inputs, §16.7).
    accruedJpy: integer('accruedJpy'),
    settlementState: custodySettlementStateEnum('settlementState').notNull().default('ACCRUING'),
    settlementRef: text('settlementRef'),
    settledAt: timestamp('settledAt', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_custody_periods_vehicleId').on(table.vehicleId),
    index('idx_custody_periods_ownerOperatorId').on(table.ownerOperatorId),
    index('idx_custody_periods_hostOperatorId').on(table.hostOperatorId),
    index('idx_custody_periods_openedByLegId').on(table.openedByLegId),
    index('idx_custody_periods_closedByLegId').on(table.closedByLegId),
    // §11: one open period per vehicle is a DB seal, not prose.
    uniqueIndex('custody_periods_one_open_per_vehicle')
      .on(table.vehicleId)
      .where(sql`${table.departedAt} IS NULL`),
    // §3: the composite-FK target that ties vehicles.openCustodyPeriodId to a
    // period matching the car's CURRENT host + location.
    unique('custody_periods_state_target_unique').on(
      table.id,
      table.vehicleId,
      table.hostOperatorId,
      table.hostLocationId,
    ),
    foreignKey({
      columns: [table.hostOperatorId, table.hostLocationId],
      foreignColumns: [locations.operatorId, locations.id],
      name: 'custody_periods_host_location_fk',
    }),
    check('custody_periods_close_after_open', sql`${table.departedAt} IS NULL OR ${table.departedAt} >= ${table.receivedAt}`),
    check('custody_periods_rate_non_negative', sql`${table.dailyRateJpySnapshot} >= 0`),
    check('custody_periods_handoff_fee_non_negative', sql`${table.handoffFeeJpySnapshot} >= 0`),
  ],
)

export const handoffReceipts = pgTable(
  'handoff_receipts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    legId: text('legId')
      .notNull()
      .references(() => movementLegs.id, { onDelete: 'restrict' }),
    phase: handoffPhaseEnum('phase').notNull(),
    vehicleId: text('vehicleId')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    actorUserId: text('actorUserId')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    actorOperatorId: text('actorOperatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    atOperatorId: text('atOperatorId').notNull(),
    atLocationId: text('atLocationId').notNull(),
    capturedAt: timestamp('capturedAt', { withTimezone: true, mode: 'date' }).notNull(),
    // §6/Q5: everything below the minimal core is checklist-driven and NULLABLE.
    // The service enforces the leg's checklistSnapshot; the DB seals structure.
    fuelPercent: integer('fuelPercent'),
    odometerKm: integer('odometerKm'),
    damageReported: boolean('damageReported').notNull().default(false),
    conditionNotes: text('conditionNotes'),
    // PRIVATE R2 keys (HANDOFF_RECEIPTS bucket) — never public catalog URLs.
    // May be empty when the checklist does not require photos (Q5 — no CHECK).
    photoStorageKeys: text('photoStorageKeys').array().notNull().default([]),
    // A correction is a NEW row pointing at the row it replaces (§6) — never
    // an update. The current view is the head of the supersession chain.
    supersedesReceiptId: text('supersedesReceiptId'),
    idempotencyKey: text('idempotencyKey').notNull(),
    requestFingerprint: text('requestFingerprint').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_handoff_receipts_legId').on(table.legId),
    index('idx_handoff_receipts_vehicleId').on(table.vehicleId),
    index('idx_handoff_receipts_actorUserId').on(table.actorUserId),
    index('idx_handoff_receipts_actorOperatorId').on(table.actorOperatorId),
    index('idx_handoff_receipts_atOperatorId').on(table.atOperatorId),
    index('idx_handoff_receipts_supersedesReceiptId').on(table.supersedesReceiptId),
    uniqueIndex('handoff_receipts_idempotencyKey_unique').on(table.idempotencyKey),
    uniqueIndex('handoff_receipts_canonical_unique')
      .on(table.legId, table.phase)
      .where(sql`${table.supersedesReceiptId} IS NULL`),
    uniqueIndex('handoff_receipts_supersedes_unique')
      .on(table.supersedesReceiptId)
      .where(sql`${table.supersedesReceiptId} IS NOT NULL`),
    unique('handoff_receipts_id_legId_phase_unique').on(table.id, table.legId, table.phase),
    // A correction can never re-point to a different leg or end.
    foreignKey({
      columns: [table.supersedesReceiptId, table.legId, table.phase],
      foreignColumns: [table.id, table.legId, table.phase],
      name: 'handoff_receipts_correction_same_end_fk',
    }),
    // Evidence can never cite a different car than its traversal.
    foreignKey({
      columns: [table.legId, table.vehicleId],
      foreignColumns: [movementLegs.id, movementLegs.vehicleId],
      name: 'handoff_receipts_leg_vehicle_fk',
    }),
    // §6: the receipt's location is real and correctly attributed.
    foreignKey({
      columns: [table.atOperatorId, table.atLocationId],
      foreignColumns: [locations.operatorId, locations.id],
      name: 'handoff_receipts_at_location_fk',
    }),
    check('handoff_receipts_fuel_range', sql`${table.fuelPercent} IS NULL OR (${table.fuelPercent} BETWEEN 0 AND 100)`),
    check('handoff_receipts_odometer_non_negative', sql`${table.odometerKm} IS NULL OR ${table.odometerKm} >= 0`),
  ],
)
```

- [ ] **Step 5: Barrel** — add to `packages/shared/src/db/schema.ts` (alphabetical position among the existing `export *` lines):

```ts
export * from './custody'
```

- [ ] **Step 5a: Generate + apply + verify**

```bash
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:generate --name one_way_custody_schema
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:migrate
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:verify
```

Expected: one new migration; verify 3 green checks. Inspect the SQL: 4 new enum types, 3 new tables with every named constraint above (incl. `movement_legs_booking_vehicle_unique`, `movement_legs_one_in_flight_per_vehicle`, `custody_periods_state_target_unique`, `handoff_receipts_leg_vehicle_fk`, `handoff_receipts_at_location_fk`), vehicles gains 9 columns + 1 composite FK + 4 indexes + 2 CHECKs, operators gains `receiptChecklist`. If drizzle-kit fails on the self-referential composite FK, fall back to `--custom` for that single `ALTER TABLE handoff_receipts ADD CONSTRAINT handoff_receipts_correction_same_end_fk ...` and note it in the migration comment.

- [ ] **Step 5c: State⇔reference seals + endpoint trigger** (custom — plan decision 16):

```bash
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:generate --custom --name custody_state_reference_seals
```

Fill the generated file with:

```sql
-- One-way custody §3: state⇔reference seals. Hand-written because the FKs are
-- circular across drizzle modules (vehicles→movement_legs/custody_periods→vehicles).
-- Drizzle never diffs custom SQL, so these constraints cause no snapshot drift.
ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_in_flight_leg_fk"
    FOREIGN KEY ("inFlightLegId", "id")
    REFERENCES "movement_legs" ("id", "vehicleId") ON DELETE RESTRICT,
  ADD CONSTRAINT "vehicles_open_custody_period_fk"
    FOREIGN KEY ("openCustodyPeriodId", "id", "physicalHostOperatorId", "physicalLocationId")
    REFERENCES "custody_periods" ("id", "vehicleId", "hostOperatorId", "hostLocationId") ON DELETE RESTRICT,
  ADD CONSTRAINT "vehicles_custody_three_way_check" CHECK (
    ("custodyState" IS NULL
      AND "physicalHostOperatorId" IS NULL AND "physicalLocationId" IS NULL
      AND "inFlightLegId" IS NULL AND "openCustodyPeriodId" IS NULL)
    OR ("custodyState" = 'IN_TRANSIT'
      AND "physicalHostOperatorId" IS NULL AND "physicalLocationId" IS NULL
      AND "inFlightLegId" IS NOT NULL AND "openCustodyPeriodId" IS NULL)
    OR ("custodyState" = 'AT_STATION'
      AND "physicalHostOperatorId" IS NOT NULL AND "physicalLocationId" IS NOT NULL
      AND "inFlightLegId" IS NULL AND "openCustodyPeriodId" IS NOT NULL)
  );

-- §6: a receipt matches its leg's endpoint. Deferred so a recovery re-target
-- (leg to* updated in the same tx) is always checked against the final pair.
CREATE OR REPLACE FUNCTION handoff_receipt_endpoint_check() RETURNS trigger AS $$
DECLARE
  leg_from text;
  leg_to text;
BEGIN
  SELECT "fromLocationId", "toLocationId" INTO leg_from, leg_to
    FROM "movement_legs" WHERE "id" = NEW."legId";
  IF NEW."phase" = 'ARRIVAL' AND NEW."atLocationId" <> leg_to THEN
    RAISE EXCEPTION 'handoff_receipts_endpoint_match: ARRIVAL receipt at % but leg arrives at %',
      NEW."atLocationId", leg_to USING ERRCODE = '23514';
  END IF;
  IF NEW."phase" = 'DEPARTURE' AND NEW."atLocationId" <> leg_from THEN
    RAISE EXCEPTION 'handoff_receipts_endpoint_match: DEPARTURE receipt at % but leg departs from %',
      NEW."atLocationId", leg_from USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER handoff_receipts_endpoint_match
  AFTER INSERT ON "handoff_receipts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION handoff_receipt_endpoint_check();

-- §6 rev.8: the endpoint guard is BIDIRECTIONAL — updating a leg's endpoint
-- pair must not orphan a receipt already pinned to that leg-end. Deferred so
-- the recovery flow (re-target to*, then insert the matching ARRIVAL receipt,
-- same tx) is checked once, against the final state.
CREATE OR REPLACE FUNCTION movement_leg_endpoint_receipts_check() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM "handoff_receipts" r
    WHERE r."legId" = NEW."id"
      AND ((r."phase" = 'ARRIVAL' AND r."atLocationId" <> NEW."toLocationId")
        OR (r."phase" = 'DEPARTURE' AND r."atLocationId" <> NEW."fromLocationId"));
  IF FOUND THEN
    RAISE EXCEPTION 'movement_legs_endpoint_receipts: leg % endpoint update orphans an existing receipt',
      NEW."id" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER movement_legs_endpoint_receipts
  AFTER UPDATE OF "fromOperatorId", "fromLocationId", "toOperatorId", "toLocationId" ON "movement_legs"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION movement_leg_endpoint_receipts_check();

-- §3 rev.8: lifecycle triggers. The composite FKs prove the referenced row
-- BELONGS to the car — an FK is equally satisfied by a received leg or a
-- closed period. These deferred triggers assert the lifecycle state at commit,
-- from BOTH directions, completing the seal.
CREATE OR REPLACE FUNCTION vehicle_custody_lifecycle_check() RETURNS trigger AS $$
BEGIN
  IF NEW."custodyState" = 'IN_TRANSIT' THEN
    PERFORM 1 FROM "movement_legs" l
      WHERE l."id" = NEW."inFlightLegId"
        AND l."departedAt" IS NOT NULL AND l."receivedAt" IS NULL AND l."voidedAt" IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'vehicles_custody_lifecycle: vehicle % IN_TRANSIT but leg % is not in flight',
        NEW."id", NEW."inFlightLegId" USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."custodyState" = 'AT_STATION' THEN
    PERFORM 1 FROM "custody_periods" p
      WHERE p."id" = NEW."openCustodyPeriodId" AND p."departedAt" IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'vehicles_custody_lifecycle: vehicle % AT_STATION but period % is not open',
        NEW."id", NEW."openCustodyPeriodId" USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER vehicles_custody_lifecycle
  AFTER INSERT OR UPDATE ON "vehicles"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION vehicle_custody_lifecycle_check();

-- The reverse direction: receiving/voiding a leg or closing a period fails at
-- commit while a vehicle still references it as in-flight/open — the §5
-- transitions must update the vehicle in the same transaction, always.
CREATE OR REPLACE FUNCTION movement_leg_backref_check() RETURNS trigger AS $$
BEGIN
  IF NEW."receivedAt" IS NOT NULL OR NEW."voidedAt" IS NOT NULL THEN
    PERFORM 1 FROM "vehicles" v WHERE v."inFlightLegId" = NEW."id";
    IF FOUND THEN
      RAISE EXCEPTION 'vehicles_custody_lifecycle: leg % settled while a vehicle still references it in-flight',
        NEW."id" USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER movement_legs_vehicle_backref
  AFTER UPDATE OF "receivedAt", "voidedAt" ON "movement_legs"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION movement_leg_backref_check();

CREATE OR REPLACE FUNCTION custody_period_backref_check() RETURNS trigger AS $$
BEGIN
  IF NEW."departedAt" IS NOT NULL THEN
    PERFORM 1 FROM "vehicles" v WHERE v."openCustodyPeriodId" = NEW."id";
    IF FOUND THEN
      RAISE EXCEPTION 'vehicles_custody_lifecycle: period % closed while a vehicle still references it as open',
        NEW."id" USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER custody_periods_vehicle_backref
  AFTER UPDATE OF "departedAt" ON "custody_periods"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION custody_period_backref_check();
```

Apply + `db:verify`. (The §13 home-base⇒tracked trigger deliberately lands in Task 6, AFTER the backfill — adding it here would open a window where an old-code write to a home-based, not-yet-backfilled row fails at commit.)

- [ ] **Step 5d: DB-enforced receipt immutability** (§6 — the repo exposing no update/delete is not the enforcement):

```bash
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:generate --custom --name receipts_append_only_grants
```

Fill it by MIRRORING the #1556 consent-ledger migration (`git log --oneline --all -- drizzle | grep -i consent` → read that migration's SQL): the same role-separation statements applied to `handoff_receipts` — the application role keeps INSERT/SELECT, loses UPDATE/DELETE. Copy #1556's guard style exactly (it already handles role-name/environment conditionality); apply + `db:verify`.

- [ ] **Step 6: Typecheck + commit**

```bash
bunx tsc -p packages/shared --noEmit && bun run lint
git add packages/shared/src/db packages/shared/src/enums.ts drizzle
git commit -m "feat(custody): custody schema — legs/periods/receipts + state-reference seals + endpoint trigger"
```

### Task 6: Backfill migration (baseline periods + placement)

**Files:**
- Generate: `drizzle/01NN_backfill_vehicle_custody.sql` (custom)

- [ ] **Step 1: Generate the custom migration**

```bash
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:generate --custom --name backfill_vehicle_custody
```

Fill the generated file with:

```sql
-- One-way custody bootstrap (§13): every vehicle WITH a home base starts
-- AT_STATION at home, host = owner, with a BASELINE custody period (owner-host,
-- rate 0, openedByLegId NULL — the only rows permitted null). Vehicles WITHOUT
-- a home base stay custody-untracked (custodyState NULL) until one is assigned
-- (the Task 12 on-ramp). Idempotent via the custodyState IS NULL guard, and
-- flag-off-equivalent: physicalLocationId mirrors pickupLocationId exactly.
-- The three-way CHECK requires state + period to land in ONE statement.
WITH placed AS (
  INSERT INTO "custody_periods"
    ("id", "vehicleId", "ownerOperatorId", "hostOperatorId", "hostLocationId",
     "receivedAt", "openedByLegId", "dailyRateJpySnapshot", "handoffFeeJpySnapshot")
  SELECT gen_random_uuid(), v."id", v."operatorId", v."operatorId", v."pickupLocationId",
         now(), NULL, 0, 0
  FROM "vehicles" v
  WHERE v."pickupLocationId" IS NOT NULL AND v."custodyState" IS NULL
  RETURNING "id", "vehicleId"
)
UPDATE "vehicles" v
SET "custodyState" = 'AT_STATION',
    "physicalHostOperatorId" = v."operatorId",
    "physicalLocationId" = v."pickupLocationId",
    "openCustodyPeriodId" = p."id"
FROM placed p
WHERE p."vehicleId" = v."id";

-- §13 rev.8: a car with a home base is NEVER untracked. Added AFTER the
-- backfill (every existing home-based row is tracked now) so no old-code
-- write window exists. Any future insert path that sets a home base without
-- placing custody (raw seeds, scripts) fails at commit instead of minting a
-- car search would list but checkout must reject (§8 parity).
CREATE OR REPLACE FUNCTION vehicle_home_base_tracked_check() RETURNS trigger AS $$
BEGIN
  IF NEW."pickupLocationId" IS NOT NULL AND NEW."custodyState" IS NULL THEN
    RAISE EXCEPTION 'vehicles_home_base_tracked: vehicle % has a home base but no custody placement — write AT_STATION + a baseline period in the same transaction',
      NEW."id" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER vehicles_home_base_tracked
  AFTER INSERT OR UPDATE ON "vehicles"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION vehicle_home_base_tracked_check();
```

- [ ] **Step 2: Apply + verify + spot-check**

```bash
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:migrate
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:verify
docker exec kuruma-custody-pg psql -U kuruma -d kuruma_custody -c "SELECT count(*) FILTER (WHERE \"custodyState\" = 'AT_STATION' AND \"physicalLocationId\" = \"pickupLocationId\" AND \"openCustodyPeriodId\" IS NOT NULL) AS tracked, count(*) FILTER (WHERE \"custodyState\" IS NULL) AS untracked FROM vehicles;"
```

Expected: verify green; every vehicle with a pickup location is `tracked` with a baseline period (a freshly-migrated empty DB shows 0/0 — seed in Step 2b for a non-trivial check).

- [ ] **Step 2b: Seeds place their own vehicles (P0-B — decision 21).** Seed runs AFTER migration, so the backfill cannot cover seeded rows; without this the flag-ON E2E (Task 21) books a car whose `physicalLocationId` is null — search lists it (COALESCE fallback), checkout rejects it. In `scripts/seed.ts`, after the vehicle inserts, add one placement statement mirroring the backfill CTE exactly (insert a baseline `custody_periods` row per home-based vehicle — owner-host, rate snapshots 0, `openedByLegId` NULL — and set `custodyState 'AT_STATION'` + physical pair + `openCustodyPeriodId` in the same statement; idempotent via the same `custodyState IS NULL` guard). The Task 6 trigger turns a seed that forgets this into a hard failure, not a broken beta. Verify:

```bash
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:seed
docker exec kuruma-custody-pg psql -U kuruma -d kuruma_custody -c "SELECT count(*) FROM vehicles WHERE \"pickupLocationId\" IS NOT NULL AND \"custodyState\" IS NULL;"
```

Expected: `0` — no seeded car is home-based-but-untracked.

> **Fixture fallout (check now, fix where hit):** the trigger fails ANY raw insert of a home-based vehicle without placement — that includes integration-test fixtures and e2e `testSql` inserts, not just the seed. Grep `tests/integration` + `e2e/real-db` for direct `vehicles` inserts with a `pickupLocationId`; give each the same one-statement placement (or extract a tiny SQL helper next to the fixture utils and reuse it in Tasks 9/15/21). A fixture that trips the trigger is the seal working — fix the fixture, never weaken the trigger.

- [ ] **Step 3: Commit**

```bash
git add drizzle scripts/seed.ts
git commit -m "feat(custody): bootstrap backfill + home-base⇒tracked seal; seeds place their vehicles"
```

---

## Phase 3 — Ports + repositories

**Cap guard (applies to Tasks 7–9):** `repositories/types.ts` is AT the 800-line hard cap — do NOT touch it. All new interfaces go in `types-custody.ts`; services import from `'../repositories/types-custody'` directly (Rule 2's regex allows any `repositories/types*` — precedent: `services/operator-terms.ts:5` imports from `types-consent`). `stores.ts` is 708/800 — the ~75 new entity lines fit, but check `bun run lint:size` after.

### Task 7: Entities + ports + in-memory repositories

**Files:**
- Modify: `packages/api/src/stores.ts` (3 new entities + extend `Vehicle`)
- Modify: `packages/shared/src/db/custody.ts` (type re-export line at bottom)
- Modify: `packages/api/src/pg-errors.ts` (named-constraint consts)
- Create: `packages/api/src/repositories/types-custody.ts`
- Create: `packages/api/src/repositories/in-memory/movement-leg.ts`, `in-memory/custody-period.ts`, `in-memory/handoff-receipt.ts`
- Test: `packages/api/src/repositories/in-memory/movement-leg.test.ts`, `custody-period.test.ts`, `handoff-receipt.test.ts`

- [ ] **Step 1: Type re-exports** — append to `packages/shared/src/db/custody.ts` (module convention):

```ts
export type { CustodySettlementState, CustodyState, HandoffPhase, MovementLegKind, ReceiptChecklistItem } from '../enums'
```

- [ ] **Step 2: Entities in `stores.ts`.** Extend the `Vehicle` interface (find it via `grep -n "interface Vehicle " packages/api/src/stores.ts`) with:

```ts
  // One-way custody (§3): pickupLocationId is the HOME BASE; the physical pair
  // + state references are written only by placement/receipt/departure.
  // null custodyState = untracked.
  custodyState: CustodyState | null
  physicalHostOperatorId: string | null
  physicalLocationId: string | null
  inFlightLegId: string | null
  openCustodyPeriodId: string | null
  heldOffline: boolean
  autoRelistOnReceipt: boolean
  homewardPromoPercent: number | null
  homewardPromoCutoffAt: Date | null
```

and add three new interfaces next to `ClassRatePlan` (import the custody enum types from `@kuruma/shared/db/schema` in the existing type-import block):

```ts
export interface MovementLeg {
  id: string
  vehicleId: string
  kind: MovementLegKind
  bookingId: string | null
  fromOperatorId: string
  fromLocationId: string
  toOperatorId: string
  toLocationId: string
  plannedStartAt: Date
  plannedEndAt: Date
  departedAt: Date | null
  receivedAt: Date | null
  voidedAt: Date | null
  checklistSnapshot: ReceiptChecklistItem[] | null
  idempotencyKey: string
  requestFingerprint: string
  createdAt: Date
}

export interface CustodyPeriod {
  id: string
  vehicleId: string
  ownerOperatorId: string
  hostOperatorId: string
  hostLocationId: string
  receivedAt: Date
  departedAt: Date | null
  openedByLegId: string | null
  closedByLegId: string | null
  dailyRateJpySnapshot: number
  handoffFeeJpySnapshot: number
  accruedJpy: number | null
  settlementState: CustodySettlementState
  settlementRef: string | null
  settledAt: Date | null
  createdAt: Date
}

export interface HandoffReceipt {
  id: string
  legId: string
  phase: HandoffPhase
  vehicleId: string
  actorUserId: string
  actorOperatorId: string
  atOperatorId: string
  atLocationId: string
  capturedAt: Date
  fuelPercent: number | null
  odometerKm: number | null
  damageReported: boolean
  conditionNotes: string | null
  photoStorageKeys: string[]
  supersedesReceiptId: string | null
  idempotencyKey: string
  requestFingerprint: string
  createdAt: Date
}
```

Also extend the `Operator` entity (same file) with `receiptChecklist: ReceiptChecklistItem[]`.

**Compile fallout:** extending `Vehicle`/`Operator` breaks every fixture literal. Run `bunx tsc -p packages/api --noEmit` and fix each site with the untracked defaults (`custodyState: null, physicalHostOperatorId: null, physicalLocationId: null, inFlightLegId: null, openCustodyPeriodId: null, heldOffline: false, autoRelistOnReceipt: false, homewardPromoPercent: null, homewardPromoCutoffAt: null`; operators: `receiptChecklist: []`) — untracked is listable, so existing tests keep their behavior. Prefer extending any central `makeVehicle`-style factory over editing dozens of literals. Also extend the drizzle vehicle/operator column mappers (wherever `tsc` points) and the in-memory vehicle `create` defaults (same values; the in-memory create keeps custody untracked even when given a `pickupLocationId` — placement is the Task 12 service rule).

- [ ] **Step 3: Named-constraint consts** — append to `packages/api/src/pg-errors.ts`:

```ts
/** §4 seals on movement_legs. */
export const MOVEMENT_LEGS_IDEMPOTENCY_UNIQUE = 'movement_legs_idempotencyKey_unique'
export const MOVEMENT_LEGS_BOOKING_VEHICLE_UNIQUE = 'movement_legs_booking_vehicle_unique'
export const MOVEMENT_LEGS_ONE_IN_FLIGHT = 'movement_legs_one_in_flight_per_vehicle'
/** §11: one open custody period per vehicle — a double-receipt race is rejected by the DB. */
export const CUSTODY_PERIODS_ONE_OPEN = 'custody_periods_one_open_per_vehicle'
/** §6 seals on handoff_receipts. */
export const HANDOFF_RECEIPTS_IDEMPOTENCY_UNIQUE = 'handoff_receipts_idempotencyKey_unique'
export const HANDOFF_RECEIPTS_CANONICAL_UNIQUE = 'handoff_receipts_canonical_unique'
export const HANDOFF_RECEIPTS_SUPERSEDES_UNIQUE = 'handoff_receipts_supersedes_unique'
```

- [ ] **Step 4: The ports**

```ts
// packages/api/src/repositories/types-custody.ts
// One-way custody ports (§4/§11/§6). In their own module because
// repositories/types.ts is at the file-size cap (#978 pattern); services
// import from here directly (same as types-consent). These ports take explicit
// ids, NOT CallerContext — custody moves are service-orchestrated and the
// service enforces fleet-write + tenant binding first (ConsentRepository
// precedent). Every mark* method embeds its precondition in the WHERE and
// returns undefined when unmet, so each planned→actual flip happens EXACTLY
// ONCE even under retry.
import type { ReceiptChecklistItem } from '@kuruma/shared/db/schema'
import type { CustodyPeriod, HandoffReceipt, MovementLeg, Vehicle } from '../stores'

/** Legs are ALWAYS created PLANNED (§4 — no leg is born departed). ACTIVE
 *  substitution/assignment compose create + markDeparted in one tx. */
export type NewMovementLeg = Omit<
  MovementLeg,
  'id' | 'createdAt' | 'departedAt' | 'receivedAt' | 'voidedAt' | 'checklistSnapshot'
>

export interface MovementLegRepository {
  /** Throws named 23505s: idempotency / one-live-leg-per-(booking,vehicle). */
  create(data: NewMovementLeg): Promise<MovementLeg>
  findById(id: string): Promise<MovementLeg | undefined>
  /** The booking's CURRENT leg (decision 17): live leg on THIS vehicle. An
   *  ACTIVE substitution's detached recovery leg (other vehicle) is excluded
   *  by the vehicle match. */
  findLiveByBookingAndVehicle(bookingId: string, vehicleId: string): Promise<MovementLeg | undefined>
  /** Generation counter for the §4 rev.8 idempotency keys
   *  (`booking:<id>:<vehicleId>:g<n>`): counts the pair's legs in ANY state
   *  (voided included) — called inside the tx under the vehicle locks. */
  countByBookingAndVehicle(bookingId: string, vehicleId: string): Promise<number>
  /** Replay resolution (§6): checked FIRST, before any state precondition. */
  findByIdempotencyKey(key: string): Promise<MovementLeg | undefined>
  /** The live projection: receivedAt IS NULL AND voidedAt IS NULL. */
  findPendingByVehicle(vehicleId: string): Promise<MovementLeg[]>
  /** The (at most one — DB seal) departed-but-unarrived leg. */
  findInFlightByVehicle(vehicleId: string): Promise<MovementLeg | undefined>
  /** Guard: departedAt IS NULL AND voidedAt IS NULL — undefined when unmet.
   *  Also stamps the §6 checklist snapshot (the only writer of both fields). */
  markDeparted(
    id: string,
    args: { departedAt: Date; checklistSnapshot: ReceiptChecklistItem[] },
  ): Promise<MovementLeg | undefined>
  /** Guard: receivedAt IS NULL AND departedAt IS NOT NULL. Re-sets to* ONLY on
   *  a recovery receipt — the service enforces the §5 no-re-target rule. */
  markReceived(
    id: string,
    args: { receivedAt: Date; toOperatorId: string; toLocationId: string },
  ): Promise<MovementLeg | undefined>
  /** Guard: departedAt IS NULL AND voidedAt IS NULL (pre-departure cancel/substitution). */
  markVoided(id: string, voidedAt: Date): Promise<MovementLeg | undefined>
  /** Archival guard (§7): pending legs touching this location as EITHER endpoint. */
  countPendingTo(operatorId: string, locationId: string): Promise<number>
  countPendingFrom(operatorId: string, locationId: string): Promise<number>
}

export type NewCustodyPeriod = Omit<
  CustodyPeriod,
  'id' | 'createdAt' | 'departedAt' | 'closedByLegId' | 'accruedJpy' | 'settlementState' | 'settlementRef' | 'settledAt'
>

export interface CustodyPeriodRepository {
  /** Throws 23505 `custody_periods_one_open_per_vehicle` on a double-open. */
  open(data: NewCustodyPeriod): Promise<CustodyPeriod>
  /** Closes the open period (settlementState → CLOSED); undefined when none
   *  open. closedByLegId null = an administrative close (dark sync, Task 12). */
  closeOpen(
    vehicleId: string,
    args: { departedAt: Date; closedByLegId: string | null },
  ): Promise<CustodyPeriod | undefined>
  findOpenByVehicle(vehicleId: string): Promise<CustodyPeriod | undefined>
  findByVehicle(vehicleId: string): Promise<CustodyPeriod[]>
}

export type NewHandoffReceipt = Omit<HandoffReceipt, 'id' | 'createdAt'>

/** Append-only by design (§6): no update, no delete — a correction is a new
 *  row; the DB enforces it via #1556-style role separation (Task 5 Step 5d). */
export interface HandoffReceiptRepository {
  /** Throws named 23505s: idempotency / canonical-per-leg-end / supersedes-linear. */
  create(data: NewHandoffReceipt): Promise<HandoffReceipt>
  findById(id: string): Promise<HandoffReceipt | undefined>
  /** Replay resolution (§6): checked FIRST, inside the lock, before any state
   *  precondition — a 23505 would abort the tx, so check-first is required. */
  findByIdempotencyKey(key: string): Promise<HandoffReceipt | undefined>
  findByLeg(legId: string): Promise<HandoffReceipt[]>
  findByVehicle(vehicleId: string): Promise<HandoffReceipt[]>
}

/** §4: ONE per-vehicle advisory xact-lock guards every timeline mutation
 *  (booking create/cancel/substitution/assignment + leg departure + arrival
 *  receipt). Same shape as lockComboCapacity: pg auto-releases at tx end (noop
 *  thunk); the in-memory mirror serializes on the returned release. Implemented
 *  by the availability repositories (declared here — types.ts is at the cap). */
export interface VehicleTimelineLock {
  lockVehicleTimeline(vehicleId: string): Promise<() => void>
}

/** §4: leg/booking creation reads its endpoint locations FOR SHARE inside the
 *  same tx, so the §7 archival UPDATE serializes against it (both directions).
 *  In-memory: a no-op (single-threaded store). */
export interface LocationShareLock {
  lockLocationsForShare(locationIds: readonly string[]): Promise<void>
}

/** Custody columns write — separate from VehicleRepository (size cap): both
 *  concrete vehicle repos additionally implement this. No ctx: callers are the
 *  custody/vehicle services which have already tenant-bound the vehicle. */
export interface VehicleCustodyWrites {
  updateCustody(
    vehicleId: string,
    patch: Partial<
      Pick<
        Vehicle,
        | 'custodyState'
        | 'physicalHostOperatorId'
        | 'physicalLocationId'
        | 'inFlightLegId'
        | 'openCustodyPeriodId'
        | 'heldOffline'
        | 'autoRelistOnReceipt'
        | 'homewardPromoPercent'
        | 'homewardPromoCutoffAt'
      >
    >,
  ): Promise<Vehicle | undefined>
}

/** Archival-guard reads (§7, error wording only — the atomic guard is the
 *  conditional UPDATE in Task 17) — implemented by both concrete vehicle repos. */
export interface VehicleCustodyReads {
  countHomeBasedAt(operatorId: string, locationId: string): Promise<number>
  countPhysicallyAt(operatorId: string, locationId: string): Promise<number>
}
```

- [ ] **Step 5: Failing in-memory tests.** Complete file for movement-leg (the other two follow the same shape — their full assertion lists are below):

```ts
// packages/api/src/repositories/in-memory/movement-leg.test.ts
import { describe, expect, it } from 'vitest'
import {
  MOVEMENT_LEGS_BOOKING_VEHICLE_UNIQUE,
  MOVEMENT_LEGS_IDEMPOTENCY_UNIQUE,
  MOVEMENT_LEGS_ONE_IN_FLIGHT,
  PG_ERROR,
  pgConstraintName,
  pgErrorCode,
} from '../../pg-errors'
import type { NewMovementLeg } from '../types-custody'
import { InMemoryMovementLegRepository } from './movement-leg'

const d = (iso: string): Date => new Date(iso)
const legData = (over: Partial<NewMovementLeg> = {}): NewMovementLeg => ({
  vehicleId: 'v1',
  kind: 'STAFF_REPOSITION',
  bookingId: null,
  fromOperatorId: 'op',
  fromLocationId: 'A',
  toOperatorId: 'op',
  toLocationId: 'B',
  plannedStartAt: d('2026-08-01T10:00:00Z'),
  plannedEndAt: d('2026-08-03T10:00:00Z'),
  idempotencyKey: crypto.randomUUID(),
  requestFingerprint: 'fp',
  ...over,
})

describe('InMemoryMovementLegRepository', () => {
  it('creates a PLANNED leg (never departed at birth — §4)', async () => {
    const repo = new InMemoryMovementLegRepository()
    const leg = await repo.create(legData())
    expect(leg.departedAt).toBeNull()
    expect(leg.receivedAt).toBeNull()
    expect(leg.voidedAt).toBeNull()
    expect(leg.checklistSnapshot).toBeNull()
    expect(await repo.findPendingByVehicle('v1')).toHaveLength(1)
  })
  it('rejects a duplicate idempotencyKey with the named 23505', async () => {
    const repo = new InMemoryMovementLegRepository()
    const key = crypto.randomUUID()
    await repo.create(legData({ idempotencyKey: key }))
    const err = await repo.create(legData({ idempotencyKey: key })).catch((e: unknown) => e)
    expect(pgErrorCode(err)).toBe(PG_ERROR.UNIQUE_VIOLATION)
    expect(pgConstraintName(err)).toBe(MOVEMENT_LEGS_IDEMPOTENCY_UNIQUE)
  })
  it('one live leg per (booking, vehicle) — but a second vehicle for the same booking is legal (ACTIVE substitution)', async () => {
    const repo = new InMemoryMovementLegRepository()
    await repo.create(legData({ kind: 'RENTAL', bookingId: 'b1' }))
    const err = await repo
      .create(legData({ kind: 'RENTAL', bookingId: 'b1', idempotencyKey: crypto.randomUUID() }))
      .catch((e: unknown) => e)
    expect(pgConstraintName(err)).toBe(MOVEMENT_LEGS_BOOKING_VEHICLE_UNIQUE)
    const otherVehicle = await repo.create(
      legData({ kind: 'RENTAL', bookingId: 'b1', vehicleId: 'v2', idempotencyKey: crypto.randomUUID() }),
    )
    expect(otherVehicle.vehicleId).toBe('v2')
  })
  it('findLiveByBookingAndVehicle picks the CURRENT traversal by vehicle match', async () => {
    const repo = new InMemoryMovementLegRepository()
    const oldLeg = await repo.create(legData({ kind: 'RENTAL', bookingId: 'b1', vehicleId: 'v1' }))
    const newLeg = await repo.create(
      legData({ kind: 'RENTAL', bookingId: 'b1', vehicleId: 'v2', idempotencyKey: crypto.randomUUID() }),
    )
    expect(await repo.findLiveByBookingAndVehicle('b1', 'v2')).toMatchObject({ id: newLeg.id })
    expect(await repo.findLiveByBookingAndVehicle('b1', 'v1')).toMatchObject({ id: oldLeg.id })
    await repo.markVoided(oldLeg.id, d('2026-07-30T00:00:00Z'))
    expect(await repo.findLiveByBookingAndVehicle('b1', 'v1')).toBeUndefined()
  })
  it('markDeparted flips exactly once and stamps the checklist snapshot', async () => {
    const repo = new InMemoryMovementLegRepository()
    const leg = await repo.create(legData())
    const departed = await repo.markDeparted(leg.id, {
      departedAt: d('2026-08-01T10:05:00Z'),
      checklistSnapshot: ['PHOTOS'],
    })
    expect(departed?.departedAt).toEqual(d('2026-08-01T10:05:00Z'))
    expect(departed?.checklistSnapshot).toEqual(['PHOTOS'])
    expect(
      await repo.markDeparted(leg.id, { departedAt: d('2026-08-01T11:00:00Z'), checklistSnapshot: [] }),
    ).toBeUndefined()
    expect(await repo.findInFlightByVehicle('v1')).toMatchObject({ id: leg.id })
  })
  it('one in-flight leg per vehicle is a named 23505 on markDeparted', async () => {
    const repo = new InMemoryMovementLegRepository()
    const first = await repo.create(legData())
    await repo.markDeparted(first.id, { departedAt: d('2026-08-01T10:05:00Z'), checklistSnapshot: [] })
    const second = await repo.create(legData({ idempotencyKey: crypto.randomUUID() }))
    const err = await repo
      .markDeparted(second.id, { departedAt: d('2026-08-01T12:00:00Z'), checklistSnapshot: [] })
      .catch((e: unknown) => e)
    expect(pgConstraintName(err)).toBe(MOVEMENT_LEGS_ONE_IN_FLIGHT)
  })
  it('markReceived requires a departed leg, flips exactly once, and re-targets to*', async () => {
    const repo = new InMemoryMovementLegRepository()
    const leg = await repo.create(legData())
    expect(
      await repo.markReceived(leg.id, { receivedAt: d('2026-08-03T09:00:00Z'), toOperatorId: 'op', toLocationId: 'C' }),
    ).toBeUndefined() // not departed yet
    await repo.markDeparted(leg.id, { departedAt: d('2026-08-01T10:05:00Z'), checklistSnapshot: [] })
    const received = await repo.markReceived(leg.id, {
      receivedAt: d('2026-08-03T09:00:00Z'),
      toOperatorId: 'op',
      toLocationId: 'C',
    })
    expect(received?.toLocationId).toBe('C') // recovery re-target (§5)
    expect(
      await repo.markReceived(leg.id, { receivedAt: d('2026-08-03T10:00:00Z'), toOperatorId: 'op', toLocationId: 'B' }),
    ).toBeUndefined() // idempotent no-op
    expect(await repo.findPendingByVehicle('v1')).toHaveLength(0)
  })
  it('markVoided only before departure', async () => {
    const repo = new InMemoryMovementLegRepository()
    const planned = await repo.create(legData())
    const departedLeg = await repo.create(legData({ idempotencyKey: crypto.randomUUID() }))
    await repo.markDeparted(departedLeg.id, { departedAt: d('2026-08-01T10:05:00Z'), checklistSnapshot: [] })
    expect((await repo.markVoided(planned.id, d('2026-07-30T00:00:00Z')))?.voidedAt).not.toBeNull()
    expect(await repo.markVoided(departedLeg.id, d('2026-07-30T00:00:00Z'))).toBeUndefined()
    expect(await repo.findPendingByVehicle('v1')).toHaveLength(1) // voided leg dropped out
  })
  it('countByBookingAndVehicle counts ALL states — voided legs included (generation keys, decision 19)', async () => {
    const repo = new InMemoryMovementLegRepository()
    const first = await repo.create(legData({ kind: 'RENTAL', bookingId: 'b1', vehicleId: 'v1' }))
    await repo.markVoided(first.id, d('2026-07-30T00:00:00Z'))
    await repo.create(legData({ kind: 'RENTAL', bookingId: 'b1', vehicleId: 'v1', idempotencyKey: crypto.randomUUID() }))
    expect(await repo.countByBookingAndVehicle('b1', 'v1')).toBe(2)
    expect(await repo.countByBookingAndVehicle('b1', 'v2')).toBe(0)
  })
  it('countPendingTo / countPendingFrom count pending legs touching a location as either endpoint', async () => {
    const repo = new InMemoryMovementLegRepository()
    await repo.create(legData())
    const voided = await repo.create(legData({ idempotencyKey: crypto.randomUUID() }))
    await repo.markVoided(voided.id, d('2026-07-30T00:00:00Z'))
    expect(await repo.countPendingTo('op', 'B')).toBe(1)
    expect(await repo.countPendingTo('op', 'Z')).toBe(0)
    expect(await repo.countPendingFrom('op', 'A')).toBe(1)
    expect(await repo.countPendingFrom('op', 'B')).toBe(0)
  })
  it('findByIdempotencyKey resolves a replay', async () => {
    const repo = new InMemoryMovementLegRepository()
    const key = crypto.randomUUID()
    const leg = await repo.create(legData({ idempotencyKey: key }))
    expect(await repo.findByIdempotencyKey(key)).toMatchObject({ id: leg.id })
    expect(await repo.findByIdempotencyKey(crypto.randomUUID())).toBeUndefined()
  })
})
```

`custody-period.test.ts` asserts: open→row with `settlementState: 'ACCRUING'`, `departedAt: null`; a baseline open (`openedByLegId: null`) is legal; second `open` for the same vehicle throws named `CUSTODY_PERIODS_ONE_OPEN`; after `closeOpen` the row has the given `departedAt`/`closedByLegId` (null accepted) + `settlementState: 'CLOSED'` and a NEW `open` succeeds; `closeOpen` with nothing open returns `undefined`; `findOpenByVehicle` returns only the open row.
`handoff-receipt.test.ts` asserts: create returns the row (incl. `requestFingerprint`); duplicate `idempotencyKey` throws named `HANDOFF_RECEIPTS_IDEMPOTENCY_UNIQUE`; **`findByIdempotencyKey` returns the prior row (the §6 replay path)**; a second canonical (same `legId`+`phase`, `supersedesReceiptId: null`) throws named `HANDOFF_RECEIPTS_CANONICAL_UNIQUE`; a correction (`supersedesReceiptId` set, same leg+phase) succeeds; two corrections pointing at the same row throw named `HANDOFF_RECEIPTS_SUPERSEDES_UNIQUE`; `findByLeg` returns both rows; **a receipt with empty `photoStorageKeys` is accepted (Q5 — no photo seal)**.

- [ ] **Step 6: Run to verify failure**

Run: `bun run --filter @kuruma/api test -- in-memory/movement-leg in-memory/custody-period in-memory/handoff-receipt`
Expected: FAIL — modules not found.

- [ ] **Step 7: Implement the three in-memory repos.** Shared throw idiom (mirror `in-memory/booking.ts` — set BOTH `code` and `constraint_name` so `pgConstraintName` resolves):

```ts
// packages/api/src/repositories/in-memory/movement-leg.ts
import type { ReceiptChecklistItem } from '@kuruma/shared/db/schema'
import {
  MOVEMENT_LEGS_BOOKING_VEHICLE_UNIQUE,
  MOVEMENT_LEGS_IDEMPOTENCY_UNIQUE,
  MOVEMENT_LEGS_ONE_IN_FLIGHT,
  PG_ERROR,
} from '../../pg-errors'
import type { MovementLeg } from '../../stores'
import type { MovementLegRepository, NewMovementLeg } from '../types-custody'

const uniqueViolation = (constraint: string): Error =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: PG_ERROR.UNIQUE_VIOLATION,
    constraint_name: constraint,
  })

export class InMemoryMovementLegRepository implements MovementLegRepository {
  private readonly store = new Map<string, MovementLeg>()

  async create(data: NewMovementLeg): Promise<MovementLeg> {
    for (const leg of this.store.values()) {
      if (leg.idempotencyKey === data.idempotencyKey) {
        throw uniqueViolation(MOVEMENT_LEGS_IDEMPOTENCY_UNIQUE)
      }
      if (
        data.bookingId !== null &&
        leg.bookingId === data.bookingId &&
        leg.vehicleId === data.vehicleId &&
        leg.voidedAt === null
      ) {
        throw uniqueViolation(MOVEMENT_LEGS_BOOKING_VEHICLE_UNIQUE)
      }
    }
    const leg: MovementLeg = {
      ...data,
      id: crypto.randomUUID(),
      departedAt: null,
      receivedAt: null,
      voidedAt: null,
      checklistSnapshot: null,
      createdAt: new Date(),
    }
    this.store.set(leg.id, leg)
    return leg
  }

  async findById(id: string): Promise<MovementLeg | undefined> {
    return this.store.get(id)
  }

  async findLiveByBookingAndVehicle(bookingId: string, vehicleId: string): Promise<MovementLeg | undefined> {
    return [...this.store.values()].find(
      (l) => l.bookingId === bookingId && l.vehicleId === vehicleId && l.voidedAt === null,
    )
  }

  async findByIdempotencyKey(key: string): Promise<MovementLeg | undefined> {
    return [...this.store.values()].find((l) => l.idempotencyKey === key)
  }

  async findPendingByVehicle(vehicleId: string): Promise<MovementLeg[]> {
    return [...this.store.values()].filter(
      (l) => l.vehicleId === vehicleId && l.receivedAt === null && l.voidedAt === null,
    )
  }

  async findInFlightByVehicle(vehicleId: string): Promise<MovementLeg | undefined> {
    return (await this.findPendingByVehicle(vehicleId)).find((l) => l.departedAt !== null)
  }

  async markDeparted(
    id: string,
    args: { departedAt: Date; checklistSnapshot: ReceiptChecklistItem[] },
  ): Promise<MovementLeg | undefined> {
    const leg = this.store.get(id)
    if (!leg || leg.departedAt !== null || leg.voidedAt !== null) return undefined
    // Parity with the partial unique index (it applies to UPDATEs too): a second
    // in-flight leg for the same vehicle is a named 23505, not a silent write.
    for (const other of this.store.values()) {
      if (
        other.id !== id &&
        other.vehicleId === leg.vehicleId &&
        other.departedAt !== null &&
        other.receivedAt === null &&
        other.voidedAt === null
      ) {
        throw uniqueViolation(MOVEMENT_LEGS_ONE_IN_FLIGHT)
      }
    }
    const next = { ...leg, departedAt: args.departedAt, checklistSnapshot: args.checklistSnapshot }
    this.store.set(id, next)
    return next
  }

  async markReceived(
    id: string,
    args: { receivedAt: Date; toOperatorId: string; toLocationId: string },
  ): Promise<MovementLeg | undefined> {
    const leg = this.store.get(id)
    if (!leg || leg.receivedAt !== null || leg.departedAt === null) return undefined
    const next = {
      ...leg,
      receivedAt: args.receivedAt,
      toOperatorId: args.toOperatorId,
      toLocationId: args.toLocationId,
    }
    this.store.set(id, next)
    return next
  }

  async markVoided(id: string, voidedAt: Date): Promise<MovementLeg | undefined> {
    const leg = this.store.get(id)
    if (!leg || leg.departedAt !== null || leg.voidedAt !== null) return undefined
    const next = { ...leg, voidedAt }
    this.store.set(id, next)
    return next
  }

  async countPendingTo(operatorId: string, locationId: string): Promise<number> {
    return [...this.store.values()].filter(
      (l) =>
        l.receivedAt === null &&
        l.voidedAt === null &&
        l.toOperatorId === operatorId &&
        l.toLocationId === locationId,
    ).length
  }

  async countPendingFrom(operatorId: string, locationId: string): Promise<number> {
    return [...this.store.values()].filter(
      (l) =>
        l.receivedAt === null &&
        l.voidedAt === null &&
        l.fromOperatorId === operatorId &&
        l.fromLocationId === locationId,
    ).length
  }
}
```

`in-memory/custody-period.ts` — same shape: `open()` scans for an existing row with `vehicleId` + `departedAt === null` and throws `uniqueViolation(CUSTODY_PERIODS_ONE_OPEN)`; inserts `{ ...data, id: crypto.randomUUID(), departedAt: null, closedByLegId: null, accruedJpy: null, settlementState: 'ACCRUING', settlementRef: null, settledAt: null, createdAt: new Date() }`. `closeOpen()` finds the open row, replaces it with `{ ...row, departedAt: args.departedAt, closedByLegId: args.closedByLegId, settlementState: 'CLOSED' }`.
`in-memory/handoff-receipt.ts` — `create()` scans: idempotency dup → `HANDOFF_RECEIPTS_IDEMPOTENCY_UNIQUE`; same `(legId, phase)` with both `supersedesReceiptId === null` → `HANDOFF_RECEIPTS_CANONICAL_UNIQUE`; same non-null `supersedesReceiptId` → `HANDOFF_RECEIPTS_SUPERSEDES_UNIQUE`. Plus `findByIdempotencyKey`. No update/delete methods exist.

Also in THIS task (everything the Task 9 tx bundle wires must already exist): the **in-memory vehicle repo** gains `updateCustody` (shallow-merge into a new object, return it) + `countHomeBasedAt` (`operatorId` + `pickupLocationId` match) + `countPhysicallyAt` (`physicalHostOperatorId` + `physicalLocationId` match), declaring `implements ..., VehicleCustodyWrites, VehicleCustodyReads`; and the **in-memory availability repo** gains a no-op `lockLocationsForShare` (`LocationShareLock`). Unit-test `updateCustody` + the two counts alongside the custody repos. The drizzle halves land in Task 9.

- [ ] **Step 8: Run to verify pass, then commit**

Run: `bun run --filter @kuruma/api test -- in-memory/movement-leg in-memory/custody-period in-memory/handoff-receipt` → PASS.
Run: `bunx tsc -p packages/api --noEmit` → clean (Vehicle/Operator fallout fixed).

```bash
git add packages/api/src/stores.ts packages/api/src/pg-errors.ts packages/api/src/repositories packages/shared/src/db/custody.ts
git commit -m "feat(custody): custody ports + in-memory repositories with seal parity"
```

### Task 8: The per-vehicle timeline lock

**Files:**
- Modify: `packages/api/src/repositories/drizzle/availability.ts`, `in-memory/availability.ts` (implement `VehicleTimelineLock` + `LocationShareLock`)
- Test: extend `packages/api/src/repositories/in-memory/availability.test.ts` (or create if absent)

- [ ] **Step 1: Failing test** (in-memory serialization — mirrors the comboLockTails behavior):

```ts
it('lockVehicleTimeline serializes concurrent holders per vehicle', async () => {
  const repo = new InMemoryAvailabilityRepository(/* existing ctor args */)
  const order: string[] = []
  const r1 = await repo.lockVehicleTimeline('v1')
  const second = repo.lockVehicleTimeline('v1').then((release) => {
    order.push('second-acquired')
    release()
  })
  order.push('first-holds')
  r1()
  await second
  expect(order).toEqual(['first-holds', 'second-acquired'])
})
it('locks are per-vehicle, not global', async () => {
  const repo = new InMemoryAvailabilityRepository(/* ... */)
  const r1 = await repo.lockVehicleTimeline('v1')
  const other = await repo.lockVehicleTimeline('v2') // must not block
  r1(); other()
})
```

Run: fails — method missing.

- [ ] **Step 2: Implement.** Drizzle (`drizzle/availability.ts`, next to `lockComboCapacity` :191):

```ts
  async lockVehicleTimeline(vehicleId: string): Promise<() => void> {
    // §4: ONE lock guards the whole movement stream — booking create/cancel/
    // substitution/assignment, leg departure, arrival receipt. Same mechanics
    // as lockComboCapacity: advisory xact-lock, auto-released at commit/
    // rollback. Lock ORDER when both are taken (SPECIFIC create): combo lock
    // first, then this; two-vehicle ops take vehicle locks in ascending id
    // order — keep those orders everywhere or concurrent creates can deadlock.
    const key = `vehicle-timeline:${vehicleId}`
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
    return () => {}
  }

  async lockLocationsForShare(locationIds: readonly string[]): Promise<void> {
    // §4: serializes leg/booking creation against the §7 archival UPDATE —
    // FOR SHARE blocks the archival row write until this tx commits, and vice
    // versa, closing the create-vs-archive race in both directions.
    if (locationIds.length === 0) return
    await this.db.execute(
      sql`SELECT id FROM locations WHERE id = ANY(${[...locationIds]}) FOR SHARE`,
    )
  }
```

In-memory: clone the `comboLockTails` promise-chain pattern (`in-memory/availability.ts:152-176`) with its own `vehicleLockTails = new Map<string, Promise<void>>()` keyed `vehicle-timeline:${vehicleId}`; `lockLocationsForShare` is an async no-op (landed in Task 7). Declare `implements AvailabilityRepository, VehicleTimelineLock, LocationShareLock` on both classes.

- [ ] **Step 3: Verify + commit**

```bash
bun run --filter @kuruma/api test -- availability && bunx tsc -p packages/api --noEmit
git add packages/api
git commit -m "feat(custody): per-vehicle advisory timeline lock + FOR SHARE location lock"
```

### Task 9: Drizzle repositories + transaction bundle + real-pg seal tests

**Files:**
- Create: `packages/api/src/repositories/drizzle/movement-leg.ts`, `drizzle/custody-period.ts`, `drizzle/handoff-receipt.ts`
- Modify: `packages/api/src/repositories/drizzle/vehicle.ts` (Step 1b — `VehicleCustodyWrites` + `VehicleCustodyReads`)
- Modify: `packages/api/src/repositories/types-transactions.ts`, `repositories/drizzle/transaction.ts`
- Modify: `packages/api/src/composition/repositories.ts`, `packages/api/src/app-overrides.ts`
- Test: `packages/api/tests/integration/custody-repo.test.ts`

- [ ] **Step 1: Drizzle repos.** Same shapes as the in-memory ports, every guard in the WHERE. `drizzle/movement-leg.ts` (pattern; the others mirror it):

```ts
// packages/api/src/repositories/drizzle/movement-leg.ts
import { movementLegs } from '@kuruma/shared/db/schema'
import type { ReceiptChecklistItem } from '@kuruma/shared/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { MovementLeg } from '../../stores'
import type { MovementLegRepository, NewMovementLeg } from '../types-custody'
import type { Db } from './shared'

export class DrizzleMovementLegRepository implements MovementLegRepository {
  constructor(private readonly db: Db) {}

  async create(data: NewMovementLeg): Promise<MovementLeg> {
    const [row] = await this.db.insert(movementLegs).values(data).returning()
    if (!row) throw new Error('Failed to insert movement leg')
    return row as MovementLeg
  }

  async findById(id: string): Promise<MovementLeg | undefined> {
    const [row] = await this.db.select().from(movementLegs).where(eq(movementLegs.id, id))
    return row as MovementLeg | undefined
  }

  async findLiveByBookingAndVehicle(bookingId: string, vehicleId: string): Promise<MovementLeg | undefined> {
    const [row] = await this.db
      .select()
      .from(movementLegs)
      .where(
        and(
          eq(movementLegs.bookingId, bookingId),
          eq(movementLegs.vehicleId, vehicleId),
          isNull(movementLegs.voidedAt),
        ),
      )
    return row as MovementLeg | undefined
  }

  async findByIdempotencyKey(key: string): Promise<MovementLeg | undefined> {
    const [row] = await this.db.select().from(movementLegs).where(eq(movementLegs.idempotencyKey, key))
    return row as MovementLeg | undefined
  }

  async findPendingByVehicle(vehicleId: string): Promise<MovementLeg[]> {
    const rows = await this.db
      .select()
      .from(movementLegs)
      .where(
        and(eq(movementLegs.vehicleId, vehicleId), isNull(movementLegs.receivedAt), isNull(movementLegs.voidedAt)),
      )
    return rows as MovementLeg[]
  }

  async findInFlightByVehicle(vehicleId: string): Promise<MovementLeg | undefined> {
    const [row] = await this.db
      .select()
      .from(movementLegs)
      .where(
        and(
          eq(movementLegs.vehicleId, vehicleId),
          isNull(movementLegs.receivedAt),
          isNull(movementLegs.voidedAt),
          sql`${movementLegs.departedAt} IS NOT NULL`,
        ),
      )
    return row as MovementLeg | undefined
  }

  async markDeparted(
    id: string,
    args: { departedAt: Date; checklistSnapshot: ReceiptChecklistItem[] },
  ): Promise<MovementLeg | undefined> {
    const [row] = await this.db
      .update(movementLegs)
      .set({ departedAt: args.departedAt, checklistSnapshot: args.checklistSnapshot })
      .where(and(eq(movementLegs.id, id), isNull(movementLegs.departedAt), isNull(movementLegs.voidedAt)))
      .returning()
    return row as MovementLeg | undefined
  }

  async markReceived(
    id: string,
    args: { receivedAt: Date; toOperatorId: string; toLocationId: string },
  ): Promise<MovementLeg | undefined> {
    const [row] = await this.db
      .update(movementLegs)
      .set({ receivedAt: args.receivedAt, toOperatorId: args.toOperatorId, toLocationId: args.toLocationId })
      .where(and(eq(movementLegs.id, id), isNull(movementLegs.receivedAt), sql`${movementLegs.departedAt} IS NOT NULL`))
      .returning()
    return row as MovementLeg | undefined
  }

  async markVoided(id: string, voidedAt: Date): Promise<MovementLeg | undefined> {
    const [row] = await this.db
      .update(movementLegs)
      .set({ voidedAt })
      .where(and(eq(movementLegs.id, id), isNull(movementLegs.departedAt), isNull(movementLegs.voidedAt)))
      .returning()
    return row as MovementLeg | undefined
  }

  async countPendingTo(operatorId: string, locationId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(movementLegs)
      .where(
        and(
          isNull(movementLegs.receivedAt),
          isNull(movementLegs.voidedAt),
          eq(movementLegs.toOperatorId, operatorId),
          eq(movementLegs.toLocationId, locationId),
        ),
      )
    return row?.count ?? 0
  }

  async countPendingFrom(operatorId: string, locationId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(movementLegs)
      .where(
        and(
          isNull(movementLegs.receivedAt),
          isNull(movementLegs.voidedAt),
          eq(movementLegs.fromOperatorId, operatorId),
          eq(movementLegs.fromLocationId, locationId),
        ),
      )
    return row?.count ?? 0
  }
}
```

`drizzle/custody-period.ts`: `open()` plain insert (the partial unique index throws the named 23505); `closeOpen()` = `update ... set({ departedAt, closedByLegId, settlementState: 'CLOSED' }).where(and(eq(vehicleId), isNull(departedAt))).returning()`. `drizzle/handoff-receipt.ts`: plain insert (all seals are DB constraints) + the finders incl. `findByIdempotencyKey`. If `select()` row types don't structurally match the `stores` interfaces (e.g. array column typing), add a small `toX` mapper in the repo file rather than widening types.

- [ ] **Step 1b: Drizzle vehicle-repo custody methods** — on `repositories/drizzle/vehicle.ts` add `updateCustody` (`update(vehicles).set(patch).where(eq(id)).returning()` → mapped row | undefined), `countHomeBasedAt` (`operatorId` + `pickupLocationId`), `countPhysicallyAt` (`physicalHostOperatorId` + `physicalLocationId`); declare `implements ..., VehicleCustodyWrites, VehicleCustodyReads` (the in-memory half landed in Task 7). The tenant-anchor lint scans repo writes: `updateCustody`'s patch type structurally excludes `operatorId` (`Pick`ed away) — if `lint:tenant-anchors` still flags the file, add a `vehicle-custody` EXEMPTIONS entry citing the `Pick` (mirror the `class-rate-plan` exemption in `scripts/lint-tenant-anchor-immutability.ts`).

- [ ] **Step 2: Transaction bundle.** In `types-transactions.ts`, extend `TransactionRepos` (after `consentRepo`):

```ts
  // One-way custody (§4/§11): leg create + planned→actual flips + period
  // open/close happen INSIDE the booking/custody tx, under the per-vehicle lock.
  movementLegRepo: MovementLegRepository
  custodyPeriodRepo: CustodyPeriodRepository
  handoffReceiptRepo: HandoffReceiptRepository
  vehicleTimelineLock: VehicleTimelineLock
  locationShareLock: LocationShareLock
  vehicleCustody: VehicleCustodyWrites
```

with the matching `import type` from `'./types-custody'`. (`vehicleTimelineLock`/`locationShareLock`/`vehicleCustody` are separate fields typed as the narrow interfaces because `VehicleRepository`/`AvailabilityRepository` live in capped `types.ts` and cannot grow — they bind to the same concrete instances.) In `drizzle/transaction.ts`, add to the bundle returned inside `runInteractiveTx` (the vehicle/availability instances are already constructed there — reuse them, don't construct twice):

```ts
        movementLegRepo: new DrizzleMovementLegRepository(txDb),
        custodyPeriodRepo: new DrizzleCustodyPeriodRepository(txDb),
        handoffReceiptRepo: new DrizzleHandoffReceiptRepository(txDb),
        vehicleTimelineLock: availabilityRepo, // tx-bound (Task 8)
        locationShareLock: availabilityRepo,   // tx-bound (Task 8)
        vehicleCustody: vehicleRepo,           // tx-bound (Step 1b)
```

- [ ] **Step 3: Composition wiring** — `composition/repositories.ts`: add the three repo fields to the `Repos` interface; in BOTH in-memory builders instantiate `new InMemoryMovementLegRepository()` etc. (honoring `overrides.movementLegRepo ?? ...`), include them in the returned bundle AND inside both in-memory `runInTransaction` closures (with `vehicleTimelineLock`/`locationShareLock` = the in-memory availability repo, `vehicleCustody` = the in-memory vehicle repo); in `buildDrizzleRepos` add `movementLegRepo: new DrizzleMovementLegRepository(db)` etc. Add the three optional slots to `app-overrides.ts`. Mirror exactly how `classRatePlanRepo` is threaded (`repositories.ts:203/259/281/364/475/524/564/618`, `app-overrides.ts:79`).

- [ ] **Step 4: Real-pg seal test** — `packages/api/tests/integration/custody-repo.test.ts`, following `consent-repo.test.ts`'s own-client idiom (`postgres(url, { max: 1 })` + `drizzle(client, { schema }) as unknown as Db`). Seed one operator + two locations + vehicle (unique suffix, cleaned in `afterAll`). Assert with `pgErrorCode`/`pgConstraintName`:
  1. duplicate leg `idempotencyKey` → 23505 `movement_legs_idempotencyKey_unique`
  2. second live leg for one (booking, vehicle) → `movement_legs_booking_vehicle_unique`; same booking on a DIFFERENT vehicle inserts fine (ACTIVE-substitution shape)
  3. `markReceived` before departure → `undefined`; after departure → row; second call → `undefined` (exactly-once flip, DB-enforced)
  4. voiding a departed leg → `undefined`
  5. two open periods for one vehicle → `custody_periods_one_open_per_vehicle`; a baseline open (`openedByLegId: null`) inserts fine
  6. second canonical receipt for one leg-end → `handoff_receipts_canonical_unique`; correction insert succeeds; second correction of the same row → `handoff_receipts_supersedes_unique`
  7. a correction naming a DIFFERENT leg in `legId` → 23503 `handoff_receipts_correction_same_end_fk`
  8. inserting a leg whose `(toOperatorId, toLocationId)` crosses tenants → 23503 `movement_legs_to_location_fk`
  9. a second in-flight leg for one vehicle via `markDeparted` on a planned sibling → 23505 `movement_legs_one_in_flight_per_vehicle`
  10. a RENTAL leg with `bookingId: null` (and a STAFF_REPOSITION leg WITH one) → 23514 check `movement_legs_kind_booking`
  11. `markReceived` with `receivedAt < departedAt` → 23514 check `movement_legs_received_after_departed`
  12. a receipt whose `vehicleId` differs from its leg's vehicle → 23503 `handoff_receipts_leg_vehicle_fk`
  13. **three-way CHECK (§3)**: a raw `UPDATE vehicles SET "custodyState"='IN_TRANSIT'` without `inFlightLegId` → 23514 `vehicles_custody_three_way_check`; setting `AT_STATION` with the physical pair but no `openCustodyPeriodId` → 23514
  14. **state-reference FKs**: `inFlightLegId` pointing at ANOTHER vehicle's leg → 23503 `vehicles_in_flight_leg_fk`; `openCustodyPeriodId` pointing at a period whose host/location differ from the vehicle's physical pair → 23503 `vehicles_open_custody_period_fk`
  15. **endpoint trigger (§6)**: an ARRIVAL receipt at a location ≠ the leg's `toLocationId` → the tx COMMIT fails with the `handoff_receipts_endpoint_match` error (23514); after updating the leg's `to*` in the same tx first, the same insert commits (the recovery path)
  16. **append-only is DB-enforced**: a raw `UPDATE handoff_receipts SET "conditionNotes" = ...` / `DELETE FROM handoff_receipts` through the app-role connection fails with a permission error (mirror how the #1556 consent integration test asserts its role-separation; skip-with-comment if the local container runs as superuser and CI covers it — same caveat as consent).
  17. **lifecycle trigger, vehicle side (§3 rev.8)**: raw-SQL a vehicle to `IN_TRANSIT` whose `inFlightLegId` references a leg that is already RECEIVED (FK satisfied, lifecycle wrong) → COMMIT fails with `vehicles_custody_lifecycle` (23514); same for `AT_STATION` referencing a CLOSED period.
  18. **lifecycle trigger, reverse side (§3 rev.8)**: `markReceived` a leg (raw UPDATE) while a vehicle still references it via `inFlightLegId`, WITHOUT updating the vehicle in the same tx → COMMIT fails; the full §5 shape (leg received + period opened + vehicle written, one tx) commits. Same for closing a period a vehicle still references as open.
  19. **leg-endpoint update guard (§6 rev.8)**: raw `UPDATE movement_legs SET "toLocationId" = <other>` on a leg that already has a matching ARRIVAL receipt → COMMIT fails with `movement_legs_endpoint_receipts` (23514); the recovery order (re-target `to*` then insert the matching receipt, same tx) still commits.
  20. **home-base⇒tracked (§13 rev.8)**: inserting a vehicle with a `pickupLocationId` and NULL `custodyState` (no placement in the tx) → COMMIT fails with `vehicles_home_base_tracked` (23514); insert + baseline period + `AT_STATION` in one tx commits.

Run: `DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bunx vitest run tests/integration/custody-repo.test.ts --root packages/api`
Expected: PASS (20 tests).

- [ ] **Step 5: Full check + commit**

```bash
bunx tsc -p packages/api --noEmit && bun run --filter @kuruma/api test && bun run --filter @kuruma/api lint:boundaries
git add packages/api
git commit -m "feat(custody): drizzle custody repositories + tx bundle + real-pg seal tests"
```

---

## Phase 4 — Flag, storage, custody services

### Task 10: The `ONE_WAY_CUSTODY` flag

**Files:**
- Modify: `packages/shared/src/feature-flags/registry.ts`
- Modify: `packages/web/src/vite/config/feature-flags-runtime.ts` (`BUILD_TIME_READERS`)

- [ ] **Step 1: Registry entry** (alphabetical position among web flags):

```ts
  ONE_WAY_CUSTODY: {
    env: 'VITE_FEATURE_ONE_WAY_CUSTODY',
    label: 'One-way rentals + custody network',
    runtimeControlled: true,
  },
```

- [ ] **Step 2: Web build-time reader** — add to `BUILD_TIME_READERS` in `feature-flags-runtime.ts` (literal access so Vite inlines it):

```ts
  ONE_WAY_CUSTODY: () => isEnvTrue(import.meta.env.VITE_FEATURE_ONE_WAY_CUSTODY),
```

- [ ] **Step 3: Run the pin tests and fix any enumerating ones**

Run: `bun run --filter @kuruma/shared test -- feature-flags && bun run --filter @kuruma/web test -- feature-flags`
Expected: `feature-flags-parity.test.ts` (and any registry enumeration test) fails until the new key is included — update those lists, re-run to PASS. Server-side reads come later via `featureFlagsService.isEnabled('ONE_WAY_CUSTODY')` — a web flag read server-side, floored to `false` until the admin switchboard flips a DB override (the documented OPERATOR_TERMS deviation, `index.ts:433-438`).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/feature-flags packages/web/src/vite/config
git commit -m "feat(custody): ONE_WAY_CUSTODY runtime flag (dark)"
```

### Task 11: Private `ReceiptStorage`

**Files:**
- Modify: `packages/api/src/repositories/types-storage.ts`
- Create: `packages/api/src/repositories/r2-receipt-storage.ts`, `disabled-receipt-storage.ts`, `in-memory/receipt-storage.ts`
- Modify: `packages/api/src/composition/repositories.ts`, `app-overrides.ts`, `packages/api/wrangler.toml`
- Test: `packages/api/src/repositories/in-memory/receipt-storage.test.ts`

- [ ] **Step 1: Port** — append to `types-storage.ts`:

```ts
/** Private object storage for handoff-receipt evidence photos (§6): immutable
 *  (no delete — corrections add rows, evidence is never destroyed), private
 *  (streamed through the Worker like DocumentStorage — never a public URL).
 *  Photos are checklist-conditional (Q5): an environment without the bucket
 *  runs custody fine with a minimal checklist; DisabledReceiptStorage throws
 *  only when a photo is actually uploaded. */
export interface ReceiptStorage {
  put(vehicleId: string, file: File): Promise<{ key: string }>
  getFile(key: string): Promise<{ body: ReadableStream; contentType: string } | null>
  /** Decision 20: `setReceiptChecklist` refuses to enable PHOTOS when false —
   *  an owner must never configure an obligation the receiver cannot satisfy. */
  isConfigured(): boolean
}
```

(`R2ReceiptStorage` and `InMemoryReceiptStorage` return `true`; `DisabledReceiptStorage` returns `false`.)

- [ ] **Step 2: Failing test**

```ts
// packages/api/src/repositories/in-memory/receipt-storage.test.ts
import { describe, expect, it } from 'vitest'
import { InMemoryReceiptStorage } from './receipt-storage'

describe('InMemoryReceiptStorage', () => {
  it('stores under a vehicle-scoped key and streams it back', async () => {
    const storage = new InMemoryReceiptStorage()
    const file = new File([new Uint8Array([1, 2, 3])], 'damage.jpg', { type: 'image/jpeg' })
    const { key } = await storage.put('v1', file)
    expect(key).toMatch(/^receipts\/v1\/[0-9a-f-]+\.jpg$/)
    const got = await storage.getFile(key)
    expect(got?.contentType).toBe('image/jpeg')
  })
  it('getFile returns null for an unknown key', async () => {
    expect(await new InMemoryReceiptStorage().getFile('receipts/v1/nope.jpg')).toBeNull()
  })
})
```

Run: fails — module not found.

- [ ] **Step 3: Implement the three.** `r2-receipt-storage.ts` mirrors `R2PhotoStorage` (`r2-photo-storage.ts:24`) for `put` (key `receipts/${vehicleId}/${crypto.randomUUID()}.${ext}`, `bucket.put(key, file.stream(), { httpMetadata: { contentType } })`) and the renter-documents storage for `getFile` (bucket `.get(key)` → `{ body, contentType }`, null on miss) — reuse the existing `R2BucketLike` shape. `disabled-receipt-storage.ts`: `put` throws `'HANDOFF_RECEIPTS bucket not configured'`, `getFile` returns `null`. `in-memory/receipt-storage.ts`: `Map<string, { contentType: string }>` + a stored `Uint8Array`, mirroring `InMemoryPhotoStorage`'s helpers (`has()`, `size()`).

- [ ] **Step 4: Composition + binding.** In `composition/repositories.ts`, next to the RENTER_DOCUMENTS resolution (`:441-446` — the private-bucket precedent to copy): resolve `(globalThis as Record<string, unknown>).HANDOFF_RECEIPTS as R2BucketLike | undefined` → `R2ReceiptStorage` else `DisabledReceiptStorage`; in-memory branches use `overrides.receiptStorage ?? new InMemoryReceiptStorage()`; add the `receiptStorage` field to `Repos` + `app-overrides.ts`. In `wrangler.toml` after the RENTER_DOCUMENTS block (~line 121):

```toml
# HANDOFF_RECEIPTS: private custody-receipt evidence photos (one-way custody §6),
# served through the Worker only — no public URL. Bucket created at go-live.
[[r2_buckets]]
binding = "HANDOFF_RECEIPTS"
bucket_name = "kuruma-handoff-receipts"
```

and in `[env.production]` add the same block **commented out** with a note (mirror the VEHICLE_PHOTOS prod pattern — an absent binding must not break boot; DisabledReceiptStorage covers it and only bites if the checklist requires photos).

- [ ] **Step 5: Verify + commit**

```bash
bun run --filter @kuruma/api test -- receipt-storage && bunx tsc -p packages/api --noEmit
git add packages/api
git commit -m "feat(custody): private ReceiptStorage port (R2/disabled/in-memory)"
```

### Task 12: Vehicle placement (on-ramp) / dark sync / re-label rule

**Files:**
- Modify: `packages/api/src/services/vehicle.ts` (create `:135` region, update `:164-200` region; ctor gains `runInTransaction` + `isCustodyEnabled`)
- Modify: composition root — thread the two new ctor args
- Test: extend the vehicle service test file (find via `ls packages/api/src/services/vehicle*.test.ts`)

- [ ] **Step 1: Failing service tests** (add to the existing vehicle service suite, using its fixture idiom; write them fully against the real service API — the constructor gains `runInTransaction: RunInTransaction` and `isCustodyEnabled: () => Promise<boolean>`, tests pass `async () => false` / `async () => true`):

```ts
describe('custody placement / dark sync / re-label (§3/§9/§13)', () => {
  it('create with a pickup location places the car AT_STATION at home WITH a baseline period', async () => {
    // service.create(ctx, { ...validVehicleData, pickupLocationId: LOC_A })
    // expect vehicle.custodyState 'AT_STATION', physical pair (OPERATOR_ID, LOC_A),
    // openCustodyPeriodId set; the period repo holds ONE open row for the vehicle
    // with openedByLegId null, rate snapshots 0 (§13 baseline).
  })
  it('create without a location stays custody-untracked (no period)', async () => {})
  it('first location assignment on update places the car + opens a baseline period (the on-ramp)', async () => {})
  it('flag OFF: changing pickupLocationId MOVES the physical pair and rolls the baseline period (legacy sync)', async () => {
    // old open period closed (closedByLegId null), new open period at the new
    // location, physical pair + openCustodyPeriodId updated — one transaction.
  })
  it('flag ON: changing pickupLocationId is a re-label — physical pair, period, state UNCHANGED', async () => {})
  it('flag OFF: clearing pickupLocationId untracks custody and closes the open period', async () => {})
  it('flag OFF: sync is refused while IN_TRANSIT (defensive — cannot happen while dark, but never corrupt)', async () => {})
})
```

Run → FAIL (extra ctor args missing / custody fields not written).

- [ ] **Step 2: Implement the placement helper** (private method on `VehicleService`, used by create and update — all inside `this.runInTransaction`, first statement `await repos.vehicleTimelineLock.lockVehicleTimeline(vehicleId)`):

```ts
  /** §13 on-ramp: place an untracked car AT_STATION at home with a baseline
   *  custody period — the three-way CHECK requires both to land together. */
  private async placeAtHomeInTx(
    repos: TransactionRepos,
    vehicle: Vehicle,
    homeLocationId: string,
  ): Promise<void> {
    // §4 rev.8: every write that newly references a location serializes
    // against archival — FOR SHARE + ACTIVE re-check in the same tx.
    await repos.locationShareLock.lockLocationsForShare([homeLocationId])
    // (re-validate the location is the operator's and ACTIVE here; 400 INVALID_LOCATION)
    const period = await repos.custodyPeriodRepo.open({
      vehicleId: vehicle.id,
      ownerOperatorId: vehicle.operatorId,
      hostOperatorId: vehicle.operatorId,
      hostLocationId: homeLocationId,
      receivedAt: new Date(),
      openedByLegId: null, // baseline — no leg existed (§13)
      dailyRateJpySnapshot: 0,
      handoffFeeJpySnapshot: 0,
    })
    await repos.vehicleCustody.updateCustody(vehicle.id, {
      custodyState: 'AT_STATION',
      physicalHostOperatorId: vehicle.operatorId,
      physicalLocationId: homeLocationId,
      openCustodyPeriodId: period.id,
    })
  }
```

`create`: when `input.pickupLocationId` is set, the insert + `placeAtHomeInTx` run in ONE `runInTransaction` — **a follow-up transaction is not acceptable** (P0-B): a crash between the two writes mints a home-based untracked car (search lists via the COALESCE fallback, checkout rejects on the null anchor), and the Task 6 trigger now fails the split write at commit anyway. Wrap the existing insert if it is not already transactional.
`update` (merge block ~`:193`), after computing `nextPickup`:

```ts
    // §3/§9/§13: placement vs dark-sync vs re-label.
    // - Untracked + first location  = placement (on-ramp): baseline period + AT_STATION.
    // - Flag OFF + home change      = the car "moves" (today's semantics): roll the
    //   baseline period to the new location so physical state stays byte-equivalent
    //   to pickupLocationId while dark (§14.1 facts-honored guarantee).
    // - Flag ON + home change       = a re-label; physical state NEVER moves (§9).
    if (existing.custodyState === null && nextPickup) {
      await this.runInTransaction(async (repos) => {
        await repos.vehicleTimelineLock.lockVehicleTimeline(existing.id)
        await this.placeAtHomeInTx(repos, existing, nextPickup)
      })
    } else if (existing.custodyState !== null && nextPickup !== existing.pickupLocationId) {
      if (!(await this.isCustodyEnabled())) {
        await this.runInTransaction(async (repos) => {
          await repos.vehicleTimelineLock.lockVehicleTimeline(existing.id)
          if (nextPickup) await repos.locationShareLock.lockLocationsForShare([nextPickup]) // §4 rev.8
          if (existing.custodyState !== 'AT_STATION') return // never corrupt IN_TRANSIT
          // Roll the baseline: close-then-open keeps the one-open seal + the
          // openCustodyPeriodId FK consistent with the new physical pair.
          await repos.custodyPeriodRepo.closeOpen(existing.id, { departedAt: new Date(), closedByLegId: null })
          if (nextPickup) {
            const period = await repos.custodyPeriodRepo.open({
              vehicleId: existing.id,
              ownerOperatorId: existing.operatorId,
              hostOperatorId: existing.operatorId,
              hostLocationId: nextPickup,
              receivedAt: new Date(),
              openedByLegId: null,
              dailyRateJpySnapshot: 0,
              handoffFeeJpySnapshot: 0,
            })
            await repos.vehicleCustody.updateCustody(existing.id, {
              physicalHostOperatorId: existing.operatorId,
              physicalLocationId: nextPickup,
              openCustodyPeriodId: period.id,
            })
          } else {
            await repos.vehicleCustody.updateCustody(existing.id, {
              custodyState: null,
              physicalHostOperatorId: null,
              physicalLocationId: null,
              openCustodyPeriodId: null,
            })
          }
        })
      }
      // Flag ON: §9 re-label — physical state untouched, but the HOME write
      // itself must serialize against archival (§4 rev.8): run the
      // pickupLocationId update inside runInTransaction with
      // lockLocationsForShare([nextPickup]) + an ACTIVE re-check, so a home
      // base can never land on a concurrently-archived location. Region/
      // geocode side effects stay as-is.
    }
```

Wire `() => featureFlagsService.isEnabled('ONE_WAY_CUSTODY')` + `runInTransaction` as the new ctor args at the composition root (mirror how `BookingService` receives its flag reader at `index.ts:458`).

- [ ] **Step 3: Run to PASS, full suite, commit**

```bash
bun run --filter @kuruma/api test -- services/vehicle && bun run --filter @kuruma/api test && bunx tsc -p packages/api --noEmit
git add packages/api
git commit -m "feat(custody): vehicle placement on-ramp + dark-sync period roll + re-label rule"
```

### Task 13: `CustodyService` — receipt gate, reposition, listing, promo, checklist

**Files:**
- Create: `packages/api/src/services/custody-motion.ts` (shared in-tx depart/void helpers)
- Create: `packages/api/src/services/custody.ts` (+ `custody.test.ts`)
- Modify: `packages/shared/src/lib/error-codes.ts` (+ membership test): add `'CUSTODY_CONFLICT'`, `'IDEMPOTENCY_MISMATCH'`, `'RECEIPT_CHECKLIST_INCOMPLETE'`

- [ ] **Step 1: The shared in-tx motion helpers** (used by this service, booking-lifecycle, and booking-create — one definition of "depart" and "void"):

```ts
// packages/api/src/services/custody-motion.ts
// One-way custody §5 transitions that run INSIDE an existing runInTransaction
// under the per-vehicle timeline lock. No-ops when the vehicle has no leg —
// that is exactly the dark-flag / legacy-booking case, so callers never branch.
import type { ReceiptChecklistItem } from '@kuruma/shared/db/schema'
import { departCustody } from '@kuruma/shared/lib/custody-state'
import type { TransactionRepos } from '../repositories/types-transactions'
import type { Vehicle } from '../stores'

/** Custody-transition failure — thrown INSIDE runInTransaction so the whole
 *  tx (including any booking-status write before it) rolls back. The calling
 *  service maps it to 409 CUSTODY_CONFLICT. */
export class CustodyTransitionConflict extends Error {}

/** Rental/reposition start: validate custody FIRST, then flip the leg,
 *  close the open custody period, go IN_TRANSIT with the in-flight leg
 *  reference (§3/§5). The ONE definition of "depart".
 *  §5 rev.8 — all-or-nothing: every constituent write must succeed or this
 *  THROWS and the surrounding tx rolls back. A partial depart (leg departed,
 *  car still AT_STATION, booking ACTIVE) must be impossible, not skipped. */
export async function departVehicleInTx(
  repos: TransactionRepos,
  vehicle: Vehicle,
  ownerChecklist: readonly ReceiptChecklistItem[],
  legId: string,
  departedAt: Date,
): Promise<void> {
  const transition = departCustody(vehicle)
  if (!transition.ok) {
    // Sole idempotent exception (§5): already IN_TRANSIT on THIS leg = a
    // completed retry — every write below already happened; no-op.
    if (vehicle.custodyState === 'IN_TRANSIT' && vehicle.inFlightLegId === legId) return
    throw new CustodyTransitionConflict(`vehicle ${vehicle.id} cannot depart: ${transition.reason}`)
  }
  const marked = await repos.movementLegRepo.markDeparted(legId, {
    departedAt,
    checklistSnapshot: [...ownerChecklist],
  })
  if (!marked) {
    // Car AT_STATION but the leg is not PLANNED (departed/voided elsewhere) —
    // inconsistent input, never a silent skip.
    throw new CustodyTransitionConflict(`leg ${legId} is not departable`)
  }
  const closed = await repos.custodyPeriodRepo.closeOpen(vehicle.id, { departedAt, closedByLegId: legId })
  if (!closed) throw new CustodyTransitionConflict(`vehicle ${vehicle.id} has no open custody period`)
  const updated = await repos.vehicleCustody.updateCustody(vehicle.id, {
    ...transition.next,
    inFlightLegId: legId,
    openCustodyPeriodId: null,
  })
  if (!updated) throw new CustodyTransitionConflict(`vehicle ${vehicle.id} custody write failed`)
}

/** Pre-departure cancel: void the planned leg. A departed leg is left in flight —
 *  that IS the active-cancel recovery leg (§5); only a receipt lands it. */
export async function voidBookingLegInTx(
  repos: TransactionRepos,
  bookingId: string,
  vehicleId: string,
  voidedAt: Date,
): Promise<void> {
  const leg = await repos.movementLegRepo.findLiveByBookingAndVehicle(bookingId, vehicleId)
  if (!leg) return
  await repos.movementLegRepo.markVoided(leg.id, voidedAt)
}
```

(`@kuruma/shared/lib/custody-state` may need a `package.json` subpath export in `packages/shared` — mirror how `lib/error-codes` is exported; add `./lib/custody-state`, `./lib/custody-timeline`, `./lib/custody-feasibility`, `./lib/request-fingerprint` in one edit.)

- [ ] **Step 2: Failing service tests** — `services/custody.test.ts` with hand-rolled deps (in-memory repos + `runInTransaction: (fn) => fn(bundle)` where `bundle` includes the in-memory repos, `vehicleTimelineLock`/`locationShareLock`: the in-memory availability repo (or `{ lockVehicleTimeline: async () => () => {}, lockLocationsForShare: async () => {} }`), and `vehicleCustody` = the in-memory vehicle repo). Cases (write all — mutation-resistant, assert exact fields):
  - `receiveVehicle` happy path (empty checklist snapshot): given an in-flight RENTAL leg to `LOC_B` whose booking is **`COMPLETED`**, receiving at `LOC_B` with NO photos and NO condition fields → leg `receivedAt` set; ARRIVAL receipt row with the minimal core (actor/at/capturedAt/idempotencyKey/fingerprint), empty `photoStorageKeys`; vehicle `AT_STATION` at `(op, LOC_B)` with `inFlightLegId: null` + `openCustodyPeriodId` = the new period's id; `heldOffline: true` (default wait-for-owner); custody period opened with both snapshots `0`, `openedByLegId` = leg id. **This is the Q5 minimal-receipt pin.**
  - **checklist enforcement (Q5): leg `checklistSnapshot: ['PHOTOS','ODOMETER']`, receive with zero photos + no odometer → 400 `RECEIPT_CHECKLIST_INCOMPLETE` naming both items**; with 1 photo + odometer → succeeds. A `null` snapshot behaves as minimal core.
  - **ordering (§5): booking still `ACTIVE` → 409 `CUSTODY_CONFLICT`** ("complete the booking before receiving"). A STAFF_REPOSITION leg needs no booking check.
  - **replay (§6): same `idempotencyKey` + same payload after success → the same receipt (`ok: true`)** even though the leg is no longer in flight (check-first, before the in-flight precondition). **Same key + DIFFERENT payload → 409 `IDEMPOTENCY_MISMATCH`** (fingerprint comparison).
  - **no-re-target (§5): a NORMAL arrival at a location ≠ the leg's planned `toLocationId` → 409 `CUSTODY_CONFLICT`** naming the planned destination. Recovery re-target: leg planned to `LOC_B`, booking `CANCELLED`, received at `LOC_C` → leg `toLocationId` becomes `LOC_C`, vehicle at `LOC_C`.
  - `autoRelistOnReceipt: true` → `heldOffline: false` after receipt.
  - receipt at HOME clears the promo pair.
  - no in-flight leg (and an unknown `idempotencyKey`) → `{ ok: false, status: 409, code: 'CUSTODY_CONFLICT' }`.
  - cross-tenant vehicle → 404; archived or cross-tenant location → 400 `INVALID_LOCATION`.
  - **preflight (decision 20): cross-tenant vehicle WITH photos → 404 AND the receipt storage stays empty** (assert `InMemoryReceiptStorage.size() === 0` — no upload before authorization); a replayed receive (same key, same payload, with photos) returns the prior receipt without a second upload.
  - **photo-hash binding (decision 14): same key, same photo COUNT, different photo bytes → 409 `IDEMPOTENCY_MISMATCH`** (the fingerprint hashes content, not count).
  - a DIFFERENT-key second receive → 409 (leg already received).
  - `startReposition` happy path (decision 18 — no destination input): creates a **planned** STAFF_REPOSITION leg (from = current physical pair, **to = the car's home base — always**, `plannedEndAt` = now + 24h) **then departs it through `departVehicleInTx`** → leg `departedAt` set + `checklistSnapshot` = the owner's config; the open custody period CLOSED with `closedByLegId` = leg id; vehicle `IN_TRANSIT` with `inFlightLegId` = leg id; **and a minimal `DEPARTURE` receipt row exists for the leg (mandatory for repositions, decision 11)** with `atLocationId` = the origin.
  - `startReposition` while `IN_TRANSIT` → 409 `CUSTODY_CONFLICT`; **already at home → 409 `CUSTODY_CONFLICT`** (nothing to bring home); **home base archived (or none) → 400 `INVALID_LOCATION`** ("re-label the home base first").
  - **reposition continuity (§9): ANY pending leg (e.g. a future confirmed booking) → 409 `CUSTODY_CONFLICT`** ("substitute or cancel future bookings first").
  - **never flag-gated (§9/§14.1 rev.8): a displaced car's reposition succeeds with the flag OFF** — every reposition is homeward recovery; there is no outbound case to gate.
  - `startReposition` replay (same `idempotencyKey`) → `ok: true`, no second leg; same key after a home re-label (fingerprint differs) → 409 `IDEMPOTENCY_MISMATCH`.
  - `setListing` toggles `heldOffline` / `autoRelistOnReceipt` regardless of flag (never gated); `setPromoHome` writes the pair, rejects a past `cutoffAt` (400), **404 when the flag is OFF**; `clearPromoHome` nulls both (allowed while OFF — it reduces exposure).
  - `setReceiptChecklist` / `getReceiptChecklist`: writes/reads `operators.receiptChecklist` (tenant-bound; validates against `RECEIPT_CHECKLIST_ITEMS`); **enabling `PHOTOS` while `receiptStorage.isConfigured()` is false → 400** (decision 20) — items without `PHOTOS` still succeed in that environment.

Run: FAIL — module not found.

- [ ] **Step 3: Implement `CustodyService`.** Shape (deps object — >4 collaborators):

```ts
// packages/api/src/services/custody.ts
import { receiveCustody } from '@kuruma/shared/lib/custody-state'
import { requestFingerprint } from '@kuruma/shared/lib/request-fingerprint'
import type { ErrorCode } from '@kuruma/shared/lib/error-codes'
import type { RunInTransaction } from '../repositories/types-transactions'
import type { CustodyPeriodRepository, HandoffReceiptRepository, MovementLegRepository } from '../repositories/types-custody'
import type { ReceiptStorage } from '../repositories/types-storage'
import { resolveOperatorIdForWrite } from '../tenancy'
// ... CallerContext, Vehicle, stores types

/** §9: a reposition's arrival time is unknowable at start; the projection only
 *  needs to move the car off its origin, so a nominal same-day horizon is
 *  enough. The receipt supplies the actual. */
const REPOSITION_PROJECTION_HOURS = 24

export interface CustodyServiceDeps {
  runInTransaction: RunInTransaction
  receiptStorage: ReceiptStorage
  isCustodyEnabled: () => Promise<boolean>
  // Standalone reads for GET surfaces (outside any tx):
  movementLegRepo: Pick<MovementLegRepository, 'findInFlightByVehicle'>
  handoffReceiptRepo: Pick<HandoffReceiptRepository, 'findByVehicle' | 'findById'>
  custodyPeriodRepo: Pick<CustodyPeriodRepository, 'findByVehicle'>
  vehicleRepo: /* same findById shape booking-creation uses at :274 */
  operatorRepo: /* findById + an updateReceiptChecklist write (add to the operator repo if absent) */
  locationRepo: /* tenant-bound findById */
}
```

Method logic, in order (all writes go through `runInTransaction`; first statement inside the tx is `lockVehicleTimeline(vehicleId)`):
  - `receiveVehicle(ctx, vehicleId, input, photos: File[])` — **decision 20 order: preflight → upload → locked tx.**
    (P) **Preflight, before any byte reaches storage:** resolve operator (`resolveOperatorIdForWrite`); load vehicle (404 on miss/cross-tenant); compute per-photo SHA-256 (`crypto.subtle.digest` over each `File`'s bytes) and `fingerprint = await requestFingerprint({ locationId, fuelPercent: input.fuelPercent ?? null, odometerKm: input.odometerKm ?? null, damageReported: input.damageReported, conditionNotes: input.conditionNotes ?? null, photoHashes: [...hashes].sort() })`; replay-resolve `input.idempotencyKey` (hit + fingerprint match ⇒ return the prior receipt now, no upload; hit + mismatch ⇒ 409 `IDEMPOTENCY_MISMATCH`); require an in-flight leg (none + unknown key ⇒ 409). These are unlocked reads — the tx re-checks all of them authoritatively.
    (U) Upload photos (R2 is not transactional; orphaned keys now require a race/crash between preflight and commit — accepted, comment it).
    (T) Then in-tx, in this exact order:
    1. `lockVehicleTimeline(vehicleId)`.
    2. **Replay first (§6):** `handoffReceiptRepo.findByIdempotencyKey(input.idempotencyKey)` → hit + `requestFingerprint` matches ⇒ return it as `ok: true`; hit + mismatch ⇒ 409 `IDEMPOTENCY_MISMATCH`. (A retry of a completed receive must not fall through to "no in-flight leg"; a 23505-then-query approach cannot work — the 23505 aborts the tx.)
    3. Load vehicle (404 on miss/cross-tenant) → `findInFlightByVehicle` (none ⇒ 409 `CUSTODY_CONFLICT`).
    4. **Ordering gate (§5):** RENTAL leg ⇒ load its booking; status must be `COMPLETED` or `CANCELLED`, else 409 ("complete the booking before receiving"). `isRecovery = status === 'CANCELLED'`. STAFF_REPOSITION/TRANSFER need only be in flight.
    5. `lockLocationsForShare([input.locationId])` (§4 rev.8 — the receiving location is a new reference; serializes against archival), then: location must exist, belong to the operator, and be ACTIVE (400 `INVALID_LOCATION`).
    6. **No-re-target gate (§5):** `!isRecovery && input.locationId !== leg.toLocationId` ⇒ 409 naming the planned destination.
    7. **Checklist gate (Q5):** `missing = missingChecklistItems(leg.checklistSnapshot ?? [], input, photos.length)`; non-empty ⇒ 400 `RECEIPT_CHECKLIST_INCOMPLETE` listing the items. (`missingChecklistItems` = a small exhaustive function in this file: `PHOTOS` ⇒ `photoCount >= 1`, `FUEL` ⇒ `fuelPercent != null`, `ODOMETER` ⇒ `odometerKm != null`, `DAMAGE_NOTES` ⇒ `conditionNotes` non-empty.)
    8. **Recovery re-target first** (so the deferred endpoint trigger sees a consistent pair): if recovery and `input.locationId !== leg.toLocationId`, that is folded into `markReceived`'s `to*` args. `markReceived` (undefined ⇒ 409 already-received) → `handoffReceiptRepo.create({ legId, vehicleId, phase: 'ARRIVAL', ..., requestFingerprint: fingerprint })` (a residual named 23505 = true race ⇒ let it abort; the client retry replays via step 2) → `custodyPeriodRepo.open({ ..., dailyRateJpySnapshot: 0, handoffFeeJpySnapshot: 0, openedByLegId: legId })` → `receiveCustody(vehicle, operatorId, input.locationId)` → `repos.vehicleCustody.updateCustody(vehicleId, { ...transition.next, inFlightLegId: null, openCustodyPeriodId: period.id, heldOffline: !vehicle.autoRelistOnReceipt, ...(input.locationId === vehicle.pickupLocationId ? { homewardPromoPercent: null, homewardPromoCutoffAt: null } : {}) })`.
  - `startReposition(ctx, vehicleId, input)` — **decision 18: no destination input; the destination IS the car's current home base; never flag-gated.** Resolve operator; in-tx: lock → load vehicle (404 cross-tenant) → `home = vehicle.pickupLocationId` (null ⇒ 400 `INVALID_LOCATION` "assign a home base first") → `fingerprint = await requestFingerprint({ toLocationId: home })` → **replay first** via `movementLegRepo.findByIdempotencyKey` (fingerprint compare, as above — a re-label between retries is a different claim) → vehicle AT_STATION or 409 → **already at home ⇒ 409 `CUSTODY_CONFLICT`** → **`findPendingByVehicle` must be EMPTY or 409** (§9 continuity rule) → `lockLocationsForShare([origin, home])` → home owner-active or 400 `INVALID_LOCATION` ("re-label the home base first") → `movementLegRepo.create({ kind: 'STAFF_REPOSITION', bookingId: null, from: physical pair, to: home, plannedStartAt: now, plannedEndAt: +REPOSITION_PROJECTION_HOURS, idempotencyKey, requestFingerprint: fingerprint })` — **created PLANNED** — then `departVehicleInTx(repos, vehicle, operator.receiptChecklist, leg.id, now)` **and write the mandatory minimal DEPARTURE receipt in the same tx** (`handoffReceiptRepo.create({ legId, vehicleId, phase: 'DEPARTURE', actorUserId: ctx.userId, atOperatorId/atLocationId: the origin pair, capturedAt: now, photoStorageKeys: [], idempotencyKey: input.idempotencyKey + ':dep', requestFingerprint: fingerprint })`).
  - `setListing` / `clearPromoHome`: tenant-check then `updateCustody` — never flag-gated (state-driven / exposure-reducing). `setPromoHome`: 404 when the flag is OFF; validates `cutoffAt > now` (400).
  - `getReceiptChecklist(ctx)` / `setReceiptChecklist(ctx, items)`: tenant-bound read/write of `operators.receiptChecklist` (validate items ∈ `RECEIPT_CHECKLIST_ITEMS`; **items containing `PHOTOS` while `!receiptStorage.isConfigured()` ⇒ 400** — decision 20).
  - `listReceipts(ctx, vehicleId)` (operator read, tenant-bound) and `getReceiptPhoto(ctx, receiptId, index)` → receipt (tenant-bound via its vehicle) → `receiptStorage.getFile(receipt.photoStorageKeys[index])` (404 on either miss).
  Results follow the repo-wide `{ ok: true, ... } | { ok: false; error; status; code? }` union; codes `satisfies ErrorCode` at the emit sites.

- [ ] **Step 4: Error codes.** Add `'CUSTODY_CONFLICT'`, `'IDEMPOTENCY_MISMATCH'`, `'RECEIPT_CHECKLIST_INCOMPLETE'` to `ERROR_CODES` (with a `// one-way custody §5/§6` comment) + the sorted membership list in `error-codes.test.ts`.

- [ ] **Step 5: Run to PASS + commit**

```bash
bun run --filter @kuruma/shared test -- error-codes && bun run --filter @kuruma/api test -- services/custody && bunx tsc -p packages/api --noEmit
git add packages/api packages/shared
git commit -m "feat(custody): CustodyService — receipt gate + checklist, staff reposition, listing, promo-home"
```

---

## Phase 5 — Booking + search integration

### Task 14: Booking lifecycle hooks (depart / void / recovery / substitution / assignment)

**Files:**
- Modify: `packages/api/src/services/booking-lifecycle.ts` (`updateStatus` :408, renter `cancel` :495, `substitute` :93, `assignVehicle` :250; ctor)
- Modify: composition root (thread `runInTransaction` + `isCustodyEnabled` into `BookingLifecycleService`)
- Test: extend `packages/api/src/services/booking-lifecycle.test.ts` (or the suite `tsc`/grep finds for this service)

- [ ] **Step 1: Failing tests.** Seed an in-memory world where a CONFIRMED booking has a RENTAL leg (create the leg directly via `InMemoryMovementLegRepository` with the booking's id + vehicle) and the vehicle is AT_STATION with an open custody period. Cases:
  - flag ON, `updateStatus(→ ACTIVE)`: leg `departedAt` set + `checklistSnapshot` = the owner's config; vehicle `IN_TRANSIT` (`inFlightLegId` = leg id, physical pair null, `openCustodyPeriodId` null); the open custody period closed with `closedByLegId` = leg id, `settlementState 'CLOSED'`.
  - **all-or-nothing depart (§5 rev.8, P1-D): flag ON, `updateStatus(→ ACTIVE)` when the car is NOT departable (e.g. already `IN_TRANSIT` on a different leg, or its open period is missing) → 409 `CUSTODY_CONFLICT` and the booking is STILL `CONFIRMED`** — the status write rolled back with the tx (`CustodyTransitionConflict` caught at the service boundary). Pin both: the status value and the untouched custody columns.
  - flag ON, `updateStatus(CONFIRMED → CANCELLED)` (operator pre-departure cancel): leg `voidedAt` set; vehicle custody untouched; period still open.
  - flag ON, `updateStatus(ACTIVE → CANCELLED)` (operator active cancel, #679): leg NOT voided, still in flight (`findInFlightByVehicle` returns it); vehicle stays `IN_TRANSIT` — the recovery leg waits for a receipt (§5).
  - flag ON, renter `cancel()` (CONFIRMED-only): leg voided.
  - flag ON, booking with NO leg (created while dark): every transition succeeds unchanged — hooks no-op.
  - flag OFF: repos untouched (spy: leg repo empty, vehicle custody unchanged) — **except** depart/receive of an EXISTING leg still runs (kill-switch: a booking that got its leg while ON must keep moving after a flip-OFF — §14.1 pending-legs rule). Pin with: flag OFF + existing leg + `updateStatus(→ ACTIVE)` still departs it.
  - **substitution, pre-departure** (flag ON, booking `CONFIRMED` with a leg on car X): `substitute(→ car Y)` → X's leg `voidedAt` set; a NEW planned leg exists for Y over the booking's window; exactly one LIVE leg per (booking, vehicle) — pin the seal with a test.
  - **substitution while ACTIVE** (flag ON, X departed): X's leg NOT voided, still live (detached recovery); Y gains a leg created PLANNED **then departed in the same tx** (`departedAt` = substitution instant, checklist snapshotted); Y `IN_TRANSIT` with `inFlightLegId`; X unchanged (`IN_TRANSIT`, waiting on its receipt). Both live legs share the bookingId — the (booking, vehicle) seal admits them (§4 rev.7).
  - **class-assignment CONFIRMED** (flag ON, CLASS_COMBO float, no leg): `assignVehicle(car Z)` → a planned RENTAL leg for Z over the booking window; the shared feasibility predicate rejects an assignment whose window overlaps Z's pending legs (409).
  - **class-assignment ACTIVE** (flag ON): the leg is created AND departed in the same tx (from = Z's physical location) — the rental is already underway (§5).
  - **two-vehicle lock order**: substitution acquires both vehicle locks in ascending `vehicleId` order (assert via a lock-spy recording acquisition order for both X<Y and Y<X id orderings).
  - **repeated swaps (decision 19, P1-G): X→Y, Y→X, X→Y again (all pre-departure, flag ON) — every substitution succeeds**; the three created legs carry DISTINCT generation keys (`...:gN`); the final live leg is Y's. A static per-pair key would 23505 on the third swap — this test pins the fix.
  - **substitution retry no-op: `substitute(→ Y)` when `booking.assignedVehicleId` is already Y → `ok: true`, no new leg, no void** (service-level retry safety — the generation key deliberately does not dedupe across commits).

Run → FAIL (service has no custody deps).

- [ ] **Step 2: Implement.** `BookingLifecycleService` ctor gains `runInTransaction: RunInTransaction` and `isCustodyEnabled: () => Promise<boolean>` (append; update all construction sites — grep `new BookingLifecycleService`). In `updateStatus`, after the transition-guard block (:424-431), replace the plain status write with a leg-aware path (note: the leg hooks run whenever a leg EXISTS, regardless of flag — §14.1):

```ts
    // §4: status flips that move the car mutate the timeline — same tx, same
    // lock. Runs whenever the booking HAS a leg (flag-independent: recovery of
    // an existing leg is never gated, §14.1); a legless (dark-era) booking
    // takes the legacy single-statement path unchanged.
    const updated = await this.runInTransaction(async (repos) => {
      if (booking.assignedVehicleId) {
        await repos.vehicleTimelineLock.lockVehicleTimeline(booking.assignedVehicleId)
      }
      const row = await repos.bookingRepo.updateStatus(ctx, bookingId, { from: booking.status, to: newStatus })
      if (!row) return undefined
      if (booking.assignedVehicleId) {
        const leg = await repos.movementLegRepo.findLiveByBookingAndVehicle(bookingId, booking.assignedVehicleId)
        const vehicle = await repos.vehicleRepo.findById(/* same shape as booking-creation.ts:274 */)
        if (leg && vehicle) {
          if (newStatus === 'ACTIVE') {
            const owner = await repos.operatorRepo.findById(vehicle.operatorId)
            // §5 rev.8: throws CustodyTransitionConflict on any non-departable
            // state — the tx (INCLUDING the status write above) rolls back.
            await departVehicleInTx(repos, vehicle, owner?.receiptChecklist ?? [], leg.id, new Date())
          }
          if (newStatus === 'CANCELLED' && booking.status === 'CONFIRMED') {
            await voidBookingLegInTx(repos, bookingId, booking.assignedVehicleId, new Date())
          }
          // ACTIVE→CANCELLED: deliberately nothing — the in-flight leg IS the
          // recovery leg; only a receipt returns the car to AT_STATION (§5).
        }
      }
      return row
    })
    // ...same post-write notification/refund flow on `updated`...
    // Wrap the runInTransaction call: catch CustodyTransitionConflict and map
    // it to { ok: false, status: 409, code: 'CUSTODY_CONFLICT' } — the rollback
    // already restored the booking status (rev.4, P1-D).
```

Renter `cancel()` (:495): same shape — wrap its status write in `runInTransaction` with the lock + `voidBookingLegInTx` (renter cancel is CONFIRMED-only, so it is always a pre-departure void). Keep the fork minimal — the fee/refund/notification logic stays exactly where it is; only the status-write statement moves inside the tx.

- [ ] **Step 2b: Substitution + assignment hooks (§5).** Both already run inside `runInTransaction`; the custody additions live inside those existing transactions (gated on `await this.isCustodyEnabled()` for CREATING new legs — creating movement is outbound and flag-gated; voiding/departing existing legs is not):
  - `substitute` (:93): **retry guard first — `newVehicleId === booking.assignedVehicleId` ⇒ `ok: true` no-op (decision 19)**. When the booking has a live leg on the old car, acquire BOTH timeline locks in **ascending `vehicleId` order** immediately after the tx opens (extract a tiny `lockVehiclesInOrder(repos, ids)` helper next to the motion helpers). After the reassign succeeds: run the shared feasibility predicate against the replacement (reject 409 on overlap/anchor failure — substitution must not bypass what create enforces); then booking `CONFIRMED` ⇒ `markVoided(oldLeg)` + `movementLegRepo.create` a planned leg for the replacement (window `[startAt, effectiveEndAt]`, **generation key: `` `booking:${bookingId}:${newVehicleId}:g${await repos.movementLegRepo.countByBookingAndVehicle(bookingId, newVehicleId)}` `` — counted under the locks; a voided leg keeps its key, so X→Y→X→Y needs `g0/g1/...`**, fingerprint over the window+endpoints); booking `ACTIVE` ⇒ leave the old leg live (detached recovery — a receipt lands it) and create the replacement's leg PLANNED then `departVehicleInTx` it in the same tx (one definition of depart; the (booking, vehicle) seal admits both live legs).
  - `assignVehicle` (:250): **same retry guard (already assigned to this car ⇒ no-op)**; lock the assigned vehicle, run the shared feasibility predicate for the booking's window against the car's pending legs (409 on failure), create the booking's planned RENTAL leg (**same generation-key form**); when the booking is already `ACTIVE`, follow with `departVehicleInTx` in the same tx. A float created while dark and assigned while ON gets its leg here — "every booking has a leg" holds at the assignment boundary.

- [ ] **Step 3: Run to PASS; full api suite; commit**

```bash
bun run --filter @kuruma/api test -- booking-lifecycle && bun run --filter @kuruma/api test && bunx tsc -p packages/api --noEmit
git add packages/api
git commit -m "feat(custody): lifecycle depart/void/recovery + substitution/assignment legs under the timeline lock"
```

### Task 15: Booking-create — shared predicate, leg insert, promo pricing, kill-safe OFF path

**Files:**
- Modify: `packages/shared/src/lib/error-codes.ts` (+ test): add `'PICKUP_NOT_AT_LOCATION'`, `'ONEWAY_NOT_TAIL'`, `'DROPOFF_NOT_HOMEWARD'`, `'WINDOW_OVERLAPS_MOVEMENT'`
- Modify: `packages/api/src/services/booking-creation.ts`
- Test: extend the booking-creation unit suite + `packages/api/tests/integration/bookings.test.ts`

- [ ] **Step 1: Failing tests.** Unit (in-memory createApp or service-level, whichever the existing suite uses), all with flag ON unless stated:
  - one-way SPECIFIC A→B (both owner-active, car at A, no pending legs) → 201; a `movement_legs` row exists with `kind 'RENTAL'`, `bookingId`, from A to B, planned window `[startAt, effectiveEndAt]`, `idempotencyKey` = `booking:<id>`.
  - round trip → 201 with a leg (planned A→A).
  - pickup where the car is NOT (car physically at B, request pickup A = its home) → 400 `PICKUP_NOT_AT_LOCATION` — **the §8 anchor: home is not a pickup for a displaced car.**
  - displaced same-op car at branch B → booking B→A homeward → 201. **The slice's headline behavior.**
  - displaced at B → B→B round trip → 201 (Q1 approval); B→C onward → 400 `DROPOFF_NOT_HOMEWARD`.
  - **anchor pin (rev.6 P0-1): car at A with a pending A→B leg — booking at B for a window after the leg settles → 400 `PICKUP_NOT_AT_LOCATION`** (destination unreceived; nothing is promoted).
  - car at A with a pending A→B leg — booking at A for a window after the leg settles → 400 `PICKUP_NOT_AT_LOCATION` (rule 3: the car will be gone).
  - window overlapping a scheduled STAFF_REPOSITION leg → 409 `WINDOW_OVERLAPS_MOVEMENT`.
  - one-way before an existing future booking (leg) → 400 `ONEWAY_NOT_TAIL`.
  - dropoff at an ARCHIVED owner location → 400 `DROPOFF_NOT_HOMEWARD`.
  - **IN_TRANSIT / heldOffline car → 409 `CUSTODY_CONFLICT` even for a window after its projected arrival (Q3)** — the §8 rule-1 presence gate.
  - **displaced SPECIFIC skips the class capacity gate: car of class K displaced at B where at-B combo capacity is 0 → 201** (spec §8; the gate at :420-442 would zero it out).
  - flag OFF: leg table stays empty; today's `:331` pickup-equality behavior byte-identical for an at-home car (re-run an existing test unchanged); **kill-safe: a DISPLACED tracked car (physicalLocationId ≠ pickupLocationId) is NOT bookable at its home station → 409 `CUSTODY_CONFLICT`** (§14.1); **one-way request (dropoff ≠ pickup) → 404** (outbound gated).
  - **kill-safe leg fold (§14.1 rev.8, P0-A): flag OFF, car AT home, but an ON-era A→B leg settles before the requested window → 400 `PICKUP_NOT_AT_LOCATION`; window overlapping that leg → 409 `WINDOW_OVERLAPS_MOVEMENT`.** The search SQL folds legs unconditionally — a checkout that didn't would accept what search hides and hand Task 22 a stranded schedule to trip over.
  - promo: vehicle displaced at B with `homewardPromoPercent: 20`, cutoff future; booking B→home **arriving before the cutoff** → `totalPrice` uses `floor(base * 0.8)` + insurance/add-ons unchanged; same booking with `effectiveEndAt` AFTER the cutoff → full price (**arrival compare, not booked-by** — the standing correction); B→B → full price (promo only lands-home trips).

Run → FAIL.

- [ ] **Step 2: Error codes** — add the four (one `// one-way custody §8` comment block) + membership list.

- [ ] **Step 3: Implement in `booking-creation.ts`** (SPECIFIC path; CLASS_COMBO stays round-trip-only — the validator already forces it and Task 16 keeps displaced cars out of the pool):
  1. Ctor gains `isCustodyEnabled: () => Promise<boolean>` (wire like `isOperatorTermsEnabled`, `:136` precedent). Resolve once per `create()` before the tx and pass down (`custodyOn`).
  2. Inside `submitSpecificInTxLocked` (:378), immediately after the existing combo-capacity lock acquisition (:354-375 — combo lock FIRST, then vehicle lock; keep this order, it is the documented deadlock rule): `await repos.vehicleTimelineLock.lockVehicleTimeline(assignedVehicleId)` (always — cheap, and the OFF path also writes bookings that Task 14 may later move).
  3. `await repos.locationShareLock.lockLocationsForShare([input.pickupLocationId, input.dropoffLocationId])` (§4 — serializes against archival).
  4. Replace the pickup gate. **OFF (kill-safe, §14.1):**

```ts
        if (!custodyOn) {
          if (input.dropoffLocationId !== input.pickupLocationId) {
            return { ok: false, status: 404, error: 'One-way rentals are not available' }
          }
          if (vehicle.pickupLocationId !== input.pickupLocationId) {
            return { ok: false, status: 400, error: 'Vehicle is not available at this location' }
          }
          // Kill-safe: a tracked car must be custody-listable AND at home.
          // Byte-equivalent while never-flipped (backfill pins physical == home).
          if (
            vehicle.custodyState !== null &&
            !(
              vehicle.custodyState === 'AT_STATION' &&
              !vehicle.heldOffline &&
              vehicle.physicalLocationId === vehicle.pickupLocationId
            )
          ) {
            return { ok: false, status: 409, error: 'Vehicle is awaiting custody recovery', code: 'CUSTODY_CONFLICT' satisfies ErrorCode }
          }
          // §14.1 rev.8 (P0-A): facts are honored on the write side too. Legs
          // are empty while never-flipped (zero-cost then); after a kill, an
          // ON-era leg still excludes its stranded windows — search's SQL fold
          // and checkout must agree, or dark checkouts manufacture schedules
          // the Task 22 fence has to abort on.
          if (vehicle.custodyState !== null) {
            const pendingLegs = await repos.movementLegRepo.findPendingByVehicle(vehicle.id)
            if (projectedLocationAt(vehicle.physicalLocationId, pendingLegs, input.startAt) !== vehicle.physicalLocationId) {
              return { ok: false, status: 400, error: 'Vehicle will not be at this location for the selected dates', code: 'PICKUP_NOT_AT_LOCATION' satisfies ErrorCode }
            }
            if (pendingLegOverlaps(pendingLegs, input.startAt, effectiveEndAt)) {
              return { ok: false, status: 409, error: 'Vehicle has a scheduled movement in this window', code: 'WINDOW_OVERLAPS_MOVEMENT' satisfies ErrorCode }
            }
          }
        }
```

  **ON (§8 rules 1–5 + tail):**

```ts
        if (custodyOn) {
          // Rule 1 (presence): IN_TRANSIT/heldOffline/non-AVAILABLE never books (Q3).
          if (!isCustodyListable(vehicle)) {
            return { ok: false, status: 409, error: 'Vehicle is not currently available for booking', code: 'CUSTODY_CONFLICT' satisfies ErrorCode }
          }
          const pendingLegs = await repos.movementLegRepo.findPendingByVehicle(vehicle.id)
          const ownerLocations = await repos.locationRepo.findByOperator(SYSTEM_CONTEXT, vehicle.operatorId)
          const operator = await repos.operatorRepo.findById(vehicle.operatorId)
          const ownerActive = ownerActiveLocationIds({
            ownerOperatorId: vehicle.operatorId,
            ownerDeactivatedAt: operator?.deactivatedAt ?? new Date(0),
            locations: ownerLocations,
          })
          const feasibility = assessOneWayFeasibility({
            physicalLocationId: vehicle.physicalLocationId,
            pendingLegs,
            pickupLocationId: input.pickupLocationId,
            dropoffLocationId: input.dropoffLocationId,
            startAt: input.startAt,
            effectiveEndAt,
            homeBaseLocationId: vehicle.pickupLocationId,
            ownerActiveLocationIds: ownerActive,
            receivingLocationIds: ownerActive, // Slice 1: no host opt-in yet (§7)
          })
          if (!feasibility.ok) {
            const status = feasibility.reason === 'WINDOW_OVERLAPS_MOVEMENT' ? 409 : 400
            return { ok: false, status, error: custodyReasonMessage(feasibility.reason), code: feasibility.reason satisfies ErrorCode }
          }
        }
```

  (`custodyReasonMessage` = a small exhaustive `Record<OneWayCustodyReason, string>` in the same file. If `locationRepo` has no by-operator finder in the tx bundle, use its existing `findAll`-shaped method with the operator filter — check the real name in `repositories/types.ts`; `effectiveEndAt` is the one `resolveDropoffEffectiveEnd` (:226-246) computed — that helper's same-operator + turnaround behavior stays as-is.)
  5. **Capacity-gate skip (§8):** in the class `demand >= capacity` gate (:420-442), skip it when `custodyOn && vehicle.physicalLocationId !== null && vehicle.physicalLocationId !== vehicle.pickupLocationId` — a displaced car belongs to no combo pool, so its capacity is 0 by construction; its guards are the exclusion constraint + rules 3–4. At-home SPECIFIC bookings keep the gate unchanged.
  6. Promo (SPECIFIC pricing, after `calculateBookingPrice` :446-450) — **arrival compare**:

```ts
        // §9 promo-home: applies only to a trip that LANDS the car home, ARRIVING
        // by the cutoff — never the booking-creation clock.
        const promoActive =
          custodyOn &&
          vehicle.homewardPromoPercent !== null &&
          vehicle.homewardPromoCutoffAt !== null &&
          effectiveEndAt.getTime() <= vehicle.homewardPromoCutoffAt.getTime() &&
          input.dropoffLocationId === vehicle.pickupLocationId &&
          input.dropoffLocationId !== input.pickupLocationId
        const basePrice = promoActive
          ? Math.floor((rawBasePrice * (100 - (vehicle.homewardPromoPercent ?? 0))) / 100)
          : rawBasePrice
```

  7. Leg insert — in `submitSpecificInTxLocked` right after the booking row insert succeeds:

```ts
        if (custodyOn) {
          await repos.movementLegRepo.create({
            vehicleId: vehicle.id,
            kind: 'RENTAL',
            bookingId: booking.id,
            fromOperatorId: vehicle.operatorId,
            fromLocationId: input.pickupLocationId,
            toOperatorId: vehicle.operatorId,
            toLocationId: input.dropoffLocationId,
            plannedStartAt: input.startAt,
            plannedEndAt: effectiveEndAt,
            // Decision 19: the uniform generation form. At create no legs can
            // exist for the pair, so n is always 0 — uniformity beats a
            // second key format.
            idempotencyKey: `booking:${booking.id}:${vehicle.id}:g0`,
            requestFingerprint: await requestFingerprint({
              bookingId: booking.id,
              pickup: input.pickupLocationId,
              dropoff: input.dropoffLocationId,
            }),
          })
        }
```

  (Same tx ⇒ a failed leg insert rolls the booking back; the generation key + the (booking, vehicle) unique make retries inert.)

- [ ] **Step 4: Integration tests** — extend `tests/integration/bookings.test.ts` (real pg): flag ON via a `feature_flags` DB override row (insert `{ key: 'ONE_WAY_CUSTODY', enabled: true }` through the repo/table in `beforeAll`, delete in `afterAll`): the displaced-homeward 201 case + the leg row assert; the existing `#882 same-operator one-way guardrail` test (`:633`) must still pass (cross-operator dropoff → still 400 — `resolveDropoffEffectiveEnd` fires first).

Run: unit + `DATABASE_URL=... bunx vitest run tests/integration/bookings.test.ts --root packages/api` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api packages/shared
git commit -m "feat(custody): booking-create §8 predicate + leg insert + promo + kill-safe OFF path"
```

### Task 16: Search surfaces — anchor prefilter, custody conditions, display mapping

**Files:**
- Modify: `packages/api/src/repositories/drizzle/availability.ts` + `in-memory/availability.ts`
- Modify: `packages/api/src/services/flat-search.ts` (:181) + `packages/api/src/services/storefront-search.ts` (:157)
- Test: the availability repo suites (in-memory unit + `tests/integration` availability specs) + the flat-search/storefront-search service suites

- [ ] **Step 1: Failing tests** (in-memory unit — mirrors carry the exact same semantics as SQL):
  - a vehicle `IN_TRANSIT` never appears (`findAvailableVehicles`), any filter shape.
  - `heldOffline: true` never appears.
  - custody-untracked (`custodyState: null`) still appears in the unfiltered listing (flag-off equivalence pin).
  - **location filter matches on `physicalLocationId` ONLY (the §8 anchor)**: a car displaced at B appears for `locationId: B`, NOT for its home A; **a car at A with a pending A→B leg does NOT appear at B** (no promotion — the rev.6 P0-1 pin), and does not appear at A for windows after the leg settles (rule 3 excludes).
  - a car at A with earlier A→A round-trip legs still appears at A for later windows (rule 3 benign case).
  - a pending STAFF_REPOSITION leg overlapping the window excludes the car (rule 4 for non-bookings).
  - `checkVehicleAvailability`: same additions (pending-leg overlap → unavailable; departing-before-window → unavailable; IN_TRANSIT/heldOffline → unavailable).
  - `countClassCapacity`: a displaced car (`physicalLocationId != pickupLocationId`), an IN_TRANSIT car, and a heldOffline car are all excluded from the combo pool (§8 combo deferral, Q6).
  - flat-search: a displaced SPECIFIC card shows station B (`physicalLocationId`), not home A; storefront: the car groups under B's card. Untracked cars keep using `pickupLocationId`.

Run → FAIL.

- [ ] **Step 2: Drizzle implementation.** In `findAvailableVehicles` (`drizzle/availability.ts`):
  - conditions (:49-73) gain:

```ts
      // One-way custody §8 rule 1: IN_TRANSIT is never listable (Q3); NULL =
      // untracked legacy/unassigned stays listable (dark equivalence).
      sql`(${vehicles.custodyState} IS NULL OR ${vehicles.custodyState}::text = 'AT_STATION')`,
      eq(vehicles.heldOffline, false),
      // Rule 4 for non-booking movements: any live leg touching the window.
      sql`NOT EXISTS (
            SELECT 1 FROM movement_legs ml
            WHERE ml."vehicleId" = ${vehicles.id}
            AND ml."receivedAt" IS NULL AND ml."voidedAt" IS NULL
            AND COALESCE(ml."departedAt", ml."plannedStartAt") < ${toIso}::timestamptz
            AND ${fromIso}::timestamptz < ml."plannedEndAt"
          )`,
      // Rule 3 (projection EXCLUDES, §8): any live leg settling before the
      // window that lands anywhere other than the car's physical location means
      // the car will be gone — and its destination is unreceived (Q3-strict),
      // so it must not match ANY location for this window. Exact because under
      // the v1 leash every relocating leg is the last (tail rule): the only
      // settling legs that keep the car are P→P round trips.
      sql`NOT EXISTS (
            SELECT 1 FROM movement_legs ml
            WHERE ml."vehicleId" = ${vehicles.id}
            AND ml."receivedAt" IS NULL AND ml."voidedAt" IS NULL
            AND ml."plannedEndAt" <= ${fromIso}::timestamptz
            AND ml."toLocationId" IS DISTINCT FROM ${vehicles.physicalLocationId}
          )`,
```

  - the location filters (:78, :83-86) swap `vehicles.pickupLocationId` → `COALESCE(${vehicles.physicalLocationId}, ${vehicles.pickupLocationId})` (tracked cars anchor on the physical location; untracked cars keep today's behavior). **No widened prefilter, no post-filter fold — the anchor IS the filter (§8).**
  - `checkVehicleAvailability` (:97) and `countClassCapacity` (:205) get the same custody + two NOT-EXISTS conditions; `countClassCapacity` additionally gets `sql`(${vehicles.custodyState} IS NULL OR ${vehicles.physicalLocationId} = ${vehicles.pickupLocationId})`` (combo counts at-home inventory only — Q6).
  - In-memory mirror: same logic via `isCustodyListable` + `projectedLocationAt` + `pendingLegOverlaps` — give `InMemoryAvailabilityRepository` an optional constructor collaborator `movementLegs?: Pick<MovementLegRepository, 'findPendingByVehicle'>` (default: none → no legs), and pass the shared instance at both composition sites.

- [ ] **Step 3: Display mapping (§8: "every renter-facing display of a station uses `physicalLocationId`").** In `flat-search.ts` `toSpecific` (:181) and `storefront-search.ts` `groupByLocation` (:157), replace the `pickupLocationId` key with a shared one-liner (put it in `services/custody-display.ts` or as an exported helper in one of the two — one definition):

```ts
/** §8: a tracked car is displayed at the station it physically sits at; an
 *  untracked car falls back to its (legacy) pickup location. */
export function displayLocationId(v: Pick<Vehicle, 'custodyState' | 'physicalLocationId' | 'pickupLocationId'>): string | null {
  return v.custodyState === null ? v.pickupLocationId : v.physicalLocationId
}
```

CLASS_COMBO cards stay keyed on `pickupLocationId` — the pool is at-home-only inventory, so home == physical for every pool member.

- [ ] **Step 4: PASS + full suite + integration availability specs + commit**

```bash
bun run --filter @kuruma/api test && DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bunx vitest run tests/integration --root packages/api -t availability
git add packages/api
git commit -m "feat(custody): search anchors on physical location; projection excludes; display mapping"
```

### Task 17: Location archival guard (atomic)

**Files:**
- Modify: `packages/api/src/services/location.ts` (`archive` :209-240) + its ctor deps
- Modify: the location repository (both concretes) — `archiveIfUnreferenced`
- Modify: `packages/shared/src/lib/error-codes.ts` (+ test): add `'LOCATION_HAS_CUSTODY_ANCHORS'`
- Test: extend the location service suite + one real-pg case in `tests/integration/custody-repo.test.ts`

- [ ] **Step 1: Failing tests:** archiving a location that is (a) some vehicle's home base, (b) some vehicle's current `physicalLocationId`, or (c) a pending leg's endpoint (origin OR destination) → `{ ok: false, status: 409, code: 'LOCATION_HAS_CUSTODY_ANCHORS' }` with a count-bearing message; archiving an unreferenced location still works; the existing active-bookings 409 (:224-232) still fires first.

- [ ] **Step 2: Implement — single conditional UPDATE (§7: atomic, not check-then-act).** Add to the location repository (drizzle; in-memory mirrors synchronously):

```ts
  /** §7 archival guard: one statement, one snapshot — a home base, a car's
   *  physical location, or a live leg endpoint cannot be archived. Zero rows
   *  updated ⇒ the caller 409s (counts fetched separately only to word it).
   *  The reverse race is closed by the §4 FOR SHARE reads, not accepted. */
  async archiveIfUnreferenced(operatorId: string, locationId: string): Promise<Location | undefined> {
    const [row] = await this.db.execute(sql`
      UPDATE locations SET status = 'ARCHIVED'
      WHERE "operatorId" = ${operatorId} AND id = ${locationId} AND status = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v."pickupLocationId" = ${locationId})
        AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v."physicalLocationId" = ${locationId})
        AND NOT EXISTS (
          SELECT 1 FROM movement_legs ml
          WHERE ml."receivedAt" IS NULL AND ml."voidedAt" IS NULL
            AND (ml."fromLocationId" = ${locationId} OR ml."toLocationId" = ${locationId})
        )
      RETURNING *
    `)
    return row ? this.toLocation(row) : undefined
  }
```

In `LocationService.archive`, after the existing active-bookings check, replace the plain archive write with `archiveIfUnreferenced`; on `undefined`, fetch `countHomeBasedAt` + `countPhysicallyAt` + `countPendingTo` + `countPendingFrom` (ctor deps: `custodyReads: VehicleCustodyReads`, `legReads: Pick<MovementLegRepository, 'countPendingTo' | 'countPendingFrom'>`) purely to word the 409:

```ts
      return {
        ok: false,
        status: 409,
        error: `Cannot archive: ${homeBased} home-based, ${physical} present, ${pendingTo + pendingFrom} in-motion vehicles reference this location`,
        code: 'LOCATION_HAS_CUSTODY_ANCHORS' satisfies ErrorCode,
      }
```

(Not flag-gated: while dark, home-based counts protect assigned vehicles — if an existing archive test now fails because its fixture home-bases a vehicle there, that test documented data-loss behavior; reassign the fixture's vehicle and note it in the commit body. The route already forwards `code` via `failResult`.)

- [ ] **Step 3: PASS + commit**

```bash
bun run --filter @kuruma/api test -- services/location && bunx tsc -p packages/api --noEmit
git add packages/api packages/shared
git commit -m "feat(custody): atomic location archival guard (409 on custody anchors)"
```

### Task 18: Validators, routes, wiring

**Files:**
- Create: `packages/shared/src/validators/custody.ts`
- Create: `packages/api/src/routes/custody.ts` (+ route test `packages/api/tests/` mirroring a recent route suite)
- Create: `packages/api/src/composition/custody-service.ts` (builder — keeps `index.ts` under the cap)
- Modify: `packages/api/src/index.ts` (imports + destructure + builder call + `.route()` mounts)
- Modify: `packages/shared/package.json` (subpath exports for the new validators + custody libs if not done in Task 13)

- [ ] **Step 1: Validators** (`packages/shared/src/validators/custody.ts` — Zod at the boundary, exported via a `./validators/custody` subpath):

```ts
import { z } from 'zod'
import { RECEIPT_CHECKLIST_ITEMS } from '../enums'

/** §6: the minimal core is locationId + idempotency; everything else is
 *  checklist-driven and optional at the schema level — the SERVICE enforces
 *  the leg's snapshot (Q5). Parsed from multipart form fields — hence coerce. */
export const receiveVehicleSchema = z.object({
  locationId: z.string().uuid(),
  fuelPercent: z.coerce.number().int().min(0).max(100).optional(),
  odometerKm: z.coerce.number().int().min(0).optional(),
  damageReported: z.coerce.boolean().optional().default(false),
  conditionNotes: z.string().max(2000).optional(),
  idempotencyKey: z.string().uuid(),
})

/** Decision 18: repositions are home-only — the destination is derived
 *  server-side (the car's home base), never client-supplied. */
export const startRepositionSchema = z.object({
  idempotencyKey: z.string().uuid(),
})

export const custodyListingSchema = z
  .object({
    heldOffline: z.boolean().optional(),
    autoRelistOnReceipt: z.boolean().optional(),
  })
  .refine((d) => d.heldOffline !== undefined || d.autoRelistOnReceipt !== undefined, {
    message: 'Provide at least one field',
  })

export const promoHomeSchema = z.object({
  percent: z.number().int().min(1).max(100),
  cutoffAt: z.coerce.date(),
})

export const receiptChecklistSchema = z.object({
  items: z.array(z.enum(RECEIPT_CHECKLIST_ITEMS)).max(RECEIPT_CHECKLIST_ITEMS.length),
})
```

- [ ] **Step 2: Routes** — `packages/api/src/routes/custody.ts`, `createCustodyRoutes(service, photoUploadLimiter, photoUploadUserLimiter)`, following `vehicle-photos.ts`'s multipart idiom (`:43-61`: `requireUser` → `requireFleetWriteRole` → `parseId` → `rejectOversizedBody` → form extraction → service → `ok`/`failResult`). **Gating split (§14.1 rev.8): receipt, listing toggle, and repositions are STATE-DRIVEN and never flag-gated (a reposition is always homeward — decision 18); promo mutations and the renter dropoff read are 404-gated while dark (mirror `routes/operator-terms.ts:67`).**
  - `POST /vehicles/:id/custody/receipt` — multipart: text fields per `receiveVehicleSchema` + repeated `file` photo parts (reuse the photo-size budget consts); 201 with the receipt + updated vehicle custody. NOT flag-gated.
  - `POST /vehicles/:id/custody/reposition` — JSON `startRepositionSchema`. NOT flag-gated anywhere (decision 18: every reposition is homeward recovery; there is no outbound case).
  - `PATCH /vehicles/:id/custody/listing` — JSON `custodyListingSchema`. NOT flag-gated.
  - `PUT /vehicles/:id/custody/promo-home` — JSON `promoHomeSchema`, flag-gated 404; `DELETE` clears (NOT gated — reduces exposure).
  - `GET /manage/custody/receipt-checklist` / `PUT /manage/custody/receipt-checklist` — JSON `receiptChecklistSchema`, operator-scoped (fleet-write for the PUT). NOT flag-gated (config, not movement).
  - `GET /vehicles/:id/custody/receipts` — operator evidence list (management read; NOT public).
  - `GET /custody/receipts/:id/photos/:index` — streams via `ReceiptStorage.getFile` (mirror the renter-documents streaming route: correct `Content-Type`, `Cache-Control: private, no-store`).
  - `GET /vehicles/:id/homeward-dropoffs` — `requireAuth` only (renters call it from the wizard): returns `{ locations: [{ id, name }], homeBaseLocationId, promo: { percent, cutoffAt } | null }` — the service computes the list with `allowedDropoffIds` (pickup = the car's `physicalLocationId`, receiving = ownerActive in Slice 1) and returns the promo pair only when set AND the vehicle is displaced. **404 when the flag is off.**
  Route tests: happy paths + 401/403 + the gating split (receipt/listing/reposition work while dark; promo PUT + homeward-dropoffs 404 while dark) + a receipt-photo cross-tenant 404 (IDOR pin) + **checklist PUT with `PHOTOS` against a `DisabledReceiptStorage` app → 400 (decision 20)**, using `testAuthMiddleware`/`authHeaders` idioms.

- [ ] **Step 3: Builder + mounts.** `composition/custody-service.ts` exports `buildCustodyService(deps: CustodyServiceDeps): CustodyService` (mirror `composition/operator-application-service.ts`'s shape and doc-comment). In `index.ts`: import route factory + builder (2 lines), destructure the new repos, `const custodyService = buildCustodyService({ ... })` (one call), mount `.route('/', createCustodyRoutes(custodyService, photoUploadLimiter, photoUploadUserLimiter))` next to the vehicle-photos mount. Run `bun run lint:size` — if `index.ts` crosses 800, move the nearest low-risk resolver block into `composition/` (precedent: `4c1a1183`).

- [ ] **Step 4: Vehicle DTO.** The operator fleet UI needs the custody fields: extend the vehicle row DTO the fleet routes return (find the schema the web's `vehicleRowSchema` mirrors — `grep -rn "vehicleRowSchema" packages/web/src/vite/operator-fleet/api.ts` and the API-side serializer it parses) with `custodyState`, `physicalLocationId`, `heldOffline`, `autoRelistOnReceipt`, `homewardPromoPercent`, `homewardPromoCutoffAt`. Renter-facing DTOs are untouched.

- [ ] **Step 5: Verify + commit**

```bash
bun run --filter @kuruma/api test && bunx tsc -p packages/api --noEmit && bun run --filter @kuruma/api lint:boundaries && bun run lint:size && bun run lint
git add packages/api packages/shared
git commit -m "feat(custody): custody routes (state-driven vs flag-gated split) + composition wiring"
```

---

## Phase 6 — Web

### Task 19: Operator fleet custody UI

**Files:**
- Create: `packages/web/src/vite/operator-fleet/CustodyBadge.tsx`, `ReceiveVehicleDialog.tsx`, `RepositionDialog.tsx`, `ListingDialog.tsx`, `PromoHomeDialog.tsx`, `ChecklistSettingsDialog.tsx`
- Modify: `packages/web/src/vite/operator-fleet/api.ts` (schema fields + mutations), `FleetRowActions.tsx`, `FleetTable.tsx`, `FleetVehicleCard.tsx`
- Modify: `packages/web/messages/{en,ja,zh}.json` (`business.vehicles.custody.*` namespace)
- Test: `packages/web/src/vite/operator-fleet/ReceiveVehicleDialog.test.tsx` + extend the FleetRowActions suite

Outbound custody UI (reposition-away, promo) is gated on `useFeatureFlag('ONE_WAY_CUSTODY')`; **"Receive vehicle" and "Listing & holds" are state-driven and render whenever the vehicle's custody state calls for them, flag or no flag** (§14.1 — staff must be able to recover a car after a kill). Flag off + fully-at-home fleet renders exactly today's menu (pin that with a test).

- [ ] **Step 1: Failing tests.** `ReceiveVehicleDialog.test.tsx`: renders location select from provided owner locations; renders the checklist hint from the fetched operator checklist (photo/fuel/odometer/notes fields marked required only when listed); submit posts multipart with `locationId` + provided condition fields + `idempotencyKey`; server 400 `RECEIPT_CHECKLIST_INCOMPLETE` and 409 surface an inline `role="alert"` banner (combo-deals precedent); success invalidates `FLEET_QUERY_KEY` and closes. FleetRowActions (decision 18 matrix): `custodyState 'IN_TRANSIT'` shows "Receive vehicle" (flag OFF too — kill-safety pin); **"Send home" renders only for a DISPLACED `AT_STATION` car, flag-independent** (repositions are homeward recovery — an at-home car has nowhere to send, and the server 409s it); `AT_STATION` + flag ON adds "Listing & holds" / "Promo home"; flag OFF + at-home shows none of the custody items.

- [ ] **Step 2: API client** (`operator-fleet/api.ts`): extend `vehicleRowSchema` with the six custody fields (zod, nullable as in the DTO); add `receiveVehicle(vehicleId, form: FormData, csrfToken, pickedOperatorId)` (FormData POST mirroring the photo-upload client `:200-217`), `startReposition`, `updateCustodyListing`, `setPromoHome`, `clearPromoHome`, `fetchReceiptChecklist`, `updateReceiptChecklist` (all `writeJson` PATCH/POST/PUT/DELETE with `X-CSRF-Token`, mirroring `updateVehicleStatus` :152-167).

- [ ] **Step 3: Components.**
  - `CustodyBadge` — small presentational: `IN_TRANSIT` → amber "In transit"; `AT_STATION` + `heldOffline` → gray "Held offline"; displaced (`physicalLocationId !== pickupLocationId`, both non-null) → blue "Away from home"; else nothing. Used in `FleetTable` row + `FleetVehicleCard`.
  - `ReceiveVehicleDialog` — form: location `<select>` (owner active locations — reuse the locations query the fleet module already has; check `operator-locations` module's barrel for `operatorLocationsQueryOptions` and import via `@/vite/operator-locations` barrel only, bumping `VITE_CROSS_FEATURE_REACH_IN_BASELINE` in `scripts/lint-module-boundaries.ts:122` if the deep-import rule fires); condition fields (fuel %, odometer, damage checkbox, notes) + `<input type="file" multiple accept="image/*">` — required-marks driven by `fetchReceiptChecklist` (display hint only; the server's snapshot is authoritative and its 400 names any missing items); one `useState(() => crypto.randomUUID())` idempotency key per mount (wizard precedent); labeled inputs (`<label htmlFor>`), error banner `role="alert"`, submit disabled while pending.
  - `RepositionDialog` — "Send home": **confirm-only (decision 18 — no destination control)**; names the home base it will drive to ("Staff will drive this car back to {homeBaseName}"; internal tool wording — never "ferry"); the POST body is just the idempotency key. `ListingDialog` — two switches (`heldOffline`, `autoRelistOnReceipt`); `PromoHomeDialog` — percent + cutoff datetime + clear button; `ChecklistSettingsDialog` — four checkboxes over `RECEIPT_CHECKLIST_ITEMS`, opened from a header button on the fleet page (flag-independent — config, not movement); **the `PHOTOS` checkbox is disabled with a hint when the server rejects it (400 — no receipt storage configured, decision 20)**.
  - `FleetRowActions.tsx` — extend the `OpenDialog` union (`'receive' | 'reposition' | 'listing' | 'promo'`) and add `DropdownMenuItem`s in the existing pattern (:106-115) per the Step-1 visibility matrix; all only when `canWrite`.

- [ ] **Step 4: i18n** — add `business.vehicles.custody.*` keys (badge labels, menu items, dialog titles/fields/errors, checklist item labels — ~35 keys) to ALL THREE locale files; run `bun run lint:i18n-parity`.

- [ ] **Step 5: Verify + commit**

```bash
bun run --filter @kuruma/web test -- operator-fleet && bunx tsc -p packages/web --noEmit && bun run lint:modules && bun run lint:i18n-parity
git add packages/web scripts/lint-module-boundaries.ts
git commit -m "feat(custody): operator fleet custody UI (receive+checklist, reposition, listing, promo)"
```

### Task 20: Renter dropoff picker + promo in the wizard

**Files:**
- Create: `packages/web/src/vite/reservation/homewardApi.ts`, `DropoffSelect.tsx`
- Modify: `packages/web/src/vite/reservation/ReservationWizard.tsx` (:107-115), `pricing.ts` (`estimateReservation` gains optional promo), `ConfirmStep`/summary display
- Modify: `packages/web/messages/{en,ja,zh}.json` (`reservation.dropoff.*`)
- Test: `packages/web/src/vite/reservation/DropoffSelect.test.tsx` + extend the wizard suite

- [ ] **Step 1: Failing tests:** flag OFF → no dropoff control, `bookingCommon.dropoffLocationId === locationId` (pin today's behavior); flag ON + SPECIFIC subject → select rendered from the homeward-dropoffs query, defaulting to the pickup location; choosing another location flows into the POST body; promo active + dropoff == home → estimate shows the discounted rental line + a promo badge **only when the trip's end date is on/before the cutoff** (arrival compare — mirror the server); CLASS_COMBO subject → no control ever (validator forces round-trip).

- [ ] **Step 2: `homewardApi.ts`** — `fetchHomewardDropoffs(vehicleId)` GET `/vehicles/:id/homeward-dropoffs`, zod-parse `{ locations: [{ id, name }], homeBaseLocationId, promo: { percent, cutoffAt } | null }`, 404 → null (flag off); `homewardDropoffsQueryOptions(vehicleId)` with `enabled` left to the caller.

- [ ] **Step 3: Wizard.** In `ReservationWizard`:

```ts
  const oneWayEnabled = useFeatureFlag('ONE_WAY_CUSTODY')
  const [dropoffLocationId, setDropoffLocationId] = useState(locationId)
  const vehicleIdForDropoff = subject.kind === 'SPECIFIC' ? subject.vehicle.id : null
  const { data: homeward } = useQuery({
    ...homewardDropoffsQueryOptions(vehicleIdForDropoff ?? ''),
    enabled: oneWayEnabled && vehicleIdForDropoff !== null,
  })
  // Dark-mode guard (the #877 cached-data lesson): only a flag-ON render may pin
  // a non-default dropoff.
  const effectiveDropoff = oneWayEnabled && homeward ? dropoffLocationId : locationId
```

`bookingCommon.dropoffLocationId: effectiveDropoff` (:109). Render `<DropoffSelect>` (a labeled `<select>` + promo hint line when `homeward.promo` and the option is `homeward.homeBaseLocationId` and the selected end date is on/before `promo.cutoffAt`) above the summary on the dates step. Promo estimate: pass `promoPercent` into `estimateReservation` only under those same conditions; apply it to the rental portion with the same `floor(base * (100-p)/100)` formula (mirror the server exactly — a mismatched estimate is a support ticket).

- [ ] **Step 4: i18n ×3 + parity; run suites; commit**

```bash
bun run --filter @kuruma/web test -- reservation && bunx tsc -p packages/web --noEmit && bun run lint:i18n-parity && bun run lint:modules
git add packages/web
git commit -m "feat(custody): renter dropoff picker + promo-home pricing in the wizard"
```

### Task 21: E2E — the one-way homeward journey

**Files:**
- Create: `e2e/real-db/one-way-custody.auth.spec.ts`
- Modify: `playwright.real-db.config.ts` (`VITE_FEATURE_ENV` gains `VITE_FEATURE_ONE_WAY_CUSTODY: 'true'`)

- [ ] **Step 1: Flag plumbing.** Add the env var to the real-db config's `VITE_FEATURE_ENV` (both web servers); the spec flips the SERVER flag by inserting the `feature_flags` override row via `testSql` in `beforeAll` (and deletes it in `afterAll`) — the server read is runtime, no restart needed.

- [ ] **Step 2: The spec** (template `locations.auth.spec.ts` / `operator-onboarding.auth.spec.ts`, `test.setTimeout(120_000)`, serial `test.step`s, DB asserts via `testSql`):
  1. Seed via SQL: second active location B for the seeded operator; note the seeded car's home A; operator checklist stays `[]` (minimal — the Q5 default). **Pre-assert the P0-B seed fix via `testSql`: the seeded car is `AT_STATION` at A with a non-null `openCustodyPeriodId`** (an untracked seeded car would be listed by search and rejected by checkout — this pin fails loudly instead). Renter books the car one-way A→B (wizard: pick dropoff B) — assert booking created with `dropoffLocationId` B and one `movement_legs` row (kind RENTAL, planned).
  2. Operator marks the booking ACTIVE (existing booking actions UI) — DB assert: leg `departedAt` set, vehicle `custodyState 'IN_TRANSIT'`, `inFlightLegId` = leg id, custody period CLOSED.
  3. **Operator marks the booking COMPLETED** (the §5 ordering gate: return → complete → receive), then opens the fleet row → "Receive vehicle" at B with a condition note and NO photo (minimal checklist) — DB assert: `handoff_receipts` ARRIVAL row with empty photo keys, vehicle `AT_STATION` at B, `openCustodyPeriodId` set, ONE open `custody_periods` row with rate snapshots 0, `heldOffline: true`.
  4. Operator flips the listing hold off, sets promo-home 20% — car appears in a renter search at B (not at A — the anchor), with promo visible in the wizard for dropoff A (trip ends before the cutoff).
  5. Renter books B→A homeward at the discounted price — DB assert: second leg, `totalPrice` discounted.
  6. Restore: cleanup rows in `afterAll` (delete legs/periods/receipts/bookings created here; reset vehicle custody to home incl. a fresh baseline period + `openCustodyPeriodId`; drop location B) so the shared seed stays pristine for other specs.

- [ ] **Step 3: Run BOTH lanes** (distinct CI gates — the standing lesson):

```bash
bun run test:e2e            # mock lane must stay green (no custody UI without the flag)
bun run test:e2e:real-db:local
```

- [ ] **Step 4: Commit**

```bash
git add e2e playwright.real-db.config.ts
git commit -m "test(custody): one-way homeward journey e2e (real-db lane)"
```

---

## Phase 7 — Flip runbook + final verification

### Task 22: Flag-flip backfill script (run before AND after each flip)

**Files:**
- Create: `scripts/backfill-movement-legs.ts`

Bookings created while the flag was OFF have no legs; dark-era COMPLETED one-ways left cars physically away from their materialized location. The §14.1 cutover fence: run this script **immediately before AND immediately after** every flip (either direction) — the second run closes the race window; between runs the never-gated state-driven endpoints own every in-flight movement.

**rev.4 (P0-A): the script validates before it writes, and writes under the same locks as the live system.** A migration must never materialize a schedule the model calls impossible — an existing A→B commitment followed by a later A pickup is exactly the stranded state §8 rules 3/6 exist to prevent.

- [ ] **Step 1: Script** (print-only by default; `--apply` to execute — the safe-path lesson from the beta seed drift):

```ts
// scripts/backfill-movement-legs.ts
// One-way custody flip runbook (§14.1 rev.8). VALIDATE → then three synthesis
// passes, all idempotent, each vehicle in its own tx under the §4 lock:
//  0. VALIDATION (always, even print-only): per affected vehicle, fold the
//     complete would-be schedule — existing live legs + every leg passes 1-3
//     would synthesize, ordered by window — through §8 rules 3-4 + 6
//     (projectedLocationAt / pendingLegOverlaps / tail). ANY violation ⇒
//     print a per-vehicle conflict report (vehicle, offending bookings,
//     which rule) and EXIT NON-ZERO without applying anything. Staff
//     substitute/cancel the offenders, then re-run.
//  1. CONFIRMED bookings with no leg          → planned RENTAL leg.
//  2. ACTIVE bookings with no leg             → departed RENTAL leg + vehicle
//     IN_TRANSIT (inFlightLegId set, physical pair nulled, open period closed).
//  3. Dark-era displacement recovery: vehicles whose LATEST COMPLETED booking
//     has dropoffLocationId != the vehicle's physicalLocationId and no leg →
//     departed TRANSFER recovery leg + vehicle IN_TRANSIT. Staff then receive
//     the car through the normal §6 receipt flow — evidence intact, no silent
//     teleport. Synthesized legs carry checklistSnapshot NULL (minimal core)
//     and no departure receipt (no witnessed departure existed — §14.1).
// Usage: DATABASE_URL=... bun run scripts/backfill-movement-legs.ts [--apply]
```

Logic (drizzle over a `postgres()` client): **pass 0** — collect every affected vehicle (passes 1-3 selectors below), and per vehicle run the pure fold (`projectedLocationAt`/`pendingLegOverlaps` + the tail rule from `@kuruma/shared/lib`) over existing live legs ∪ would-be legs; violations accumulate into the conflict report (never partially apply). **Passes 1-2** — select CONFIRMED/ACTIVE bookings with `assignedVehicleId IS NOT NULL` and no live `movement_legs` row for (booking, vehicle) (`LEFT JOIN ... IS NULL`); build the leg (`kind 'RENTAL'`, from/to = booking pickup/dropoff with the booking's `operatorId`, planned window `[startAt, effectiveEndAt]`, `idempotencyKey: 'backfill:' + bookingId`, `requestFingerprint: 'backfill:' + bookingId`, `departedAt: startAt` for ACTIVE); for ACTIVE: close the vehicle's open custody period (`departedAt = startAt, closedByLegId = leg id`), then `UPDATE vehicles SET "custodyState"='IN_TRANSIT', "physicalHostOperatorId"=NULL, "physicalLocationId"=NULL, "inFlightLegId"=<leg id>, "openCustodyPeriodId"=NULL` (order matters — the three-way CHECK is per-statement). **Pass 3** — for each AT_STATION vehicle whose latest COMPLETED booking's `dropoffLocationId` differs from `physicalLocationId` and has no leg: synthesize a departed `TRANSFER` leg (from = materialized pair, to = the booking's dropoff pair, window = booking end → +24h, `idempotencyKey: 'recovery:' + bookingId`), close the open period, flip the vehicle IN_TRANSIT as above. **Under `--apply`, each vehicle's statements run in ONE transaction opened with `SELECT pg_advisory_xact_lock(hashtextextended('vehicle-timeline:' || vehicleId, 0))`** (the same key the API takes — a concurrent depart/receive cannot interleave with the synthesis; per-vehicle granularity keeps lock hold times short and the run resumable). Re-check the pass-guards (`custodyState`, no-live-leg) inside the locked tx — the validation snapshot may be stale by the time the lock is held. Print the full statement set; execute only under `--apply`. Idempotent via the idempotency keys + in-tx guards.

- [ ] **Step 2: Dry-run against the local DB** (`DATABASE_URL=... bun run scripts/backfill-movement-legs.ts` → prints, exits 0), then `--apply` on the local DB with a seeded ACTIVE booking and a synthetic dark-era displaced COMPLETED booking; assert legs + IN_TRANSIT flips + closed periods via psql; run `--apply` a SECOND time → zero new statements (idempotency pin). **Conflict pin (P0-A): add a synthetic stranded fixture — a CONFIRMED one-way A→B followed by a later CONFIRMED A→A booking on the same car — and assert the script exits non-zero with both bookings named in the report and writes NOTHING (leg count unchanged), even under `--apply`.**

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-movement-legs.ts
git commit -m "chore(custody): flip runbook script — leg synthesis + dark-era recovery (print-only default)"
```

### Task 23: Full verification + branch finish

- [ ] **Step 1: The whole gate, in order**

```bash
bun run --filter @kuruma/shared test
bun run --filter @kuruma/api test                    # NO DATABASE_URL
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bunx vitest run tests/integration --root packages/api
bun run --filter @kuruma/web test
bunx tsc -p packages/shared --noEmit && bunx tsc -p packages/api --noEmit && bunx tsc -p packages/web --noEmit
bun run lint && bun run lint:size && bun run lint:modules && bun run lint:i18n-parity
bun run --filter @kuruma/api lint:boundaries
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:verify
bun run test:e2e
bun run test:e2e:real-db:local
```

Every line green. Any red = fix before proceeding (flaky = defect).

- [ ] **Step 2: Sabotage checks (two, load-bearing):** (a) temporarily invert the leash in `allowedDropoffIds` (`has` → `!has`) → the Task 15 dropoff tests and the e2e must fail; revert. (b) temporarily anchor rule 2 on `pickupLocationId === vehicle.pickupLocationId` (home instead of physical) → the displaced-homeward tests must fail; revert. Proves the predicate is wired into checkout, not just unit-tested.

- [ ] **Step 3: Docs + teardown.** Add a CLAUDE.md gotcha entry only if something surprising was hit (per the standing rule). `docker rm -f kuruma-custody-pg`. Then use **superpowers:finishing-a-development-branch**: rebase onto `origin/develop` (regenerate the migrations if numbers collided — drop + `db:generate`, never hand-rename), PR base `develop`, plain-English title "One-way rentals: cars can be dropped at another branch and rented home", body `Refs #882` + link to the spec, squash-merge, NO force-push (`gh pr update-branch` if behind).

---

## Self-review notes (spec rev.8 coverage check, done at plan time)

| Spec section | Task(s) |
|---|---|
| §2 owner/host split | 5 (schema), 13 (fee-0 periods) |
| §3 explicit state + three-way CHECK + state⇔reference FKs + lifecycle triggers | 2, 5 (Step 5c incl. lifecycle triggers), 6, 9 (cases 13-14, 17-18) |
| §4 one stream, traversal-identity unique, generation keys, one lock, widened FOR SHARE | 3, 5, 7 (`countByBookingAndVehicle`), 8, 9, 12, 13, 14, 15 |
| §5 transitions (depart all-or-nothing/receive/void/recovery/assignment/substitution) | 2, 13 (validate-first `departVehicleInTx`), 14 |
| §5.1 receive authorization | 13 + decision 12 (Slice 1: owner staff; leg-derived capability = Slice 2) |
| §6 receipt gate: minimal core, checklist snapshot, photo-hash fingerprints, bidirectional endpoint guard, preflight-before-upload, append-only, private storage | 2, 5 (Steps 5c/5d), 7, 9 (cases 15-16, 19), 11 (`isConfigured`), 13, 18 |
| §7 receiving/owner sets + leash + atomic archival guard | 3, 4, 15, 17, 18 |
| §8 feasibility algorithm + rule 6 tail + consequences (anchor, exclude, capacity-gate skip, display, combo deferral) | 4, 15, 16, 22 (validation fold) |
| §9 staff reposition (home-only, never gated) / promo-home (arrival compare) / re-label | 12, 13, 15, 18, 19, 20 — decision 18 |
| §10/§11 custody periods at rate 0, close-on-departure, one-open seal, baseline rows | 5, 6, 9, 12, 13, 14 |
| §12 schema & surface summary | 5, 16, 18 |
| §13 bootstrap: untracked NULL, baseline periods, on-ramp, home-base⇒tracked, self-placing seeds | 5 (columns), 6 (backfill + trigger + seed), 9 (case 20), 12 (same-tx on-ramp), 21 (pre-assert) |
| §14 slice boundaries (no cost fold, no cross-op money) | honored — no accrual math, no settlement table, snapshots 0, receiving == ownerActive |
| §14.1 flag: outbound-gated, recovery never gated, OFF path folds legs, validated cutover fence | 10, 13, 15 (OFF fold), 18, 19, 22 (pass 0 + per-vehicle locked tx) |
| §15 Q1 P→P / Q2 pricing / Q3 strict + receipt / Q4 fees / Q5 checklist / Q6 combo deferral | Q1: 3/4/15 · Q2: untouched · Q3: 4/13/16 · Q4: n/a until Slice 2 · Q5: 5/13/18/19 · Q6: 16 |
| §16 open questions | untouched (Slice 2): settlement cadence/rounding, host fee, liability, default checklist contents |
| §17 out of scope | no free-roam, no displaced combo, no future repositions, no advance booking at unreceived stations |

Known deliberate gaps (Slice 2+, per spec §14): cross-operator hosting/opt-in (receiving set widening), non-zero fees, settlement records, RENTAL departure-receipt UI, `CLASS_COMBO` for displaced cars, free-roam. Deviations from the spec letter are the 17 plan-level decisions up top (decision 15 — the tail rule — is the one genuinely NEW rule to confirm at review).
