# One-Way Custody Network — Slice 0 + Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Slice 0 (pure custody state machine + timeline-feasibility predicate) and Slice 1 (same-operator homeward one-way rentals: movement legs, receipt gate, custody periods at rate 0, cancellation recovery, archival guard, ferry, promo-home, shared predicate on search + checkout) of the one-way custody network design.

**Spec (source of truth):** `docs/superpowers/specs/2026-07-26-one-way-custody-network-design.md` (rev.4).
Retained predecessor: `docs/plans/2026-06-21-one-way-rentals-design.md` §3–3.1 (do not delete those sections).

**Architecture:** Pure Functional Core in `packages/shared/src/lib/` (fold + feasibility + custody transitions), imperative shell in `packages/api` (drizzle tables with full DB seals, repos behind ports, services orchestrating under a per-vehicle advisory lock inside `runInTransaction`), web surfaces in `packages/web` (operator custody actions, renter dropoff picker). Everything behavior-changing is dark behind one runtime flag `ONE_WAY_CUSTODY`.

**Tech stack:** Bun workspaces, Drizzle + Neon Postgres, Hono on CF Workers, TanStack Router + React + TanStack Query, vitest, Playwright.

---

## Plan-level decisions (concretizations of the spec — surface at review if any looks wrong)

These are decisions the spec left to implementation. Each stays inside the spec's constraints:

1. **One flag, everything dark.** A single registry flag `ONE_WAY_CUSTODY` (web flag with `env: 'VITE_FEATURE_ONE_WAY_CUSTODY'`, `runtimeControlled: true`, read server-side exactly like `OPERATOR_TERMS` — the documented deviation at `packages/api/src/index.ts:433-438`). While OFF: no movement legs are created, booking-create keeps today's exact checks, the wizard shows no dropoff picker. Spec §12 only mandates a flag for Slice 2, but Slice 1 rewires live search/checkout — repo convention (OPERATOR_TERMS, MESSAGING) is dark-ship.
2. **Flag-off equivalence instead of flag-conditional search SQL.** The availability repo *always* uses the new custody columns; a backfill migration plus a write-path sync rule (Task 12) makes them degenerate to today's behavior while the flag is OFF (physicalLocationId ≡ pickupLocationId, no legs exist, heldOffline=false). This keeps the flag out of the repository layer.
3. **`custodyState` is NULLABLE** (= "custody-untracked"). Spec §4 implies NOT NULL, but `vehicles.pickupLocationId` is nullable today (`fleet.ts:105`, unassigned is legal) and the CHECK ties AT_STATION to a non-null location. NULL custodyState = never placed (unassigned vehicle); first placement happens when a home base is assigned. The CHECK still forbids drift for both non-null states.
4. **`voidedAt` column on `movement_legs`.** Spec §5 says a pre-start cancel "voids the planned leg"; the §6.1 schema block has no representation for that. A nullable `voidedAt` timestamp (only while un-departed, CHECK-sealed) keeps the table append-only-ish (no deletes) and drops the leg from every fold.
5. **The fold is seeded by the materialized present.** Spec §2 says the scalar "is the fold evaluated at now", so the pure predicate takes `(physicalLocationId, pending legs)` rather than replaying full history — `projectedLocationAt(current, pendingLegs, t)`. Arrived legs stay in the table as the auditable actual baseline; they just aren't re-folded on every search.
6. **`packages/shared/src/lib/one-way.ts` is superseded and deleted** (with its test). It is dead code (zero production importers — verified 2026-07-26) implementing the booking-only fold; the new `custody-*` modules carry the same R1/R2/R3 + TAIL_ONLY semantics over the heterogeneous stream. The #882 *doc* sections stay.
7. **Promo-home = two nullable vehicle columns** (`homewardPromoPercent`, `homewardPromoCutoffAt`), not a table. The discount applies only when the booking lands the car at its home base (`dropoffLocationId == vehicles.pickupLocationId`) before the cutoff; cleared automatically on a receipt at home.
8. **Receipt photos go through a new private `ReceiptStorage` port** mirroring `DocumentStorage` (streamed through the Worker, never a public URL), R2 binding `HANDOFF_RECEIPTS`. Disabled fallback when unbound; photos optional server-side so local/dev works without R2.
9. **The per-vehicle advisory lock does not exist yet** — `drizzle/0082` *claims* it does but only the per-(operator,class,location) `lockComboCapacity` exists (`drizzle/availability.ts:191-203`). Task 11 adds `lockVehicleTimeline(vehicleId)` and every timeline mutation takes it.
10. **Every booking gets a movement leg while the flag is ON** — round trips included (a round trip departs and returns; custody must close/reopen or the host would accrue while the renter holds the car, spec §10). Consequence while ON: a car is `IN_TRANSIT` (unlistable, spec §14 Q3) during any active rental, and every return needs a receipt to relist. That is the owner-locked model; the flag keeps it dark until the owner flips it.
11. **DEPARTURE receipts**: schema, repo, and service accept both phases (§6.2); Slice 1 UI ships only the ARRIVAL flow. Departure-capture UI is a Slice 2 concern (damage attribution matters cross-operator).
12. **Custody scoping is service-level** (like `ConsentRepository`): the custody ports take explicit ids, not `CallerContext`; routes/services enforce fleet-write + tenant binding before calling them.

## Execution context (read once, applies to every task)

- **Worktree:** `git worktree add ../kuruma-custody -b feat/one-way-custody-slice-0-1 origin/develop && cd ../kuruma-custody && bun install`. All paths below are relative to the worktree root.
- **Local DB for migration/integration tasks:** disposable docker Postgres, NOT the shared dev DB:
  `docker run -d --name kuruma-custody-pg -p 5499:5432 -e POSTGRES_USER=kuruma -e POSTGRES_PASSWORD=kuruma -e POSTGRES_DB=kuruma_custody postgres:16`
  then for every db/integration command: `DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody"`. Apply all existing migrations first (`bun run db:migrate`). Tear down at the end: `docker rm -f kuruma-custody-pg`.
- **api unit tests must run WITHOUT `DATABASE_URL`** (setting it flips composition to real-DB mode and fails ~9 in-memory route tests). Integration tests (`packages/api/tests/integration`) REQUIRE it.
- **Migration workflow** (CLAUDE.md, mandatory): `bun run db:generate --name <name>` → `bun run db:migrate` → `bun run db:verify` (3 green checks). Hand-written SQL only via `bun run db:generate --custom --name <name>`. Never edit merged migrations; never hand-rename one. Migration numbers below say `01NN` — use whatever `db:generate` assigns (develop may have advanced past 0111).
- **Commit style:** conventional commits, no co-author, one commit per task step-group as written.
- **Lints that will bite:** `bun run --filter @kuruma/api lint:boundaries` (routes→services→repositories), `bun run lint:size` (800 hard cap — `repositories/types.ts` is AT 800, `index.ts` at 762: new ports go in `types-custody.ts`, new wiring goes through a `composition/` builder), `lint:fk-indexes` (every FK's leading column needs an index), `lint:tenant-anchor-immutability`, `lint:i18n-parity` (3 locales), `lint:modules` (web barrels), biome (run `bun run lint` before every push, not just husky's staged check).
- **Key file anchors** (verified 2026-07-26): vehicles table `packages/shared/src/db/fleet.ts:87-192`; locations `db/location.ts:37-98` (`locations_operatorId_id_unique` :91); bookings `db/booking.ts:51-213`; enums `packages/shared/src/enums.ts`; availability predicate `packages/api/src/repositories/drizzle/availability.ts:49-88` (static location filter :78) with in-memory mirror `in-memory/availability.ts`; booking create `packages/api/src/services/booking-creation.ts` (`submitInTx` :253, pickup equality :331, `resolveDropoffEffectiveEnd` :226-246, combo lock :354-375, `submitSpecificInTxLocked` :378); lifecycle `packages/api/src/services/booking-lifecycle.ts` (`updateStatus` :408, renter `cancel` :495); location archive `packages/api/src/services/location.ts:209-240`; tx bundle `packages/api/src/repositories/types-transactions.ts` + `repositories/drizzle/transaction.ts`; composition `packages/api/src/composition/repositories.ts`; flag registry `packages/shared/src/feature-flags/registry.ts`; error codes `packages/shared/src/lib/error-codes.ts` (+ membership test); wizard `packages/web/src/vite/reservation/ReservationWizard.tsx:107-115`; fleet actions `packages/web/src/vite/operator-fleet/FleetRowActions.tsx:106-115`.

## File structure (what gets created/modified where)

```
packages/shared/src/enums.ts                          MODIFY  custody enums
packages/shared/src/lib/custody-state.ts              CREATE  pure transitions + listability      (+ .test.ts)
packages/shared/src/lib/custody-timeline.ts           CREATE  PendingLeg, fold, overlap, homeward (+ .test.ts)
packages/shared/src/lib/custody-feasibility.ts        CREATE  assessOneWayFeasibility             (+ .test.ts)
packages/shared/src/lib/one-way.ts                    DELETE  superseded (+ tests/lib/one-way.test.ts)
packages/shared/src/db/fleet.ts                       MODIFY  vehicles custody columns + seals
packages/shared/src/db/custody.ts                     CREATE  movement_legs, custody_periods, handoff_receipts
packages/shared/src/db/schema.ts                      MODIFY  export * barrel line
packages/shared/src/validators/custody.ts             CREATE  zod for custody routes
packages/shared/src/feature-flags/registry.ts         MODIFY  ONE_WAY_CUSTODY entry
packages/shared/src/lib/error-codes.ts                MODIFY  5 new codes (+ membership test)
drizzle/01NN_one_way_custody_schema.sql               GENERATE
drizzle/01NN_backfill_vehicle_custody.sql             CUSTOM  backfill
packages/api/src/repositories/types-custody.ts        CREATE  3 ports
packages/api/src/repositories/in-memory/{movement-leg,custody-period,handoff-receipt}.ts  CREATE
packages/api/src/repositories/drizzle/{movement-leg,custody-period,handoff-receipt}.ts    CREATE
packages/api/src/repositories/types-storage.ts        MODIFY  ReceiptStorage port
packages/api/src/repositories/r2-receipt-storage.ts   CREATE  (+ in-memory/receipt-storage.ts, disabled-receipt-storage.ts)
packages/api/src/repositories/types-transactions.ts   MODIFY  bundle gains custody repos
packages/api/src/repositories/drizzle/transaction.ts  MODIFY  rebind custody repos per-tx
packages/api/src/repositories/types.ts                MODIFY  re-export lines only (stay ≤800!)
packages/api/src/pg-errors.ts                         MODIFY  named constraint consts
packages/api/src/services/custody.ts                  CREATE  CustodyService (+ .test.ts)
packages/api/src/services/vehicle.ts                  MODIFY  placement / sync / relabel rule
packages/api/src/services/booking-creation.ts         MODIFY  predicate + leg insert + promo
packages/api/src/services/booking-lifecycle.ts        MODIFY  depart / void / recovery hooks
packages/api/src/services/location.ts                 MODIFY  archival guard
packages/api/src/routes/custody.ts                    CREATE  custody routes (+ tests)
packages/api/src/composition/custody-service.ts       CREATE  builder (index.ts cap protection)
packages/api/src/composition/repositories.ts          MODIFY  wire 3 repos + ReceiptStorage
packages/api/src/app-overrides.ts                     MODIFY  test override slots
packages/api/src/index.ts                             MODIFY  mount routes (lean — builder does the rest)
packages/api/wrangler.toml                            MODIFY  HANDOFF_RECEIPTS binding (commented in prod)
packages/web/src/vite/operator-fleet/{CustodyBadge,ReceiveVehicleDialog,FerryDialog,ListingDialog,PromoHomeDialog}.tsx  CREATE
packages/web/src/vite/operator-fleet/{api.ts,FleetRowActions.tsx,FleetTable.tsx,FleetVehicleCard.tsx}  MODIFY
packages/web/src/vite/reservation/{DropoffSelect.tsx,homewardApi.ts}  CREATE
packages/web/src/vite/reservation/ReservationWizard.tsx  MODIFY  dropoff state + promo estimate
packages/web/messages/{en,ja,zh}.json                 MODIFY  i18n keys
e2e/real-db/one-way-custody.auth.spec.ts              CREATE
playwright.real-db.config.ts                          MODIFY  VITE_FEATURE_ONE_WAY_CUSTODY
scripts/backfill-movement-legs.ts                     CREATE  flag-flip runbook script
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
bun run --filter @kuruma/api typecheck 2>/dev/null || bunx tsc -p packages/api --noEmit
```

Expected: green (no `DATABASE_URL` in env for the unit run). Commit nothing.

---

## Phase 1 — Slice 0: pure core (`packages/shared/src/lib`)

Spec §12 Slice 0: custody state machine (§4/§5) + timeline-feasibility predicate over the §2.1 movement stream + `homewardDropoffSet` (§7). Pure, no I/O, exhaustively unit-tested. **No cost fold** (day-count/rounding open, §13.7 — Slice 2).

### Task 2: Custody enums + pure state machine

**Files:**
- Modify: `packages/shared/src/enums.ts` (append near the other status sets)
- Create: `packages/shared/src/lib/custody-state.ts`
- Test: `packages/shared/src/lib/custody-state.test.ts` (co-located — co-located src tests ARE typechecked)

- [ ] **Step 1: Add the enums** (single source shared by Zod, pgEnum, and the pure core — repo convention):

```ts
// append to packages/shared/src/enums.ts
/** Custody discriminant (one-way custody network §4): possession, not ownership. */
export const CUSTODY_STATES = ['AT_STATION', 'IN_TRANSIT'] as const
export type CustodyState = (typeof CUSTODY_STATES)[number]

/** One physical traversal (§6.1): a rental, an owner-staff ferry, or a cross-operator transfer. */
export const MOVEMENT_LEG_KINDS = ['RENTAL', 'FERRY', 'TRANSFER'] as const
export type MovementLegKind = (typeof MOVEMENT_LEG_KINDS)[number]

/** The two ends of one leg (§6.2): hand-out condition vs location-authoritative arrival. */
export const HANDOFF_PHASES = ['DEPARTURE', 'ARRIVAL'] as const
export type HandoffPhase = (typeof HANDOFF_PHASES)[number]

/** Custody-period settlement lifecycle (§10). Slice 1 uses ACCRUING→CLOSED at rate 0. */
export const CUSTODY_SETTLEMENT_STATES = ['ACCRUING', 'CLOSED', 'SETTLED'] as const
export type CustodySettlementState = (typeof CUSTODY_SETTLEMENT_STATES)[number]
```

- [ ] **Step 2: Write the failing tests**

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

describe('derived facts (§4 — derived, never stored)', () => {
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

describe('isCustodyListable (§5 search-ON custody conditions)', () => {
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
// One-way custody network §4/§5 — the pure custody state machine (FC/IS: the
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

/** A leg (rental or ferry) starts: the car leaves its station (§5 Departure). */
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

/** First placement of a custody-untracked vehicle (home base assigned). */
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
 * The custody half of the §5 search-ON conditions. IN_TRANSIT is always off
 * (Q3); NULL custodyState (untracked legacy/unassigned) stays listable so the
 * dark-flag behavior is byte-identical to today. Window feasibility and booking
 * overlap are separate conditions layered by the caller.
 */
export function isCustodyListable(v: {
  status: string
  custodyState: CustodyState | null
  heldOffline: boolean
}): boolean {
  return v.status === 'AVAILABLE' && v.custodyState !== 'IN_TRANSIT' && !v.heldOffline
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun run --filter @kuruma/shared test -- custody-state`
Expected: PASS (13 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/enums.ts packages/shared/src/lib/custody-state.ts packages/shared/src/lib/custody-state.test.ts
git commit -m "feat(custody): pure custody state machine + enums (slice 0)"
```

### Task 3: Movement-timeline fold (`projectedLocationAt`, overlap, homeward set)

**Files:**
- Create: `packages/shared/src/lib/custody-timeline.ts`
- Test: `packages/shared/src/lib/custody-timeline.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/lib/custody-timeline.test.ts
import { describe, expect, it } from 'vitest'
import {
  type PendingLeg,
  homewardDropoffIds,
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

describe('projectedLocationAt (§2.1 fold, seeded by the materialized present)', () => {
  it('no pending legs → the car stays where it physically is', () => {
    expect(projectedLocationAt('A', [], d('2026-09-01T00:00:00Z'))).toBe('A')
  })
  it('a settled projection relocates the car from its plannedEndAt onward', () => {
    expect(projectedLocationAt('A', [leg({})], d('2026-08-03T10:00:00Z'))).toBe('B')
  })
  it('before the projection settles, the car is still at its current location', () => {
    expect(projectedLocationAt('A', [leg({})], d('2026-08-01T09:00:00Z'))).toBe('A')
  })
  it('the LATEST settled projection wins', () => {
    const first = leg({})
    const second = leg({
      fromLocationId: 'B',
      toLocationId: 'C',
      plannedStartAt: d('2026-08-05T10:00:00Z'),
      plannedEndAt: d('2026-08-06T10:00:00Z'),
    })
    expect(projectedLocationAt('A', [first, second], d('2026-08-07T00:00:00Z'))).toBe('C')
    expect(projectedLocationAt('A', [first, second], d('2026-08-04T00:00:00Z'))).toBe('B')
  })
  it('an IN_TRANSIT car (null current) projects to its in-flight destination after plannedEndAt', () => {
    const inFlight = leg({ departedAt: d('2026-08-01T10:00:00Z') })
    expect(projectedLocationAt(null, [inFlight], d('2026-08-03T10:00:00Z'))).toBe('B')
    expect(projectedLocationAt(null, [inFlight], d('2026-08-02T00:00:00Z'))).toBe(null)
  })
})

describe('pendingLegOverlaps (R1 generalized to non-booking legs)', () => {
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

describe('homewardDropoffIds (§7 — the exact shared predicate)', () => {
  const locations = [
    { id: 'L1', operatorId: 'owner', status: 'ACTIVE' },
    { id: 'L2', operatorId: 'owner', status: 'ARCHIVED' },
    { id: 'L3', operatorId: 'other', status: 'ACTIVE' },
  ]
  it('active owner locations only', () => {
    expect(homewardDropoffIds({ ownerOperatorId: 'owner', ownerDeactivatedAt: null, locations })).toEqual(new Set(['L1']))
  })
  it('a deactivated owner has an empty homeward set', () => {
    expect(
      homewardDropoffIds({ ownerOperatorId: 'owner', ownerDeactivatedAt: d('2026-01-01T00:00:00Z'), locations }),
    ).toEqual(new Set())
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --filter @kuruma/shared test -- custody-timeline`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/lib/custody-timeline.ts
// One-way custody network §2.1 — the movement-stream fold, pure (FC/IS).
// The materialized vehicles.physicalLocationId IS the fold evaluated at `now`
// (spec §2), so future feasibility only needs the PENDING legs (receivedAt and
// voidedAt both NULL) layered on top of that baseline. Arrived legs stay in
// movement_legs as the immutable actual record; they are not re-folded here.
import type { MovementLegKind } from '../enums'

/** A not-yet-arrived, not-voided movement leg (the §2.1 planned projection). */
export interface PendingLeg {
  readonly kind: MovementLegKind
  readonly fromLocationId: string
  readonly toLocationId: string
  readonly plannedStartAt: Date
  readonly plannedEndAt: Date
  readonly departedAt: Date | null
}

/**
 * Where the vehicle will be at instant `t`: the destination of the latest
 * pending leg whose projection has settled (`plannedEndAt <= t`), else where it
 * physically is now (`null` while IN_TRANSIT/untracked). A pure step function —
 * the direct descendant of #882 §3's `locationAt`.
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
 * R1 generalized: does any pending leg's occupancy window intersect
 * `[startAt, effectiveEndAt)`? For RENTAL legs this duplicates the DB exclusion
 * constraint (defense in depth); for FERRY/TRANSFER legs it is the only guard —
 * they are not bookings, so `bookings_no_overlap` never sees them.
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
 * §7 homeward-only leash, formalized against the real columns: an ACTIVE
 * location of the (not-deactivated) owner. Search and checkout must share this
 * one function — never re-derive it per caller.
 */
export function homewardDropoffIds(args: {
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
```

- [ ] **Step 4: Run to verify pass**

Run: `bun run --filter @kuruma/shared test -- custody-timeline`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/lib/custody-timeline.ts packages/shared/src/lib/custody-timeline.test.ts
git commit -m "feat(custody): movement-timeline fold + homeward set (slice 0)"
```

### Task 4: Feasibility predicate + supersede `one-way.ts`

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
const base = {
  currentLocationId: 'A' as string | null,
  pendingLegs: [] as readonly PendingLeg[],
  pickupLocationId: 'A',
  dropoffLocationId: 'A',
  startAt: d('2026-09-01T10:00:00Z'),
  effectiveEndAt: d('2026-09-03T10:00:00Z'),
  homewardDropoffIds: new Set(['A', 'B']),
  policy: 'TAIL_ONLY' as const,
}

describe('assessOneWayFeasibility', () => {
  it('round trip at the current location is feasible', () => {
    expect(assessOneWayFeasibility(base)).toEqual({ ok: true })
  })
  it('one-way to another owner-active location is feasible as the tail', () => {
    expect(assessOneWayFeasibility({ ...base, dropoffLocationId: 'B' })).toEqual({ ok: true })
  })
  it('R1: a window overlapping a pending leg (e.g. a scheduled ferry) is rejected', () => {
    const ferry = leg({ kind: 'FERRY', plannedStartAt: d('2026-09-02T00:00:00Z'), plannedEndAt: d('2026-09-04T00:00:00Z') })
    expect(assessOneWayFeasibility({ ...base, pendingLegs: [ferry] })).toEqual({
      ok: false,
      reason: 'WINDOW_OVERLAPS_MOVEMENT',
    })
  })
  it('homeward leash: a dropoff outside the owner-active set is rejected', () => {
    expect(assessOneWayFeasibility({ ...base, dropoffLocationId: 'X' })).toEqual({
      ok: false,
      reason: 'DROPOFF_NOT_HOMEWARD',
    })
  })
  it('R2: pickup must match the projected location at startAt', () => {
    const relocates = leg({}) // A -> B settles 08-03, before startAt
    expect(assessOneWayFeasibility({ ...base, pendingLegs: [relocates] })).toEqual({
      ok: false,
      reason: 'PICKUP_NOT_AT_LOCATION',
    })
    expect(assessOneWayFeasibility({ ...base, pendingLegs: [relocates], pickupLocationId: 'B', dropoffLocationId: 'B' })).toEqual({ ok: true })
  })
  it('TAIL_ONLY: a one-way inserted before a successor leg is rejected', () => {
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
  it('FULL_CHAIN: R3 — the earliest successor must depart from this dropoff', () => {
    const successorFromB = leg({
      fromLocationId: 'B',
      toLocationId: 'A',
      plannedStartAt: d('2026-09-10T10:00:00Z'),
      plannedEndAt: d('2026-09-12T10:00:00Z'),
    })
    expect(
      assessOneWayFeasibility({ ...base, pendingLegs: [successorFromB], dropoffLocationId: 'B', policy: 'FULL_CHAIN' }),
    ).toEqual({ ok: true })
    expect(
      assessOneWayFeasibility({
        ...base,
        pendingLegs: [{ ...successorFromB, fromLocationId: 'A' }],
        dropoffLocationId: 'B',
        policy: 'FULL_CHAIN',
      }),
    ).toEqual({ ok: false, reason: 'DROPOFF_DISCONTINUITY' })
  })
  it('an IN_TRANSIT car (null current) is never at any pickup (Q3)', () => {
    expect(assessOneWayFeasibility({ ...base, currentLocationId: null })).toEqual({
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
// One-way custody network §2/§7/§11 — THE one feasibility predicate, shared
// verbatim by search and checkout (read/write parity: search must never
// advertise a car checkout would reject). Descends from #882 §3.1 (R1/R2/R3 +
// the TAIL_ONLY dial), generalized over the heterogeneous movement stream and
// extended with the §7 homeward-only leash.
import {
  type PendingLeg,
  pendingLegOverlaps,
  projectedLocationAt,
} from './custody-timeline'

export type OneWayPolicy = 'TAIL_ONLY' | 'FULL_CHAIN'

/** The ONE resolved policy value — flip here to widen the leash (later phase). */
export const DEFAULT_ONE_WAY_POLICY: OneWayPolicy = 'TAIL_ONLY'

export const ONE_WAY_CUSTODY_REASONS = [
  'WINDOW_OVERLAPS_MOVEMENT',
  'PICKUP_NOT_AT_LOCATION',
  'ONEWAY_NOT_TAIL',
  'DROPOFF_DISCONTINUITY',
  'DROPOFF_NOT_HOMEWARD',
] as const
export type OneWayCustodyReason = (typeof ONE_WAY_CUSTODY_REASONS)[number]

export type CustodyFeasibility = { ok: true } | { ok: false; reason: OneWayCustodyReason }

export function assessOneWayFeasibility(args: {
  currentLocationId: string | null
  pendingLegs: readonly PendingLeg[]
  pickupLocationId: string
  dropoffLocationId: string
  startAt: Date
  effectiveEndAt: Date
  homewardDropoffIds: ReadonlySet<string>
  policy: OneWayPolicy
}): CustodyFeasibility {
  // R1 — no leg (booking, ferry, transfer) may occupy any part of the window.
  if (pendingLegOverlaps(args.pendingLegs, args.startAt, args.effectiveEndAt)) {
    return { ok: false, reason: 'WINDOW_OVERLAPS_MOVEMENT' }
  }
  // §7 — every dropoff must be an active owner location (phase-1 leash; the
  // same-operator round trip passes because its location is in the set).
  if (!args.homewardDropoffIds.has(args.dropoffLocationId)) {
    return { ok: false, reason: 'DROPOFF_NOT_HOMEWARD' }
  }
  // R2 — the car must actually be at the chosen pickup at startAt.
  if (projectedLocationAt(args.currentLocationId, args.pendingLegs, args.startAt) !== args.pickupLocationId) {
    return { ok: false, reason: 'PICKUP_NOT_AT_LOCATION' }
  }
  // A round trip leaves the car where it was; R2 suffices.
  if (args.dropoffLocationId === args.pickupLocationId) return { ok: true }
  // One-way: successors are legs occupying from at/after this window's end.
  const successors = args.pendingLegs.filter(
    (l) => (l.departedAt ?? l.plannedStartAt).getTime() >= args.effectiveEndAt.getTime(),
  )
  if (successors.length === 0) return { ok: true }
  if (args.policy === 'TAIL_ONLY') return { ok: false, reason: 'ONEWAY_NOT_TAIL' }
  // FULL_CHAIN (future phase): R3 — the immediate successor departs from here.
  const earliest = successors.reduce((a, l) =>
    (l.departedAt ?? l.plannedStartAt).getTime() < (a.departedAt ?? a.plannedStartAt).getTime() ? l : a,
  )
  if (earliest.fromLocationId !== args.dropoffLocationId) {
    return { ok: false, reason: 'DROPOFF_DISCONTINUITY' }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun run --filter @kuruma/shared test -- custody-feasibility`
Expected: PASS (9 tests).

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
git commit -m "feat(custody): one shared feasibility predicate; supersede one-way.ts (slice 0)"
```

---

## Phase 2 — Slice 1 schema

### Task 5: Custody columns + three new tables + migration

**Files:**
- Modify: `packages/shared/src/db/fleet.ts` (vehicles columns + extras)
- Create: `packages/shared/src/db/custody.ts`
- Modify: `packages/shared/src/db/schema.ts` (barrel line)
- Generate: `drizzle/01NN_one_way_custody_schema.sql`

No RED test here — the check is `db:verify` + generated SQL review. Schema tests come with the repos (Task 7/8).

- [ ] **Step 1: Add vehicle custody columns** in `packages/shared/src/db/fleet.ts`, after `insuranceExpiryDate` (line ~132), before `createdAt`:

```ts
    // --- One-way custody network (§4). pickupLocationId is REINTERPRETED as the
    // vehicle's HOME BASE (a re-label never moves the car); the pair below is the
    // materialized physical state, written ONLY by placement/receipt/departure.
    // NULL custodyState = custody-untracked (no home base assigned yet).
    custodyState: custodyStateEnum('custodyState'),
    physicalHostOperatorId: text('physicalHostOperatorId'),
    physicalLocationId: text('physicalLocationId'),
    // §5: listing suppression on a received car (ferry queued / promo-home / owner hold).
    heldOffline: boolean('heldOffline').notNull().default(false),
    // §5: per-car owner setting — relist immediately on receipt vs wait for owner.
    autoRelistOnReceipt: boolean('autoRelistOnReceipt').notNull().default(false),
    // §8 B2 promo-home: discount for a booking that lands the car at its home base
    // before the cutoff. Cleared automatically by a receipt at home.
    homewardPromoPercent: integer('homewardPromoPercent'),
    homewardPromoCutoffAt: timestamp('homewardPromoCutoffAt', { withTimezone: true, mode: 'date' }),
```

Add the enum at the top of `fleet.ts` (next to the existing pgEnums):

```ts
export const custodyStateEnum = pgEnum('custody_state', CUSTODY_STATES)
```

(import `CUSTODY_STATES` from `'../enums'`; `boolean` may need adding to the drizzle-orm/pg-core import list.)

- [ ] **Step 2: Add vehicle extras** in the `fleet.ts` vehicles extras array (after the existing composite FKs, ~line 185):

```ts
    // Physical state may cross operators in Slice 2; the operator component is
    // what makes the FK real (§11). Target: locations_operatorId_id_unique.
    foreignKey({
      columns: [table.physicalHostOperatorId, table.physicalLocationId],
      foreignColumns: [locations.operatorId, locations.id],
      name: 'vehicles_physical_location_fk',
    }),
    index('idx_vehicles_physicalHostOperatorId').on(table.physicalHostOperatorId),
    index('idx_vehicles_physicalLocationId').on(table.physicalLocationId),
    // §4 invariant: AT_STATION ⇔ both physical ids present; IN_TRANSIT or
    // untracked (NULL) ⇔ both absent. ::text cast — enum + CHECK land in one
    // migration tx (consent.ts:100 gotcha).
    check(
      'vehicles_custody_state_nulls',
      sql`CASE WHEN ${table.custodyState}::text = 'AT_STATION'
            THEN ${table.physicalHostOperatorId} IS NOT NULL AND ${table.physicalLocationId} IS NOT NULL
            ELSE ${table.physicalHostOperatorId} IS NULL AND ${table.physicalLocationId} IS NULL END`,
    ),
    check(
      'vehicles_homeward_promo_pair',
      sql`(${table.homewardPromoPercent} IS NULL) = (${table.homewardPromoCutoffAt} IS NULL)`,
    ),
    check(
      'vehicles_homeward_promo_percent_range',
      sql`${table.homewardPromoPercent} IS NULL OR (${table.homewardPromoPercent} BETWEEN 1 AND 100)`,
    ),
```

- [ ] **Step 3: Create the custody bounded-context module**

```ts
// packages/shared/src/db/custody.ts
// One-way custody network (design 2026-07-26): movement_legs is ONE row per
// physical traversal (§6.1) — the shared movement identity consumed by the
// §2.1 feasibility fold, the §10 custody-period boundaries, and the §6.2
// receipt records. custody_periods is the accrual ledger [receivedAt,
// departedAt) — the time a host ACTUALLY holds the car. handoff_receipts is
// immutable legal evidence (append-only, private photos — NOT the public
// catalog-photo pipeline).
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
    // Set for RENTAL, null for FERRY/TRANSFER (§6.1 — a ferry has no booking).
    bookingId: text('bookingId').references(() => bookings.id, { onDelete: 'restrict' }),
    fromOperatorId: text('fromOperatorId').notNull(),
    fromLocationId: text('fromLocationId').notNull(),
    // May be RE-SET on receipt when the actual arrival differs from the plan
    // (active-cancel recovery, §5) — the only mutable pair on the row.
    toOperatorId: text('toOperatorId').notNull(),
    toLocationId: text('toLocationId').notNull(),
    plannedStartAt: timestamp('plannedStartAt', { withTimezone: true, mode: 'date' }).notNull(),
    plannedEndAt: timestamp('plannedEndAt', { withTimezone: true, mode: 'date' }).notNull(),
    // The §2.1 planned→actual flip: each set EXACTLY ONCE, never cleared.
    departedAt: timestamp('departedAt', { withTimezone: true, mode: 'date' }),
    receivedAt: timestamp('receivedAt', { withTimezone: true, mode: 'date' }),
    // Pre-start cancellation voids the planned leg (§5); a departed leg can
    // never be voided — it becomes the recovery leg instead.
    voidedAt: timestamp('voidedAt', { withTimezone: true, mode: 'date' }),
    idempotencyKey: text('idempotencyKey').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_movement_legs_vehicleId').on(table.vehicleId),
    index('idx_movement_legs_bookingId').on(table.bookingId),
    index('idx_movement_legs_fromOperatorId').on(table.fromOperatorId),
    index('idx_movement_legs_toOperatorId').on(table.toOperatorId),
    // The feasibility fold reads exactly this slice (§2.1 pending projection).
    index('idx_movement_legs_pending')
      .on(table.vehicleId)
      .where(sql`${table.receivedAt} IS NULL AND ${table.voidedAt} IS NULL`),
    // §6.1 seals: a retried create never duplicates a traversal; one leg per booking.
    uniqueIndex('movement_legs_idempotencyKey_unique').on(table.idempotencyKey),
    uniqueIndex('movement_legs_bookingId_unique')
      .on(table.bookingId)
      .where(sql`${table.bookingId} IS NOT NULL`),
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
    check('movement_legs_planned_window', sql`${table.plannedEndAt} > ${table.plannedStartAt}`),
    check(
      'movement_legs_received_requires_departed',
      sql`${table.receivedAt} IS NULL OR ${table.departedAt} IS NOT NULL`,
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
    // [held): opens on the arrival receipt, closes the instant the car departs (§10).
    receivedAt: timestamp('receivedAt', { withTimezone: true, mode: 'date' }).notNull(),
    departedAt: timestamp('departedAt', { withTimezone: true, mode: 'date' }),
    openedByLegId: text('openedByLegId')
      .notNull()
      .references(() => movementLegs.id, { onDelete: 'restrict' }),
    closedByLegId: text('closedByLegId').references(() => movementLegs.id, { onDelete: 'restrict' }),
    // Snapshotted at receipt so a later fee-config change never retro-alters an
    // amount already owed (§10). Slice 1: always 0 (hostIsOwner).
    dailyRateJpySnapshot: integer('dailyRateJpySnapshot').notNull().default(0),
    handoffFeeJpySnapshot: integer('handoffFeeJpySnapshot').notNull().default(0),
    // Derived at close in Slice 2 (day-count/rounding are open inputs, §13.7).
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
    // §10: one open period per vehicle is a DB seal, not prose.
    uniqueIndex('custody_periods_one_open_per_vehicle')
      .on(table.vehicleId)
      .where(sql`${table.departedAt} IS NULL`),
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
    // Structured condition (§6.2) — evidence for damage attribution, flat and typed.
    fuelPercent: integer('fuelPercent'),
    odometerKm: integer('odometerKm'),
    damageReported: boolean('damageReported').notNull().default(false),
    conditionNotes: text('conditionNotes'),
    // PRIVATE R2 keys (HANDOFF_RECEIPTS bucket) — never public catalog URLs.
    photoStorageKeys: text('photoStorageKeys').array().notNull().default([]),
    // A correction is a NEW row pointing at the row it replaces (§6.2) — never
    // an update. The current view is the head of the supersession chain.
    supersedesReceiptId: text('supersedesReceiptId'),
    idempotencyKey: text('idempotencyKey').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_handoff_receipts_legId').on(table.legId),
    index('idx_handoff_receipts_vehicleId').on(table.vehicleId),
    index('idx_handoff_receipts_actorUserId').on(table.actorUserId),
    index('idx_handoff_receipts_actorOperatorId').on(table.actorOperatorId),
    index('idx_handoff_receipts_atOperatorId').on(table.atOperatorId),
    index('idx_handoff_receipts_supersedesReceiptId').on(table.supersedesReceiptId),
    // §6.2 seals, all of them:
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

- [ ] **Step 4: Barrel** — add to `packages/shared/src/db/schema.ts` (alphabetical position among the existing `export *` lines):

```ts
export * from './custody'
```

- [ ] **Step 5: Generate + apply + verify**

```bash
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:generate --name one_way_custody_schema
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:migrate
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:verify
```

Expected: one new migration; verify 3 green checks. Inspect the generated SQL: 4 new enum types, 3 new tables with every named constraint above, vehicles gains 7 columns + 1 composite FK + 2 indexes + 3 CHECKs. If drizzle-kit fails on the self-referential composite FK, fall back to `--custom` for that single `ALTER TABLE handoff_receipts ADD CONSTRAINT handoff_receipts_correction_same_end_fk FOREIGN KEY ("supersedesReceiptId","legId","phase") REFERENCES handoff_receipts (id,"legId",phase);` and note it in the migration comment.

- [ ] **Step 6: Typecheck + commit**

```bash
bunx tsc -p packages/shared --noEmit && bun run lint
git add packages/shared/src/db packages/shared/src/enums.ts drizzle
git commit -m "feat(custody): vehicles custody columns + movement_legs/custody_periods/handoff_receipts (slice 1 schema)"
```

### Task 6: Backfill migration (custody-tracked = every assigned vehicle)

**Files:**
- Generate: `drizzle/01NN_backfill_vehicle_custody.sql` (custom)

- [ ] **Step 1: Generate the custom migration**

```bash
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:generate --custom --name backfill_vehicle_custody
```

Fill the generated file with:

```sql
-- One-way custody backfill: every vehicle with a home base starts AT_STATION,
-- host = owner, physically at home. Idempotent (custodyState IS NULL guard) and
-- flag-off-equivalent: physicalLocationId mirrors pickupLocationId exactly, so
-- search behavior is unchanged until ONE_WAY_CUSTODY flips. Vehicles without a
-- pickupLocationId stay custody-untracked (NULL) — first placement happens when
-- a home base is assigned (VehicleService, slice 1).
UPDATE "vehicles"
SET "custodyState" = 'AT_STATION',
    "physicalHostOperatorId" = "operatorId",
    "physicalLocationId" = "pickupLocationId"
WHERE "pickupLocationId" IS NOT NULL
  AND "custodyState" IS NULL;
```

- [ ] **Step 2: Apply + verify + spot-check**

```bash
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:migrate
DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bun run db:verify
docker exec kuruma-custody-pg psql -U kuruma -d kuruma_custody -c "SELECT count(*) FILTER (WHERE \"custodyState\" = 'AT_STATION' AND \"physicalLocationId\" = \"pickupLocationId\") AS tracked, count(*) FILTER (WHERE \"custodyState\" IS NULL) AS untracked FROM vehicles;"
```

Expected: verify green; every vehicle with a pickup location is `tracked` (a freshly-migrated empty DB shows 0/0 — seed first with `bun run db:seed` against the local DB if you want a non-trivial check).

- [ ] **Step 3: Commit**

```bash
git add drizzle
git commit -m "feat(custody): backfill materialized custody state for assigned vehicles"
```

---

## Phase 3 — Ports + repositories

**Cap guard (applies to Tasks 7–9):** `repositories/types.ts` is AT the 800-line hard cap — do NOT touch it. All new interfaces go in `types-custody.ts`; services import from `'../repositories/types-custody'` directly (Rule 2's regex allows any `repositories/types*` — precedent: `services/operator-terms.ts:5` imports from `types-consent`). `stores.ts` is 708/800 — the ~70 new entity lines fit, but check `bun run lint:size` after.

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
export type { CustodySettlementState, CustodyState, HandoffPhase, MovementLegKind } from '../enums'
```

- [ ] **Step 2: Entities in `stores.ts`.** Extend the `Vehicle` interface (find it via `grep -n "interface Vehicle " packages/api/src/stores.ts`) with:

```ts
  // One-way custody (§4): pickupLocationId is the HOME BASE; the physical pair
  // is written only by placement/receipt/departure. null custodyState = untracked.
  custodyState: CustodyState | null
  physicalHostOperatorId: string | null
  physicalLocationId: string | null
  heldOffline: boolean
  autoRelistOnReceipt: boolean
  homewardPromoPercent: number | null
  homewardPromoCutoffAt: Date | null
```

and add three new interfaces next to `ClassRatePlan` (import the four custody enum types from `@kuruma/shared/db/schema` in the existing type-import block):

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
  idempotencyKey: string
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
  openedByLegId: string
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
  createdAt: Date
}
```

**Compile fallout:** extending `Vehicle` breaks every fixture that builds a vehicle literal. Run `bunx tsc -p packages/api --noEmit` and fix each site by adding the untracked defaults (`custodyState: null, physicalHostOperatorId: null, physicalLocationId: null, heldOffline: false, autoRelistOnReceipt: false, homewardPromoPercent: null, homewardPromoCutoffAt: null`) — untracked is listable, so existing tests keep their behavior. Prefer extending any central `makeVehicle`-style factory over editing dozens of literals. Also extend the drizzle vehicle column list/mapper (in `repositories/drizzle/shared.ts` or the vehicle repo — wherever `tsc` points) and the in-memory vehicle `create` defaults (same values; when the in-memory create receives a `pickupLocationId`, still default custody to untracked — the placement rule is a Task 12 service concern).

- [ ] **Step 3: Named-constraint consts** — append to `packages/api/src/pg-errors.ts`:

```ts
/** §6.1 seals on movement_legs: retried create-leg never duplicates a traversal; one leg per booking. */
export const MOVEMENT_LEGS_IDEMPOTENCY_UNIQUE = 'movement_legs_idempotencyKey_unique'
export const MOVEMENT_LEGS_BOOKING_UNIQUE = 'movement_legs_bookingId_unique'
/** §10: one open custody period per vehicle — a double-receipt race is rejected by the DB. */
export const CUSTODY_PERIODS_ONE_OPEN = 'custody_periods_one_open_per_vehicle'
/** §6.2 seals on handoff_receipts. */
export const HANDOFF_RECEIPTS_IDEMPOTENCY_UNIQUE = 'handoff_receipts_idempotencyKey_unique'
export const HANDOFF_RECEIPTS_CANONICAL_UNIQUE = 'handoff_receipts_canonical_unique'
export const HANDOFF_RECEIPTS_SUPERSEDES_UNIQUE = 'handoff_receipts_supersedes_unique'
```

- [ ] **Step 4: The ports**

```ts
// packages/api/src/repositories/types-custody.ts
// One-way custody ports (§6.1/§10/§6.2). In their own module because
// repositories/types.ts is at the file-size cap (#978 pattern); services
// import from here directly (same as types-consent). These ports take explicit
// ids, NOT CallerContext — custody moves are service-orchestrated and the
// service enforces fleet-write + tenant binding first (ConsentRepository
// precedent). Every mark* method embeds its precondition in the WHERE and
// returns undefined when unmet, so the §2.1 planned→actual flip happens
// EXACTLY ONCE even under retry.
import type { CustodyPeriod, HandoffReceipt, MovementLeg, Vehicle } from '../stores'

export type NewMovementLeg = Omit<
  MovementLeg,
  'id' | 'createdAt' | 'departedAt' | 'receivedAt' | 'voidedAt'
> & {
  /** A ferry departs the moment it is created; a rental leg is created planned. */
  departedAt?: Date | null
}

export interface MovementLegRepository {
  /** Throws 23505 `movement_legs_idempotencyKey_unique` / `movement_legs_bookingId_unique`. */
  create(data: NewMovementLeg): Promise<MovementLeg>
  findById(id: string): Promise<MovementLeg | undefined>
  findByBookingId(bookingId: string): Promise<MovementLeg | undefined>
  /** The §2.1 pending projection: receivedAt IS NULL AND voidedAt IS NULL. */
  findPendingByVehicle(vehicleId: string): Promise<MovementLeg[]>
  /** The (at most one, by process invariant) departed-but-unarrived leg. */
  findInFlightByVehicle(vehicleId: string): Promise<MovementLeg | undefined>
  /** Guard: departedAt IS NULL AND voidedAt IS NULL — undefined when unmet. */
  markDeparted(id: string, departedAt: Date): Promise<MovementLeg | undefined>
  /** Guard: receivedAt IS NULL AND departedAt IS NOT NULL. Re-sets to* on recovery (§5). */
  markReceived(
    id: string,
    args: { receivedAt: Date; toOperatorId: string; toLocationId: string },
  ): Promise<MovementLeg | undefined>
  /** Guard: departedAt IS NULL AND voidedAt IS NULL (pre-start cancel only, §5). */
  markVoided(id: string, voidedAt: Date): Promise<MovementLeg | undefined>
  /** Archival guard (§7): pending legs whose endpoint is this location. */
  countPendingTo(operatorId: string, locationId: string): Promise<number>
}

export type NewCustodyPeriod = Omit<
  CustodyPeriod,
  'id' | 'createdAt' | 'departedAt' | 'closedByLegId' | 'accruedJpy' | 'settlementState' | 'settlementRef' | 'settledAt'
>

export interface CustodyPeriodRepository {
  /** Throws 23505 `custody_periods_one_open_per_vehicle` on a double-open. */
  open(data: NewCustodyPeriod): Promise<CustodyPeriod>
  /** Closes the open period (settlementState → CLOSED); undefined when none open. */
  closeOpen(
    vehicleId: string,
    args: { departedAt: Date; closedByLegId: string },
  ): Promise<CustodyPeriod | undefined>
  findOpenByVehicle(vehicleId: string): Promise<CustodyPeriod | undefined>
  findByVehicle(vehicleId: string): Promise<CustodyPeriod[]>
}

export type NewHandoffReceipt = Omit<HandoffReceipt, 'id' | 'createdAt'>

/** Append-only by design (§6.2): no update, no delete — a correction is a new row. */
export interface HandoffReceiptRepository {
  /** Throws named 23505s: idempotency / canonical-per-leg-end / supersedes-linear. */
  create(data: NewHandoffReceipt): Promise<HandoffReceipt>
  findById(id: string): Promise<HandoffReceipt | undefined>
  findByLeg(legId: string): Promise<HandoffReceipt[]>
  findByVehicle(vehicleId: string): Promise<HandoffReceipt[]>
}

/** §2.1: ONE per-vehicle advisory xact-lock guards every timeline mutation
 *  (booking create/cancel/substitution + leg departure + arrival receipt).
 *  Same shape as lockComboCapacity: pg auto-releases at tx end (noop thunk);
 *  the in-memory mirror serializes on the returned release. Implemented by the
 *  availability repositories (declared here — types.ts is at the size cap). */
export interface VehicleTimelineLock {
  lockVehicleTimeline(vehicleId: string): Promise<() => void>
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
        | 'heldOffline'
        | 'autoRelistOnReceipt'
        | 'homewardPromoPercent'
        | 'homewardPromoCutoffAt'
      >
    >,
  ): Promise<Vehicle | undefined>
}

/** Archival guard reads (§7) — implemented by both concrete vehicle repos. */
export interface VehicleCustodyReads {
  countHomeBasedAt(operatorId: string, locationId: string): Promise<number>
  countPhysicallyAt(operatorId: string, locationId: string): Promise<number>
}
```

- [ ] **Step 5: Failing in-memory tests.** Write the three test files. Complete file for movement-leg (the other two follow the same shape — their full assertion lists are below):

```ts
// packages/api/src/repositories/in-memory/movement-leg.test.ts
import { describe, expect, it } from 'vitest'
import {
  MOVEMENT_LEGS_BOOKING_UNIQUE,
  MOVEMENT_LEGS_IDEMPOTENCY_UNIQUE,
  PG_ERROR,
  pgConstraintName,
  pgErrorCode,
} from '../../pg-errors'
import type { NewMovementLeg } from '../types-custody'
import { InMemoryMovementLegRepository } from './movement-leg'

const d = (iso: string): Date => new Date(iso)
const legData = (over: Partial<NewMovementLeg> = {}): NewMovementLeg => ({
  vehicleId: 'v1',
  kind: 'RENTAL',
  bookingId: null,
  fromOperatorId: 'op',
  fromLocationId: 'A',
  toOperatorId: 'op',
  toLocationId: 'B',
  plannedStartAt: d('2026-08-01T10:00:00Z'),
  plannedEndAt: d('2026-08-03T10:00:00Z'),
  idempotencyKey: crypto.randomUUID(),
  ...over,
})

describe('InMemoryMovementLegRepository', () => {
  it('creates a planned leg (not departed, not received, not voided)', async () => {
    const repo = new InMemoryMovementLegRepository()
    const leg = await repo.create(legData())
    expect(leg.departedAt).toBeNull()
    expect(leg.receivedAt).toBeNull()
    expect(leg.voidedAt).toBeNull()
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
  it('rejects a second leg for one booking with the named 23505', async () => {
    const repo = new InMemoryMovementLegRepository()
    await repo.create(legData({ bookingId: 'b1' }))
    const err = await repo.create(legData({ bookingId: 'b1' })).catch((e: unknown) => e)
    expect(pgErrorCode(err)).toBe(PG_ERROR.UNIQUE_VIOLATION)
    expect(pgConstraintName(err)).toBe(MOVEMENT_LEGS_BOOKING_UNIQUE)
  })
  it('markDeparted flips exactly once', async () => {
    const repo = new InMemoryMovementLegRepository()
    const leg = await repo.create(legData())
    const departed = await repo.markDeparted(leg.id, d('2026-08-01T10:05:00Z'))
    expect(departed?.departedAt).toEqual(d('2026-08-01T10:05:00Z'))
    expect(await repo.markDeparted(leg.id, d('2026-08-01T11:00:00Z'))).toBeUndefined()
    expect(await repo.findInFlightByVehicle('v1')).toMatchObject({ id: leg.id })
  })
  it('markReceived requires a departed leg, flips exactly once, and re-targets to*', async () => {
    const repo = new InMemoryMovementLegRepository()
    const leg = await repo.create(legData())
    expect(
      await repo.markReceived(leg.id, { receivedAt: d('2026-08-03T09:00:00Z'), toOperatorId: 'op', toLocationId: 'C' }),
    ).toBeUndefined() // not departed yet
    await repo.markDeparted(leg.id, d('2026-08-01T10:05:00Z'))
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
    await repo.markDeparted(departedLeg.id, d('2026-08-01T10:05:00Z'))
    expect((await repo.markVoided(planned.id, d('2026-07-30T00:00:00Z')))?.voidedAt).not.toBeNull()
    expect(await repo.markVoided(departedLeg.id, d('2026-07-30T00:00:00Z'))).toBeUndefined()
    expect(await repo.findPendingByVehicle('v1')).toHaveLength(1) // voided leg dropped out
  })
  it('countPendingTo counts pending legs targeting a location', async () => {
    const repo = new InMemoryMovementLegRepository()
    await repo.create(legData())
    const voided = await repo.create(legData({ idempotencyKey: crypto.randomUUID() }))
    await repo.markVoided(voided.id, d('2026-07-30T00:00:00Z'))
    expect(await repo.countPendingTo('op', 'B')).toBe(1)
    expect(await repo.countPendingTo('op', 'Z')).toBe(0)
  })
})
```

`custody-period.test.ts` asserts: open→row with `settlementState: 'ACCRUING'`, `departedAt: null`; second `open` for the same vehicle throws named `CUSTODY_PERIODS_ONE_OPEN` (`pgErrorCode` 23505 + `pgConstraintName`); after `closeOpen` the row has the given `departedAt`/`closedByLegId` + `settlementState: 'CLOSED'` and a NEW `open` succeeds; `closeOpen` with nothing open returns `undefined`; `findOpenByVehicle` returns only the open row.
`handoff-receipt.test.ts` asserts: create returns the row; duplicate `idempotencyKey` throws named `HANDOFF_RECEIPTS_IDEMPOTENCY_UNIQUE`; a second canonical (same `legId`+`phase`, `supersedesReceiptId: null`) throws named `HANDOFF_RECEIPTS_CANONICAL_UNIQUE`; a correction (`supersedesReceiptId` set to the first row's id, same leg+phase) succeeds; two corrections pointing at the same row throw named `HANDOFF_RECEIPTS_SUPERSEDES_UNIQUE`; `findByLeg` returns both rows.

- [ ] **Step 6: Run to verify failure**

Run: `bun run --filter @kuruma/api test -- in-memory/movement-leg in-memory/custody-period in-memory/handoff-receipt`
Expected: FAIL — modules not found.

- [ ] **Step 7: Implement the three in-memory repos.** Shared throw idiom (mirror `in-memory/booking.ts` — set BOTH `code` and `constraint_name` so `pgConstraintName` resolves):

```ts
// packages/api/src/repositories/in-memory/movement-leg.ts
import {
  MOVEMENT_LEGS_BOOKING_UNIQUE,
  MOVEMENT_LEGS_IDEMPOTENCY_UNIQUE,
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
      if (data.bookingId !== null && leg.bookingId === data.bookingId) {
        throw uniqueViolation(MOVEMENT_LEGS_BOOKING_UNIQUE)
      }
    }
    const leg: MovementLeg = {
      ...data,
      id: crypto.randomUUID(),
      departedAt: data.departedAt ?? null,
      receivedAt: null,
      voidedAt: null,
      createdAt: new Date(),
    }
    this.store.set(leg.id, leg)
    return leg
  }

  async findById(id: string): Promise<MovementLeg | undefined> {
    return this.store.get(id)
  }

  async findByBookingId(bookingId: string): Promise<MovementLeg | undefined> {
    return [...this.store.values()].find((l) => l.bookingId === bookingId)
  }

  async findPendingByVehicle(vehicleId: string): Promise<MovementLeg[]> {
    return [...this.store.values()].filter(
      (l) => l.vehicleId === vehicleId && l.receivedAt === null && l.voidedAt === null,
    )
  }

  async findInFlightByVehicle(vehicleId: string): Promise<MovementLeg | undefined> {
    return (await this.findPendingByVehicle(vehicleId)).find((l) => l.departedAt !== null)
  }

  async markDeparted(id: string, departedAt: Date): Promise<MovementLeg | undefined> {
    const leg = this.store.get(id)
    if (!leg || leg.departedAt !== null || leg.voidedAt !== null) return undefined
    const next = { ...leg, departedAt }
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
}
```

`in-memory/custody-period.ts` — same shape: `open()` scans for an existing row with `vehicleId` + `departedAt === null` and throws `uniqueViolation(CUSTODY_PERIODS_ONE_OPEN)`; inserts `{ ...data, id: crypto.randomUUID(), departedAt: null, closedByLegId: null, accruedJpy: null, settlementState: 'ACCRUING', settlementRef: null, settledAt: null, createdAt: new Date() }`. `closeOpen()` finds the open row, replaces it with `{ ...row, departedAt: args.departedAt, closedByLegId: args.closedByLegId, settlementState: 'CLOSED' }`.
`in-memory/handoff-receipt.ts` — `create()` scans: idempotency dup → `HANDOFF_RECEIPTS_IDEMPOTENCY_UNIQUE`; same `(legId, phase)` with both `supersedesReceiptId === null` → `HANDOFF_RECEIPTS_CANONICAL_UNIQUE`; same non-null `supersedesReceiptId` → `HANDOFF_RECEIPTS_SUPERSEDES_UNIQUE`. No update/delete methods exist.

- [ ] **Step 8: Run to verify pass, then commit**

Run: `bun run --filter @kuruma/api test -- in-memory/movement-leg in-memory/custody-period in-memory/handoff-receipt` → PASS.
Run: `bunx tsc -p packages/api --noEmit` → clean (Vehicle fallout fixed).

```bash
git add packages/api/src/stores.ts packages/api/src/pg-errors.ts packages/api/src/repositories packages/shared/src/db/custody.ts
git commit -m "feat(custody): custody ports + in-memory repositories with seal parity"
```

### Task 8: Drizzle repositories + transaction bundle + real-pg seal tests

**Files:**
- Create: `packages/api/src/repositories/drizzle/movement-leg.ts`, `drizzle/custody-period.ts`, `drizzle/handoff-receipt.ts`
- Modify: `packages/api/src/repositories/types-transactions.ts`, `repositories/drizzle/transaction.ts`
- Modify: `packages/api/src/composition/repositories.ts`, `packages/api/src/app-overrides.ts`
- Test: `packages/api/tests/integration/custody-repo.test.ts`

- [ ] **Step 1: Drizzle repos.** Pattern (movement-leg shown; the others mirror it — every guard lives in the WHERE):

```ts
// packages/api/src/repositories/drizzle/movement-leg.ts
import { movementLegs } from '@kuruma/shared/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { MovementLeg } from '../../stores'
import type { MovementLegRepository, NewMovementLeg } from '../types-custody'
import type { Db } from './shared'

export class DrizzleMovementLegRepository implements MovementLegRepository {
  constructor(private readonly db: Db) {}

  async create(data: NewMovementLeg): Promise<MovementLeg> {
    const [row] = await this.db
      .insert(movementLegs)
      .values({ ...data, departedAt: data.departedAt ?? null })
      .returning()
    if (!row) throw new Error('Failed to insert movement leg')
    return row
  }

  async findById(id: string): Promise<MovementLeg | undefined> {
    const [row] = await this.db.select().from(movementLegs).where(eq(movementLegs.id, id))
    return row
  }

  async findByBookingId(bookingId: string): Promise<MovementLeg | undefined> {
    const [row] = await this.db.select().from(movementLegs).where(eq(movementLegs.bookingId, bookingId))
    return row
  }

  async findPendingByVehicle(vehicleId: string): Promise<MovementLeg[]> {
    return this.db
      .select()
      .from(movementLegs)
      .where(
        and(
          eq(movementLegs.vehicleId, vehicleId),
          isNull(movementLegs.receivedAt),
          isNull(movementLegs.voidedAt),
        ),
      )
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
    return row
  }

  async markDeparted(id: string, departedAt: Date): Promise<MovementLeg | undefined> {
    const [row] = await this.db
      .update(movementLegs)
      .set({ departedAt })
      .where(and(eq(movementLegs.id, id), isNull(movementLegs.departedAt), isNull(movementLegs.voidedAt)))
      .returning()
    return row
  }

  async markReceived(
    id: string,
    args: { receivedAt: Date; toOperatorId: string; toLocationId: string },
  ): Promise<MovementLeg | undefined> {
    const [row] = await this.db
      .update(movementLegs)
      .set({ receivedAt: args.receivedAt, toOperatorId: args.toOperatorId, toLocationId: args.toLocationId })
      .where(
        and(
          eq(movementLegs.id, id),
          isNull(movementLegs.receivedAt),
          sql`${movementLegs.departedAt} IS NOT NULL`,
        ),
      )
      .returning()
    return row
  }

  async markVoided(id: string, voidedAt: Date): Promise<MovementLeg | undefined> {
    const [row] = await this.db
      .update(movementLegs)
      .set({ voidedAt })
      .where(and(eq(movementLegs.id, id), isNull(movementLegs.departedAt), isNull(movementLegs.voidedAt)))
      .returning()
    return row
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
}
```

`drizzle/custody-period.ts`: `open()` plain insert (the partial unique index throws the named 23505); `closeOpen()` = `update ... set({ departedAt, closedByLegId, settlementState: 'CLOSED' }).where(and(eq(vehicleId), isNull(departedAt))).returning()`. `drizzle/handoff-receipt.ts`: plain insert (all seals are DB constraints) + the three finders. If `select()` row types don't structurally match the `stores` interfaces (e.g. array column typing), add a small `toX` mapper in the repo file rather than widening types.

- [ ] **Step 2: Transaction bundle.** In `types-transactions.ts`, extend `TransactionRepos` (after `consentRepo`):

```ts
  // One-way custody (§2.1/§10): leg create + planned→actual flips + period
  // open/close happen INSIDE the booking/custody tx, under the per-vehicle lock.
  movementLegRepo: MovementLegRepository
  custodyPeriodRepo: CustodyPeriodRepository
  handoffReceiptRepo: HandoffReceiptRepository
  vehicleTimelineLock: VehicleTimelineLock
  vehicleCustody: VehicleCustodyWrites
```

with `import type { CustodyPeriodRepository, HandoffReceiptRepository, MovementLegRepository, VehicleCustodyWrites, VehicleTimelineLock } from './types-custody'`. (`vehicleTimelineLock`/`vehicleCustody` are separate fields typed as the narrow interfaces because `VehicleRepository`/`AvailabilityRepository` live in capped `types.ts` and cannot grow — both bind to the same concrete instances.) In `drizzle/transaction.ts`, add to the bundle returned inside `runInteractiveTx` (the vehicle/availability instances are already constructed there — reuse them, don't construct twice):

```ts
        movementLegRepo: new DrizzleMovementLegRepository(txDb),
        custodyPeriodRepo: new DrizzleCustodyPeriodRepository(txDb),
        handoffReceiptRepo: new DrizzleHandoffReceiptRepository(txDb),
        vehicleTimelineLock: availabilityRepo, // tx-bound DrizzleAvailabilityRepository (method added in Task 9)
        vehicleCustody: vehicleRepo, // tx-bound DrizzleVehicleRepository (updateCustody added in Task 12)
```

(Task 9 adds `lockVehicleTimeline` to the availability repos; to keep this task compiling, add the interface method in Task 9 and wire `vehicleTimelineLock` there if you prefer strict ordering — otherwise implement both tasks' repo edits together and commit separately.)

- [ ] **Step 3: Composition wiring** — `composition/repositories.ts`: add the three fields to the `Repos` interface; in BOTH in-memory builders instantiate `new InMemoryMovementLegRepository()` etc. (honoring `overrides.movementLegRepo ?? ...`), include them in the returned bundle AND inside both in-memory `runInTransaction` closures; in `buildDrizzleRepos` add `movementLegRepo: new DrizzleMovementLegRepository(db)` etc. Add the three optional slots to `app-overrides.ts`. Mirror exactly how `classRatePlanRepo` is threaded (`repositories.ts:203/259/281/364/475/524/564/618`, `app-overrides.ts:79`).

- [ ] **Step 4: Real-pg seal test** — `packages/api/tests/integration/custody-repo.test.ts`, following `consent-repo.test.ts`'s own-client idiom (`postgres(url, { max: 1 })` + `drizzle(client, { schema }) as unknown as Db`). Seed one operator + location + vehicle (unique suffix, cleaned in `afterAll`). Assert with `pgErrorCode`/`pgConstraintName`:
  1. duplicate leg `idempotencyKey` → 23505 `movement_legs_idempotencyKey_unique`
  2. second leg for one booking → `movement_legs_bookingId_unique`
  3. `markReceived` before departure → `undefined`; after departure → row; second call → `undefined` (the §2.1 exactly-once flip, now DB-enforced)
  4. voiding a departed leg → `undefined`
  5. two open periods for one vehicle → `custody_periods_one_open_per_vehicle`
  6. second canonical receipt for one leg-end → `handoff_receipts_canonical_unique`; correction insert (supersedes first) succeeds; second correction of the same row → `handoff_receipts_supersedes_unique`
  7. a correction naming a DIFFERENT leg in `legId` → 23503 `handoff_receipts_correction_same_end_fk`
  8. inserting a leg whose `(toOperatorId, toLocationId)` crosses tenants → 23503 `movement_legs_to_location_fk`

Run: `DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bunx vitest run tests/integration/custody-repo.test.ts --root packages/api`
Expected: PASS (8 tests).

- [ ] **Step 5: Full check + commit**

```bash
bunx tsc -p packages/api --noEmit && bun run --filter @kuruma/api test && bun run --filter @kuruma/api lint:boundaries
git add packages/api
git commit -m "feat(custody): drizzle custody repositories + tx bundle + real-pg seal tests"
```

### Task 9: The per-vehicle timeline lock

**Files:**
- Modify: `packages/api/src/repositories/drizzle/availability.ts`, `in-memory/availability.ts` (implement `VehicleTimelineLock`)
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
    // §2.1: ONE lock guards the whole movement stream — booking create/cancel/
    // substitution, leg departure, arrival receipt. Same mechanics as
    // lockComboCapacity: advisory xact-lock, auto-released at commit/rollback.
    // Lock ORDER when both are taken (SPECIFIC create): combo lock first, then
    // this — keep that order everywhere or two creates can deadlock.
    const key = `vehicle-timeline:${vehicleId}`
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
    return () => {}
  }
```

In-memory: clone the `comboLockTails` promise-chain pattern (`in-memory/availability.ts:152-176`) with its own `vehicleLockTails = new Map<string, Promise<void>>()` keyed `vehicle-timeline:${vehicleId}`. Declare `implements AvailabilityRepository, VehicleTimelineLock` on both classes. If Task 8's `vehicleTimelineLock` bundle field was deferred, wire it now (drizzle tx factory passes the tx-bound availability repo; in-memory closures pass the singleton).

- [ ] **Step 3: Verify + commit**

```bash
bun run --filter @kuruma/api test -- availability && bunx tsc -p packages/api --noEmit
git add packages/api
git commit -m "feat(custody): per-vehicle advisory timeline lock (drizzle + in-memory)"
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
- Modify: `packages/api/src/repositories/types-storage.ts` (+ the one re-export LINE in `types.ts` — extend the existing `export type { DocumentStorage, PhotoStorage } from './types-storage'` line in place, no new line)
- Create: `packages/api/src/repositories/r2-receipt-storage.ts`, `disabled-receipt-storage.ts`, `in-memory/receipt-storage.ts`
- Modify: `packages/api/src/composition/repositories.ts`, `app-overrides.ts`, `packages/api/wrangler.toml`
- Test: `packages/api/src/repositories/in-memory/receipt-storage.test.ts`

- [ ] **Step 1: Port** — append to `types-storage.ts`:

```ts
/** Private object storage for handoff-receipt evidence photos (§6.2): immutable
 *  (no delete — corrections add rows, evidence is never destroyed), private
 *  (streamed through the Worker like DocumentStorage — never a public URL). */
export interface ReceiptStorage {
  put(vehicleId: string, file: File): Promise<{ key: string }>
  getFile(key: string): Promise<{ body: ReadableStream; contentType: string } | null>
}
```

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
# HANDOFF_RECEIPTS: private custody-receipt evidence photos (one-way custody §6.2),
# served through the Worker only — no public URL. Bucket created at go-live.
[[r2_buckets]]
binding = "HANDOFF_RECEIPTS"
bucket_name = "kuruma-handoff-receipts"
```

and in `[env.production]` add the same block **commented out** with a note (mirror the VEHICLE_PHOTOS prod pattern — an absent binding must not break boot; DisabledReceiptStorage covers it).

- [ ] **Step 5: Verify + commit**

```bash
bun run --filter @kuruma/api test -- receipt-storage && bunx tsc -p packages/api --noEmit
git add packages/api
git commit -m "feat(custody): private ReceiptStorage port (R2/disabled/in-memory)"
```

### Task 12: Vehicle placement / sync / re-label rule + `updateCustody`

**Files:**
- Modify: `packages/api/src/repositories/drizzle/vehicle.ts`, `in-memory/vehicle.ts` (implement `VehicleCustodyWrites` + `VehicleCustodyReads`)
- Modify: `packages/api/src/services/vehicle.ts` (create `:135` region, update `:164-200` region)
- Modify: `packages/api/src/index.ts` (or composition) — thread `isCustodyEnabled` into `VehicleService`
- Test: extend the vehicle service test file (find via `ls packages/api/src/services/vehicle*.test.ts`)

- [ ] **Step 1: Failing service tests** (add to the existing vehicle service suite, using its fixture idiom):

```ts
describe('custody placement / sync / re-label (§4/§8)', () => {
  it('create with a pickup location places the car AT_STATION at home', async () => {
    // service.create(ctx, { ...validVehicleData, pickupLocationId: LOC_A })
    // expect vehicle.custodyState 'AT_STATION', physicalHostOperatorId OPERATOR_ID, physicalLocationId LOC_A
  })
  it('create without a location stays custody-untracked', async () => {
    // expect custodyState null, both physical ids null
  })
  it('first location assignment on update places the car', async () => {})
  it('flag OFF: changing pickupLocationId MOVES the physical pair (legacy sync)', async () => {})
  it('flag ON: changing pickupLocationId is a re-label — physical pair UNCHANGED', async () => {})
  it('flag OFF: clearing pickupLocationId untracks custody', async () => {})
})
```

Write them fully against the real service API (constructor gains `isCustodyEnabled: () => Promise<boolean>` — tests pass `async () => false` / `async () => true`). Run → FAIL (extra ctor arg missing / custody fields not written).

- [ ] **Step 2: Repo methods.** On BOTH concrete vehicle repos add (declare `implements ..., VehicleCustodyWrites, VehicleCustodyReads`):

```ts
  async updateCustody(vehicleId, patch) {
    // drizzle: this.db.update(vehicles).set(patch).where(eq(vehicles.id, vehicleId)).returning() → mapped row | undefined
    // in-memory: shallow-merge a new object into the map, return it
  }
  async countHomeBasedAt(operatorId, locationId) {
    // vehicles WHERE operatorId = $1 AND pickupLocationId = $2 (count)
  }
  async countPhysicallyAt(operatorId, locationId) {
    // vehicles WHERE physicalHostOperatorId = $1 AND physicalLocationId = $2 (count)
  }
```

The tenant-anchor lint scans repo writes: `updateCustody`'s patch type structurally excludes `operatorId` (it is `Pick`ed away), which is the same structural-exclusion argument as the `class-rate-plan` exemption — if `lint:tenant-anchors` still flags the file, add a `vehicle-custody` entry to its EXEMPTIONS with a comment citing the `Pick` (mirror `scripts/lint-tenant-anchor-immutability.ts`'s existing exemption shape).

- [ ] **Step 3: Service rule.** In `VehicleService.create` (payload built ~`:135`), compute the custody columns into the create payload:

```ts
      // §4: a home base assigned at birth places the car AT_STATION at home;
      // no home base = custody-untracked until one is assigned.
      custodyState: input.pickupLocationId ? ('AT_STATION' as const) : null,
      physicalHostOperatorId: input.pickupLocationId ? operatorId : null,
      physicalLocationId: input.pickupLocationId ?? null,
      heldOffline: false,
      autoRelistOnReceipt: false,
      homewardPromoPercent: null,
      homewardPromoCutoffAt: null,
```

In `VehicleService.update` (merge block ~`:193`), after computing `nextPickup = merge('pickupLocationId', existing.pickupLocationId)`:

```ts
    // §4/§8: placement vs sync vs re-label. Untracked + first location = placement.
    // Flag OFF keeps today's semantics (moving the home moves the car) so the
    // materialized pair stays byte-equivalent to pickupLocationId while dark.
    // Flag ON: a home re-label NEVER moves the car.
    const custody: Partial<Vehicle> = {}
    if (existing.custodyState === null && nextPickup) {
      custody.custodyState = 'AT_STATION'
      custody.physicalHostOperatorId = existing.operatorId
      custody.physicalLocationId = nextPickup
    } else if (existing.custodyState !== null && nextPickup !== existing.pickupLocationId) {
      if (!(await this.isCustodyEnabled())) {
        if (nextPickup) {
          if (existing.custodyState === 'AT_STATION') {
            custody.physicalHostOperatorId = existing.operatorId
            custody.physicalLocationId = nextPickup
          }
        } else {
          custody.custodyState = null
          custody.physicalHostOperatorId = null
          custody.physicalLocationId = null
        }
      }
    }
```

and spread `...custody` into the merged update payload. Wire `() => featureFlagsService.isEnabled('ONE_WAY_CUSTODY')` as the new ctor arg at the composition root (mirror how `BookingService` receives its flag reader at `index.ts:458`).

- [ ] **Step 4: Run to PASS, full suite, commit**

```bash
bun run --filter @kuruma/api test -- services/vehicle && bun run --filter @kuruma/api test && bunx tsc -p packages/api --noEmit
git add packages/api
git commit -m "feat(custody): vehicle placement + flag-off sync + re-label rule"
```

### Task 13: `CustodyService` — receipt gate, ferry, listing, promo

**Files:**
- Create: `packages/api/src/services/custody-motion.ts` (shared in-tx depart/void helpers)
- Create: `packages/api/src/services/custody.ts` (+ `custody.test.ts`)
- Modify: `packages/shared/src/lib/error-codes.ts` (+ membership test): add `'CUSTODY_CONFLICT'`

- [ ] **Step 1: The shared in-tx motion helpers** (used by this service, booking-lifecycle, and booking-create — one definition of "depart" and "void"):

```ts
// packages/api/src/services/custody-motion.ts
// One-way custody §5 transitions that run INSIDE an existing runInTransaction
// under the per-vehicle timeline lock. No-ops when the vehicle has no leg —
// that is exactly the dark-flag / legacy-booking case, so callers never branch.
import { departCustody } from '@kuruma/shared/lib/custody-state'
import type { TransactionRepos } from '../repositories/types-transactions'
import type { Vehicle } from '../stores'

/** Rental/ferry start: flip the leg, close the open custody period, go IN_TRANSIT. */
export async function departVehicleInTx(
  repos: TransactionRepos,
  vehicle: Vehicle,
  legId: string,
  departedAt: Date,
): Promise<void> {
  const marked = await repos.movementLegRepo.markDeparted(legId, departedAt)
  if (!marked) return // already departed (retry) — the flip happens exactly once
  await repos.custodyPeriodRepo.closeOpen(vehicle.id, { departedAt, closedByLegId: legId })
  const transition = departCustody(vehicle)
  if (transition.ok) await repos.vehicleCustody.updateCustody(vehicle.id, transition.next)
}

/** Pre-start cancel: void the planned leg. A departed leg is left in flight —
 *  that IS the active-cancel recovery leg (§5); only a receipt lands it. */
export async function voidBookingLegInTx(
  repos: TransactionRepos,
  bookingId: string,
  voidedAt: Date,
): Promise<void> {
  const leg = await repos.movementLegRepo.findByBookingId(bookingId)
  if (!leg) return
  await repos.movementLegRepo.markVoided(leg.id, voidedAt)
}
```

(`@kuruma/shared/lib/custody-state` may need a `package.json` subpath export in `packages/shared` — mirror how `lib/error-codes` is exported; add `./lib/custody-state`, `./lib/custody-timeline`, `./lib/custody-feasibility` in one edit.)

- [ ] **Step 2: Failing service tests** — `services/custody.test.ts` with hand-rolled deps (in-memory repos + `runInTransaction: (fn) => fn(bundle)` where `bundle` includes the in-memory repos, `vehicleTimelineLock: { lockVehicleTimeline: async () => () => {} }`, and `vehicleCustody` = the in-memory vehicle repo). Cases (write all — mutation-resistant, assert exact fields):
  - `receiveVehicle` happy path: given an in-flight RENTAL leg to `LOC_B`, receiving at `LOC_B` → leg `receivedAt` set; ARRIVAL receipt row with actor/at/idempotencyKey/photo keys; vehicle `AT_STATION` at `(op, LOC_B)`; `heldOffline: true` (default wait-for-owner); custody period opened with both snapshots `0`, `openedByLegId` = leg id.
  - `autoRelistOnReceipt: true` → `heldOffline: false` after receipt.
  - recovery re-target: leg planned to `LOC_B`, received at `LOC_C` (active-cancelled booking) → leg `toLocationId` becomes `LOC_C`, vehicle at `LOC_C`.
  - receipt at HOME clears the promo pair.
  - no in-flight leg → `{ ok: false, status: 409, code: 'CUSTODY_CONFLICT' }`.
  - cross-tenant vehicle → 404; archived or cross-tenant location → 400 `INVALID_LOCATION`.
  - second receive → 409 (leg already received).
  - `startFerry` happy path: creates a FERRY leg already departed (from = current physical pair, to = destination, `plannedEndAt` = now + 24h), closes the open period, vehicle `IN_TRANSIT`.
  - `startFerry` while `IN_TRANSIT` → 409 `CUSTODY_CONFLICT`.
  - `setListing` toggles `heldOffline` / `autoRelistOnReceipt`; `setPromoHome` writes the pair, rejects a past `cutoffAt` (400), `clearPromoHome` nulls both.

Run: FAIL — module not found.

- [ ] **Step 3: Implement `CustodyService`.** Shape (deps object — >4 collaborators):

```ts
// packages/api/src/services/custody.ts
import { receiveCustody } from '@kuruma/shared/lib/custody-state'
import type { ErrorCode } from '@kuruma/shared/lib/error-codes'
import {
  HANDOFF_RECEIPTS_IDEMPOTENCY_UNIQUE,
  PG_ERROR,
  pgConstraintName,
  pgErrorCode,
} from '../pg-errors'
import type { RunInTransaction } from '../repositories/types-transactions'
import type { HandoffReceiptRepository, MovementLegRepository, CustodyPeriodRepository } from '../repositories/types-custody'
import type { ReceiptStorage } from '../repositories/types-storage'
import { resolveOperatorIdForWrite } from '../tenancy'
// ... CallerContext, Vehicle, stores types

/** §8 B1: a ferry's arrival time is unknowable at start; the projection only
 *  needs to move the car off its origin in future searches, so a nominal
 *  same-day horizon is enough. The receipt supplies the actual. */
const FERRY_PROJECTION_HOURS = 24

export interface CustodyServiceDeps {
  runInTransaction: RunInTransaction
  receiptStorage: ReceiptStorage
  // Standalone reads for GET surfaces (outside any tx):
  movementLegRepo: Pick<MovementLegRepository, 'findInFlightByVehicle'>
  handoffReceiptRepo: Pick<HandoffReceiptRepository, 'findByVehicle' | 'findById'>
  custodyPeriodRepo: Pick<CustodyPeriodRepository, 'findByVehicle'>
  vehicleRepo: /* same findById shape booking-creation uses at :274 */
}
```

Method logic, in order (all writes go through `this.deps.runInTransaction`, first statement inside the tx is `await repos.vehicleTimelineLock.lockVehicleTimeline(vehicleId)`):
  - `receiveVehicle(ctx, vehicleId, input, photos: File[])`: resolve operator (`resolveOperatorIdForWrite`), upload photos BEFORE the tx (R2 is not transactional; orphaned keys on a failed tx are accepted — note it in a comment), then in-tx: load vehicle (404 on miss/cross-tenant) → `findInFlightByVehicle` (409 `CUSTODY_CONFLICT` when none) → location must exist, belong to the operator, and be ACTIVE (400 `INVALID_LOCATION`) → `markReceived` (undefined → 409 already-received) → `handoffReceiptRepo.create({ legId, phase: 'ARRIVAL', ... })`, catching the named idempotency 23505 and returning the existing receipt from `findByLeg` (idempotent replay) → `receiveCustody(vehicle, operatorId, input.locationId)` → `repos.vehicleCustody.updateCustody(vehicleId, { ...transition.next, heldOffline: !vehicle.autoRelistOnReceipt, ...(input.locationId === vehicle.pickupLocationId ? { homewardPromoPercent: null, homewardPromoCutoffAt: null } : {}) })` → `custodyPeriodRepo.open({ ..., dailyRateJpySnapshot: 0, handoffFeeJpySnapshot: 0, openedByLegId: legId })` (Slice 1: hostIsOwner ⇒ rate 0, §10).
  - `startFerry(ctx, vehicleId, input)`: in-tx: vehicle AT_STATION or 409 → destination owner-active or 400 → `movementLegRepo.create({ kind: 'FERRY', bookingId: null, from: physical pair, to: destination, plannedStartAt: now, plannedEndAt: +24h, departedAt: now, idempotencyKey: input.idempotencyKey })` (catch idempotency dup → 409) → `departVehicleInTx(repos, vehicle, leg.id, now)`.
  - `setListing` / `setPromoHome` / `clearPromoHome`: tenant-check then `updateCustody` (no tx needed — single write). `setPromoHome` validates `cutoffAt > now` (400).
  - `listReceipts(ctx, vehicleId)` (operator read, tenant-bound) and `getReceiptPhoto(ctx, receiptId, index)` → receipt (tenant-bound via its vehicle) → `receiptStorage.getFile(receipt.photoStorageKeys[index])` (404 on either miss).
  Results follow the repo-wide `{ ok: true, ... } | { ok: false; error; status; code? }` union; `'CUSTODY_CONFLICT' satisfies ErrorCode` at the emit sites.

- [ ] **Step 4: Error code.** Add `'CUSTODY_CONFLICT'` to `ERROR_CODES` (with a `// one-way custody §5` comment) + the sorted membership list in `error-codes.test.ts`.

- [ ] **Step 5: Run to PASS + commit**

```bash
bun run --filter @kuruma/shared test -- error-codes && bun run --filter @kuruma/api test -- services/custody && bunx tsc -p packages/api --noEmit
git add packages/api packages/shared
git commit -m "feat(custody): CustodyService — receipt gate, ferry, listing, promo-home"
```

---

## Phase 5 — Booking + search integration

### Task 14: Booking lifecycle hooks (depart / void / recovery)

**Files:**
- Modify: `packages/api/src/services/booking-lifecycle.ts` (`updateStatus` :408, renter `cancel` :495; ctor)
- Modify: composition root (thread `runInTransaction` + `isCustodyEnabled` into `BookingLifecycleService`)
- Test: extend `packages/api/src/services/booking-lifecycle.test.ts` (or the suite `tsc`/grep finds for this service)

- [ ] **Step 1: Failing tests.** Seed an in-memory world where a CONFIRMED booking has a RENTAL leg (create the leg directly via `InMemoryMovementLegRepository` with the booking's id) and the vehicle is AT_STATION with an open custody period. Cases:
  - flag ON, `updateStatus(→ ACTIVE)`: leg `departedAt` set; vehicle `IN_TRANSIT` (both physical ids null); the open custody period is closed with `closedByLegId` = leg id, `settlementState 'CLOSED'`.
  - flag ON, `updateStatus(CONFIRMED → CANCELLED)` (operator pre-start cancel): leg `voidedAt` set; vehicle custody untouched; period still open.
  - flag ON, `updateStatus(ACTIVE → CANCELLED)` (operator active cancel, #679): leg NOT voided, still in flight (`findInFlightByVehicle` returns it); vehicle stays `IN_TRANSIT` — the recovery leg waits for a receipt (§5).
  - flag ON, renter `cancel()` (CONFIRMED-only): leg voided.
  - flag ON, booking with NO leg (created while dark): every transition succeeds unchanged — hooks no-op.
  - flag OFF: repos untouched (spy: leg repo empty, vehicle custody unchanged).

Run → FAIL (service has no custody deps).

- [ ] **Step 2: Implement.** `BookingLifecycleService` ctor gains `runInTransaction: RunInTransaction` and `isCustodyEnabled: () => Promise<boolean>` (append; update all construction sites — grep `new BookingLifecycleService`). In `updateStatus`, after the transition-guard block (:424-431) and the existing status write + refund logic, replace the plain status write with a flag-forked path:

```ts
    const custodyOn = await this.isCustodyEnabled()
    if (!custodyOn) {
      // dark path — existing single-statement compare-and-set, unchanged
      const updated = await this.bookingRepo.updateStatus(ctx, bookingId, { from: booking.status, to: newStatus })
      ...
    } else {
      // §2.1: status flips that move the car mutate the timeline — same tx, same lock.
      const updated = await this.runInTransaction(async (repos) => {
        if (booking.assignedVehicleId) {
          await repos.vehicleTimelineLock.lockVehicleTimeline(booking.assignedVehicleId)
        }
        const row = await repos.bookingRepo.updateStatus(ctx, bookingId, { from: booking.status, to: newStatus })
        if (!row) return undefined
        if (booking.assignedVehicleId) {
          const leg = await repos.movementLegRepo.findByBookingId(bookingId)
          const vehicle = await repos.vehicleRepo.findById(/* same shape as booking-creation.ts:274 */)
          if (leg && vehicle) {
            if (newStatus === 'ACTIVE') await departVehicleInTx(repos, vehicle, leg.id, new Date())
            if (newStatus === 'CANCELLED' && booking.status === 'CONFIRMED') {
              await voidBookingLegInTx(repos, bookingId, new Date())
            }
            // ACTIVE→CANCELLED: deliberately nothing — the in-flight leg IS the
            // recovery leg; only a receipt returns the car to AT_STATION (§5).
          }
        }
        return row
      })
      ...same post-write notification/refund flow on `updated`...
    }
```

Renter `cancel()` (:495): same fork — flag ON wraps its status write in `runInTransaction` with the lock + `voidBookingLegInTx` (renter cancel is CONFIRMED-only, so it is always a pre-start void). Keep both forks minimal — the fee/refund/notification logic stays exactly where it is; only the status-write statement moves inside the tx.

- [ ] **Step 3: Run to PASS; full api suite; commit**

```bash
bun run --filter @kuruma/api test -- booking-lifecycle && bun run --filter @kuruma/api test && bunx tsc -p packages/api --noEmit
git add packages/api
git commit -m "feat(custody): lifecycle depart/void/recovery hooks under the timeline lock"
```

### Task 15: Booking-create — shared predicate, leg insert, promo pricing

**Files:**
- Modify: `packages/shared/src/lib/error-codes.ts` (+ test): add `'PICKUP_NOT_AT_LOCATION'`, `'ONEWAY_NOT_TAIL'`, `'DROPOFF_NOT_HOMEWARD'`, `'WINDOW_OVERLAPS_MOVEMENT'`
- Modify: `packages/api/src/services/booking-creation.ts`
- Test: extend `packages/api/src/services/booking-creation` unit suite + `packages/api/tests/integration/bookings.test.ts`

- [ ] **Step 1: Failing tests.** Unit (in-memory createApp or service-level, whichever the existing suite uses), all with flag ON unless stated:
  - one-way SPECIFIC A→B (both owner-active, car at A, no pending legs) → 201; a `movement_legs` row exists with `kind 'RENTAL'`, `bookingId`, from A to B, planned window `[startAt, effectiveEndAt]`, `idempotencyKey` = `booking:<id>`.
  - round trip → 201 with a leg (planned A→A).
  - pickup where the car is NOT (car physically at B, request pickup A) → 400, `code 'PICKUP_NOT_AT_LOCATION'`.
  - pickup at the car's CURRENT foreign... (same-op non-home branch): car physically at branch B (displaced) → booking B→A homeward → 201. **This is the slice's headline behavior.**
  - dropoff at an ARCHIVED owner location → 400 `'DROPOFF_NOT_HOMEWARD'` (today's path allowed it — flag-ON tightening).
  - window overlapping a scheduled FERRY leg → 409 `'WINDOW_OVERLAPS_MOVEMENT'`.
  - one-way before an existing future booking (leg) → 400 `'ONEWAY_NOT_TAIL'`.
  - flag OFF: leg table stays empty; the old `:331` pickup-equality + same-operator dropoff behavior byte-identical (re-run an existing one-way test unchanged).
  - promo: vehicle displaced at B with `homewardPromoPercent: 20`, cutoff future; booking B→home → `totalPrice` uses `floor(base * 0.8)` + insurance/add-ons unchanged; same booking after cutoff → full price; B→(other active branch) → full price (promo only lands-home trips).

Run → FAIL.

- [ ] **Step 2: Error codes** — add the four (one `// one-way custody §2/§7` comment block) + membership list.

- [ ] **Step 3: Implement in `booking-creation.ts`** (SPECIFIC path; CLASS_COMBO is untouched — the validator already forces round-trip and Task 16 keeps displaced cars out of the pool):
  1. Ctor gains `isCustodyEnabled: () => Promise<boolean>` (wire like `isOperatorTermsEnabled`, `:136` precedent). Resolve once per `create()` before the tx and pass down (`custodyOn`).
  2. Inside `submitSpecificInTxLocked` (:378), immediately after the existing combo-capacity lock acquisition (:354-375 — combo lock FIRST, then vehicle lock; keep this order, it is the documented deadlock rule): `if (custodyOn) await repos.vehicleTimelineLock.lockVehicleTimeline(assignedVehicleId)`.
  3. Replace the pickup gate: keep `:331`'s `vehicle.pickupLocationId !== input.pickupLocationId` check for `!custodyOn`; for `custodyOn` run instead:

```ts
        const pendingLegs = await repos.movementLegRepo.findPendingByVehicle(vehicle.id)
        const ownerLocations = await repos.locationRepo.findByOperator(SYSTEM_CONTEXT, vehicle.operatorId)
        const operator = await repos.operatorRepo.findById(vehicle.operatorId)
        const feasibility = assessOneWayFeasibility({
          currentLocationId: vehicle.physicalLocationId,
          pendingLegs,
          pickupLocationId: input.pickupLocationId,
          dropoffLocationId: input.dropoffLocationId,
          startAt: input.startAt,
          effectiveEndAt,
          homewardDropoffIds: homewardDropoffIds({
            ownerOperatorId: vehicle.operatorId,
            ownerDeactivatedAt: operator?.deactivatedAt ?? new Date(0),
            locations: ownerLocations,
          }),
          policy: DEFAULT_ONE_WAY_POLICY,
        })
        if (!feasibility.ok) {
          const status = feasibility.reason === 'WINDOW_OVERLAPS_MOVEMENT' ? 409 : 400
          return { ok: false, status, error: custodyReasonMessage(feasibility.reason), code: feasibility.reason satisfies ErrorCode }
        }
```

  (`custodyReasonMessage` = a small exhaustive `Record<OneWayCustodyReason, string>` in the same file. If `locationRepo` has no by-operator finder in the tx bundle, use its existing `findAll`-shaped method with the operator filter — check `repositories/types.ts` `LocationRepository` for the real name and call that; the effectiveEndAt in scope is the one `resolveDropoffEffectiveEnd` (:226-246) computed — that helper's same-operator + turnaround behavior stays as-is.)
  4. Promo (SPECIFIC pricing, after `calculateBookingPrice` :446-450):

```ts
        // §8 B2: promo applies only to a trip that LANDS the car home, before cutoff.
        const promoActive =
          custodyOn &&
          vehicle.homewardPromoPercent !== null &&
          vehicle.homewardPromoCutoffAt !== null &&
          vehicle.homewardPromoCutoffAt.getTime() > Date.now() &&
          input.dropoffLocationId === vehicle.pickupLocationId &&
          input.dropoffLocationId !== input.pickupLocationId
        const basePrice = promoActive
          ? Math.floor(rawBasePrice * (100 - (vehicle.homewardPromoPercent ?? 0)) / 100)
          : rawBasePrice
```

  5. Leg insert — in `submitSpecificInTxLocked` right after the booking row insert succeeds (the `snapshotAndInsert` return gives the booking):

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
            idempotencyKey: `booking:${booking.id}`,
          })
        }
```

  (Same tx ⇒ a failed leg insert rolls the booking back; the `booking:<id>` key + the `bookingId` unique make retries inert.)

- [ ] **Step 4: Integration tests** — extend `tests/integration/bookings.test.ts` (real pg): flag ON via a `feature_flags` DB override row (insert `{ key: 'ONE_WAY_CUSTODY', enabled: true }` through the repo/table in `beforeAll`, delete in `afterAll`): the displaced-homeward 201 case + the leg row assert; the existing `#882 same-operator one-way guardrail` test (`:633`) must still pass (cross-operator dropoff → still 400 — `resolveDropoffEffectiveEnd` fires first).

Run: unit + `DATABASE_URL=... bunx vitest run tests/integration/bookings.test.ts --root packages/api` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api packages/shared
git commit -m "feat(custody): booking-create shared feasibility predicate + leg insert + promo (flag-gated)"
```

### Task 16: Search surfaces — custody conditions + continuity post-filter

**Files:**
- Modify: `packages/api/src/repositories/drizzle/availability.ts` + `in-memory/availability.ts`
- Test: the availability repo suites (in-memory unit + `tests/integration` availability specs)

- [ ] **Step 1: Failing tests** (in-memory unit — mirrors carry the exact same semantics as SQL):
  - a vehicle `IN_TRANSIT` never appears (`findAvailableVehicles`), any filter shape.
  - `heldOffline: true` never appears.
  - custody-untracked (`custodyState: null`) still appears in the unfiltered listing (flag-off equivalence pin).
  - location filter matches on `physicalLocationId`: a car displaced at B appears for `locationId: B`, NOT for its home A.
  - continuity: a car AT_STATION at B with a pending leg B→A settling before the requested window does NOT match `locationId: B` for that window, and DOES match `locationId: A` (**the retained #882 symmetric case — the headline of §2**).
  - a pending FERRY leg overlapping the window excludes the car everywhere (R1 for non-bookings).
  - `checkVehicleAvailability`: same two additions (pending-leg overlap → unavailable; IN_TRANSIT/heldOffline → unavailable).
  - `countClassCapacity`: a displaced car (`physicalLocationId != pickupLocationId`), an IN_TRANSIT car, and a heldOffline car are all excluded from the combo pool (§11 CLASS_COMBO deferral).

Run → FAIL.

- [ ] **Step 2: Drizzle implementation.** In `findAvailableVehicles` (`drizzle/availability.ts`):
  - conditions (:49-73) gain:

```ts
      // One-way custody §5: IN_TRANSIT is never listable (Q3); NULL = untracked
      // legacy/unassigned stays listable (dark-flag equivalence). heldOffline
      // suppresses a received-but-not-relisted car.
      sql`(${vehicles.custodyState} IS NULL OR ${vehicles.custodyState}::text = 'AT_STATION')`,
      eq(vehicles.heldOffline, false),
      // R1 for non-booking movements: any pending leg touching the window.
      sql`NOT EXISTS (
            SELECT 1 FROM movement_legs ml
            WHERE ml."vehicleId" = ${vehicles.id}
            AND ml."receivedAt" IS NULL AND ml."voidedAt" IS NULL
            AND COALESCE(ml."departedAt", ml."plannedStartAt") < ${toIso}::timestamptz
            AND ${fromIso}::timestamptz < ml."plannedEndAt"
          )`,
```

  - the location filters (:78, :83-86) swap `vehicles.pickupLocationId` → `vehicles.physicalLocationId`.
  - continuity post-filter after the SQL returns candidates: one `IN` query for the candidates' pending legs, group by vehicle, keep a candidate iff `projectedLocationAt(v.physicalLocationId, legs, from)` equals the requested location (when `filters.locationId`/`locationIds` present) or equals `v.physicalLocationId` (no location filter — the car must still be somewhere stable; with no pending legs this is trivially true). Import the pure fns from `@kuruma/shared/lib/custody-timeline` — a repo importing shared lib is layer-legal.
  - `checkVehicleAvailability` (:97) and `countClassCapacity` (:205) get the custody + pending-leg conditions; `countClassCapacity` additionally gets `sql`${vehicles.physicalLocationId} = ${vehicles.pickupLocationId}`` (combo counts at-home inventory only).
  - In-memory mirror: same logic via `isCustodyListable` + `projectedLocationAt` + `pendingLegOverlaps` — the in-memory availability repo needs read access to the in-memory movement-leg store: give `InMemoryAvailabilityRepository` an optional constructor collaborator `movementLegs?: Pick<MovementLegRepository, 'findPendingByVehicle'>` (default: none → no legs), and pass the shared instance at both composition sites.

- [ ] **Step 3: PASS + full suite + integration availability specs + commit**

```bash
bun run --filter @kuruma/api test && DATABASE_URL="postgresql://kuruma:kuruma@localhost:5499/kuruma_custody" bunx vitest run tests/integration --root packages/api -t availability
git add packages/api
git commit -m "feat(custody): availability surfaces enforce custody + timeline continuity"
```

### Task 17: Location archival guard

**Files:**
- Modify: `packages/api/src/services/location.ts` (`archive` :209-240) + its ctor deps
- Modify: `packages/shared/src/lib/error-codes.ts` (+ test): add `'LOCATION_HAS_CUSTODY_ANCHORS'`
- Test: extend the location service suite

- [ ] **Step 1: Failing tests:** archiving a location that is (a) some vehicle's home base, (b) some vehicle's current `physicalLocationId`, or (c) a pending leg's endpoint → `{ ok: false, status: 409, code: 'LOCATION_HAS_CUSTODY_ANCHORS' }` with a count-bearing message; archiving an unreferenced location still works; the existing active-bookings 409 (:224-232) still fires first.

- [ ] **Step 2: Implement.** `LocationService` ctor gains `custodyReads: VehicleCustodyReads` (the vehicle repo instance) and `legReads: Pick<MovementLegRepository, 'countPendingTo'>`. In `archive`, after the active-bookings check:

```ts
    // §7 archival guard: a home base, a car's current physical location, or a
    // pending-leg endpoint cannot be archived out from under the fleet — it
    // would empty a displaced car's homewardDropoffSet mid-flight.
    const [homeBased, physical, pendingLegs] = await Promise.all([
      this.custodyReads.countHomeBasedAt(existing.operatorId, id),
      this.custodyReads.countPhysicallyAt(existing.operatorId, id),
      this.legReads.countPendingTo(existing.operatorId, id),
    ])
    if (homeBased + physical + pendingLegs > 0) {
      return {
        ok: false,
        status: 409,
        error: `Cannot archive: ${homeBased} home-based, ${physical} present, ${pendingLegs} inbound vehicles reference this location`,
        code: 'LOCATION_HAS_CUSTODY_ANCHORS' satisfies ErrorCode,
      }
    }
```

(Not flag-gated: while dark, `countHomeBasedAt` counts assigned vehicles — which today's archive path also had to care about; if an existing archive test now fails because its fixture home-bases a vehicle there, that test documented data-loss behavior — reassign the fixture's vehicle instead. Note this in the commit body. The route already forwards `code` via `failResult`.)

- [ ] **Step 3: PASS + commit**

```bash
bun run --filter @kuruma/api test -- services/location && bunx tsc -p packages/api --noEmit
git add packages/api packages/shared
git commit -m "feat(custody): location archival guard (409 on custody anchors)"
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

export const receiveVehicleSchema = z.object({
  locationId: z.string().uuid(),
  fuelPercent: z.coerce.number().int().min(0).max(100).optional(),
  odometerKm: z.coerce.number().int().min(0).optional(),
  damageReported: z.coerce.boolean().optional().default(false),
  conditionNotes: z.string().max(2000).optional(),
  idempotencyKey: z.string().uuid(),
})

export const startFerrySchema = z.object({
  toLocationId: z.string().uuid(),
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
```

(`receiveVehicleSchema` is parsed from multipart form fields — hence `z.coerce`.)

- [ ] **Step 2: Routes** — `packages/api/src/routes/custody.ts`, `createCustodyRoutes(service, photoUploadLimiter, photoUploadUserLimiter)`, following `vehicle-photos.ts`'s multipart idiom (`:43-61`: `requireUser` → `requireFleetWriteRole` → `parseId` → `rejectOversizedBody` → `parseBody`/`parseBody`-style form extraction → service → `ok`/`failResult`):
  - `POST /vehicles/:id/custody/receipt` — multipart: text fields per `receiveVehicleSchema` + repeated `file` photo parts (reuse the photo-size budget consts); 201 with the receipt + updated vehicle custody.
  - `POST /vehicles/:id/custody/ferry` — JSON `startFerrySchema`.
  - `PATCH /vehicles/:id/custody/listing` — JSON `custodyListingSchema`.
  - `PUT /vehicles/:id/custody/promo-home` — JSON `promoHomeSchema`; `DELETE` clears.
  - `GET /vehicles/:id/custody/receipts` — operator evidence list (management read; NOT public).
  - `GET /custody/receipts/:id/photos/:index` — streams via `ReceiptStorage.getFile` (mirror the renter-documents streaming route: correct `Content-Type`, `Cache-Control: private, no-store`).
  - `GET /vehicles/:id/homeward-dropoffs` — `requireAuth` only (renters call it from the wizard): returns `{ locations: [{ id, name }], promo: { percent, cutoffAt } | null }` — the service computes the list with `homewardDropoffIds` over the owner's locations (the ONE predicate) and returns the promo pair only when active AND the vehicle is displaced. 404 when the flag is off (mirror `routes/operator-terms.ts:67`).
  Route tests: happy paths + 401/403 + flag-off 404 for homeward-dropoffs + a receipt-photo cross-tenant 404 (IDOR pin), using `testAuthMiddleware`/`authHeaders` idioms.

- [ ] **Step 3: Builder + mounts.** `composition/custody-service.ts` exports `buildCustodyService(deps: CustodyServiceDeps): CustodyService` (mirror `composition/operator-application-service.ts`'s shape and doc-comment). In `index.ts`: import route factory + builder (2 lines), destructure the new repos, `const custodyService = buildCustodyService({ ... })` (one call), mount `.route('/', createCustodyRoutes(custodyService, photoUploadLimiter, photoUploadUserLimiter))` next to the vehicle-photos mount. Run `bun run lint:size` — if `index.ts` crosses 800, move the nearest low-risk resolver block into `composition/` (precedent: `4c1a1183`).

- [ ] **Step 4: Vehicle DTO.** The operator fleet UI needs the custody fields: extend the vehicle row DTO the fleet routes return (find the schema the web's `vehicleRowSchema` mirrors — `grep -rn "vehicleRowSchema" packages/web/src/vite/operator-fleet/api.ts` and the API-side serializer it parses) with `custodyState`, `physicalLocationId`, `heldOffline`, `autoRelistOnReceipt`, `homewardPromoPercent`, `homewardPromoCutoffAt`. Renter-facing DTOs are untouched.

- [ ] **Step 5: Verify + commit**

```bash
bun run --filter @kuruma/api test && bunx tsc -p packages/api --noEmit && bun run --filter @kuruma/api lint:boundaries && bun run lint:size && bun run lint
git add packages/api packages/shared
git commit -m "feat(custody): custody routes + composition wiring"
```

---

## Phase 6 — Web

### Task 19: Operator fleet custody UI

**Files:**
- Create: `packages/web/src/vite/operator-fleet/CustodyBadge.tsx`, `ReceiveVehicleDialog.tsx`, `FerryDialog.tsx`, `ListingDialog.tsx`, `PromoHomeDialog.tsx`
- Modify: `packages/web/src/vite/operator-fleet/api.ts` (schema fields + 5 mutations), `FleetRowActions.tsx`, `FleetTable.tsx`, `FleetVehicleCard.tsx`
- Modify: `packages/web/messages/{en,ja,zh}.json` (`business.vehicles.custody.*` namespace)
- Test: `packages/web/src/vite/operator-fleet/ReceiveVehicleDialog.test.tsx` + extend the FleetRowActions suite

All custody UI is gated on `useFeatureFlag('ONE_WAY_CUSTODY')` — flag off renders exactly today's menu (pin that with a test).

- [ ] **Step 1: Failing tests.** `ReceiveVehicleDialog.test.tsx`: renders location select from provided owner locations; submit posts multipart with `locationId` + condition fields + `idempotencyKey`; server 409 surfaces an inline `role="alert"` banner (combo-deals precedent); success invalidates `FLEET_QUERY_KEY` and closes. FleetRowActions: flag ON + `custodyState 'IN_TRANSIT'` shows "Receive vehicle"; `AT_STATION` shows "Send home (ferry)" / "Listing & holds" / "Promo home"; flag OFF shows none of them.

- [ ] **Step 2: API client** (`operator-fleet/api.ts`): extend `vehicleRowSchema` with the six custody fields (zod, nullable as in the DTO); add `receiveVehicle(vehicleId, form: FormData, csrfToken, pickedOperatorId)` (FormData POST mirroring the photo-upload client `:200-217`), `startFerry`, `updateCustodyListing`, `setPromoHome`, `clearPromoHome` (all `writeJson` PATCH/POST/PUT/DELETE with `X-CSRF-Token`, mirroring `updateVehicleStatus` :152-167).

- [ ] **Step 3: Components.**
  - `CustodyBadge` — small presentational: `IN_TRANSIT` → amber "In transit"; `AT_STATION` + `heldOffline` → gray "Held offline"; displaced (`physicalLocationId !== pickupLocationId`, both non-null) → blue "Away from home"; else nothing. Used in `FleetTable` row + `FleetVehicleCard`.
  - `ReceiveVehicleDialog` — form: location `<select>` (owner active locations — reuse the locations query the fleet module already has; check `operator-locations` module's barrel for `operatorLocationsQueryOptions` and import via `@/vite/operator-locations` barrel only, bumping `VITE_CROSS_FEATURE_REACH_IN_BASELINE` in `scripts/lint-module-boundaries.ts:122` if the deep-import rule fires), fuel %, odometer, damage checkbox, notes textarea, `<input type="file" multiple accept="image/*">`; one `useState(() => crypto.randomUUID())` idempotency key per mount (wizard precedent); labeled inputs (`<label htmlFor>`), error banner `role="alert"`, submit disabled while pending.
  - `FerryDialog` — destination select + confirm; `ListingDialog` — two switches (`heldOffline`, `autoRelistOnReceipt`); `PromoHomeDialog` — percent + cutoff datetime + clear button.
  - `FleetRowActions.tsx` — extend the `OpenDialog` union (`'receive' | 'ferry' | 'listing' | 'promo'`) and add flag-gated `DropdownMenuItem`s in the existing pattern (:106-115): "Receive" only when `IN_TRANSIT`; the other three only when `AT_STATION`; all only when `canWrite`.

- [ ] **Step 4: i18n** — add `business.vehicles.custody.*` keys (badge labels, menu items, dialog titles/fields/errors — ~30 keys) to ALL THREE locale files; run `bun run lint:i18n-parity`.

- [ ] **Step 5: Verify + commit**

```bash
bun run --filter @kuruma/web test -- operator-fleet && bunx tsc -p packages/web --noEmit && bun run lint:modules && bun run lint:i18n-parity
git add packages/web scripts/lint-module-boundaries.ts
git commit -m "feat(custody): operator fleet custody UI (receive, ferry, listing, promo)"
```

### Task 20: Renter dropoff picker + promo in the wizard

**Files:**
- Create: `packages/web/src/vite/reservation/homewardApi.ts`, `DropoffSelect.tsx`
- Modify: `packages/web/src/vite/reservation/ReservationWizard.tsx` (:107-115), `pricing.ts` (`estimateReservation` gains optional promo), `ConfirmStep`/summary display
- Modify: `packages/web/messages/{en,ja,zh}.json` (`reservation.dropoff.*`)
- Test: `packages/web/src/vite/reservation/DropoffSelect.test.tsx` + extend the wizard suite

- [ ] **Step 1: Failing tests:** flag OFF → no dropoff control, `bookingCommon.dropoffLocationId === locationId` (pin today's behavior); flag ON + SPECIFIC subject → select rendered from the homeward-dropoffs query, defaulting to the pickup location; choosing another location flows into the POST body; promo active + dropoff == home → estimate shows the discounted rental line + a promo badge; CLASS_COMBO subject → no control ever (validator forces round-trip).

- [ ] **Step 2: `homewardApi.ts`** — `fetchHomewardDropoffs(vehicleId)` GET `/vehicles/:id/homeward-dropoffs`, zod-parse `{ locations: [{ id, name }], promo: { percent, cutoffAt } | null }`, 404 → null (flag off); `homewardDropoffsQueryOptions(vehicleId)` with `enabled` left to the caller.

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

`bookingCommon.dropoffLocationId: effectiveDropoff` (:109). Render `<DropoffSelect>` (a labeled `<select>` + promo hint line when `homeward.promo` and the option is the home base) above the summary on the dates step. Promo estimate: pass `promoPercent` into `estimateReservation` only when `effectiveDropoff === homeward home` — the endpoint should therefore also return `homeBaseLocationId` so the client knows which option lands home; add that field to the API response + schema (server: `vehicle.pickupLocationId`). Apply it to the rental portion with the same `floor(base * (100-p)/100)` formula (mirror the server exactly — a mismatched estimate is a support ticket).

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

- [ ] **Step 1: Flag plumbing.** Add the env var to the real-db config's `VITE_FEATURE_ENV` (both web servers); the spec itself flips the SERVER flag by inserting the `feature_flags` override row via `testSql` in `beforeAll` (and deletes it in `afterAll`) — the server read is runtime, no restart needed.

- [ ] **Step 2: The spec** (template `locations.auth.spec.ts` / `operator-onboarding.auth.spec.ts`, `test.setTimeout(120_000)`, serial `test.step`s, DB asserts via `testSql`):
  1. Seed via SQL: second active location B for the seeded operator; note the seeded car's home A. Renter books the car one-way A→B (wizard: pick dropoff B) — assert booking created with `dropoffLocationId` B and one `movement_legs` row.
  2. Operator marks the booking ACTIVE (existing booking actions UI) — DB assert: leg `departedAt` set, vehicle `custodyState 'IN_TRANSIT'`.
  3. Operator opens the fleet row → "Receive vehicle" at B with a condition note + a fixture photo — DB assert: `handoff_receipts` ARRIVAL row, vehicle `AT_STATION` at B, ONE open `custody_periods` row with rate snapshots 0, `heldOffline: true`.
  4. Operator flips the listing hold off, sets promo-home 20% — car appears in a renter search at B (not at A: continuity), with promo visible in the wizard for dropoff A.
  5. Renter books B→A homeward at the discounted price — DB assert: second leg, `totalPrice` discounted.
  6. Restore: cancel/cleanup rows in `afterAll` (delete legs/periods/receipts/bookings created here; reset vehicle custody to home; drop location B) so the shared seed stays pristine for other specs.

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

### Task 22: Flag-flip backfill script

**Files:**
- Create: `scripts/backfill-movement-legs.ts`

Bookings created while the flag was OFF have no legs; at flip time the fold would be blind to them. The runbook: run this script against an environment's DB **immediately before** flipping `ONE_WAY_CUSTODY` there.

- [ ] **Step 1: Script** (print-only by default; `--apply` to execute — the safe-path lesson from the beta seed drift):

```ts
// scripts/backfill-movement-legs.ts
// One-way custody flip runbook: synthesize movement legs for CONFIRMED/ACTIVE
// bookings that predate the flag, so the feasibility fold sees them (§2.1).
// CONFIRMED → planned leg. ACTIVE → departed leg + vehicle IN_TRANSIT + close
// any open custody period (the car is physically out; its return receipt will
// land it). COMPLETED/CANCELLED bookings need no leg — their movement is
// already reflected in the materialized location.
// Usage: DATABASE_URL=... bun run scripts/backfill-movement-legs.ts [--apply]
```

Logic (drizzle over `getDb()` or a `postgres()` client): select CONFIRMED/ACTIVE bookings with `assignedVehicleId IS NOT NULL` and no `movement_legs` row (`LEFT JOIN ... IS NULL`); for each, build the leg (`kind 'RENTAL'`, from/to = booking pickup/dropoff with the booking's `operatorId`, planned window `[startAt, effectiveEndAt]`, `idempotencyKey: 'backfill:' + bookingId`, `departedAt: startAt` when ACTIVE); for ACTIVE ones also `UPDATE vehicles SET custodyState='IN_TRANSIT', physical* = NULL` for the assigned vehicle. Print the full statement set; execute only under `--apply`. Idempotent by the `bookingId` unique + `custodyState` guard.

- [ ] **Step 2: Dry-run against the local DB** (`DATABASE_URL=... bun run scripts/backfill-movement-legs.ts` → prints, exits 0), then `--apply` on the local DB with a seeded ACTIVE booking and assert the leg + IN_TRANSIT flip via psql.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-movement-legs.ts
git commit -m "chore(custody): flag-flip movement-leg backfill script (print-only default)"
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

- [ ] **Step 2: Sabotage check (one, load-bearing):** temporarily invert the homeward check in `assessOneWayFeasibility` (`has` → `!has`) → the Task 15 dropoff tests and the e2e must fail; revert. Proves the predicate is actually wired into checkout, not just unit-tested.

- [ ] **Step 3: Docs + teardown.** Add a CLAUDE.md gotcha entry only if something surprising was hit (per the standing rule). `docker rm -f kuruma-custody-pg`. Then use **superpowers:finishing-a-development-branch**: rebase onto `origin/develop` (regenerate the two migrations if numbers collided — drop + `db:generate`, never hand-rename), PR base `develop`, plain-English title "One-way rentals: cars can be dropped at another branch and rented home", body `Refs #882` + link to the spec, squash-merge, NO force-push (`gh pr update-branch` if behind).

---

## Self-review notes (spec-coverage check, done at plan time)

| Spec section | Task(s) |
|---|---|
| §2/§2.1 fold + one stream + one lock | 3, 9, 15, 16 |
| §4 explicit state + composite FK + CHECK | 2, 5, 6 |
| §5 transitions incl. both cancel paths + auto-relist setting | 2, 13, 14 |
| §6.1 movement_legs + seals | 5, 7, 8 |
| §6.2 receipts + all five seals + private storage | 5, 8, 11, 13 |
| §7 homeward set + archival guard | 3, 15, 17 |
| §8 ferry B1 / promo B2 / home re-label | 13, 12, 15, 19, 20 |
| §10 custody periods at rate 0, close-on-departure, one-open seal | 5, 8, 13, 14 |
| §11 search surfaces + CLASS_COMBO displaced exclusion + booking DTO | 16, 18 |
| §12 slice boundaries (no cost fold, no cross-op money) | honored — no accrual math, no settlement table, snapshots 0 |
| §13 open questions | untouched (Slice 2): settlement cadence/rounding, host fee, liability, host-receipt capability |
| §14 Q1–Q4 | Q1: Task 3/15 leash · Q2: owner pricing untouched · Q3: Task 16 IN_TRANSIT off + receipt gate · Q4: n/a until Slice 2 |

Known deliberate gaps (Slice 2+, per spec §12/§15): cross-operator hosting/opt-in, non-zero fees, settlement records, DEPARTURE-receipt UI, CLASS_COMBO for displaced cars, free-roam. Deviations from spec letter are the 12 plan-level decisions up top.

