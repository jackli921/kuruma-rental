# Vehicle-Blocks Read Endpoint (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fleet-wide, operator-scoped `GET /vehicle-blocks?from&to` read endpoint so the operator calendar can fetch blocks for a window. (Slice A of #1101; Slice B — the web UI — is a separate plan written after this merges.)

**Architecture:** Mirror the existing read-scope convention exactly: the repository takes `CallerContext` and resolves a `VehicleBlockReadScope` union internally (as `in-memory/vehicle-class.ts` does with `operatorReadScope`). A new `vehicleBlockReadScope(ctx)` resolver in `tenancy.ts` is **total and fail-closed** — `MANAGEMENT_READ_ROLES` admits legacy `STAFF`/`ADMIN` who are neither bypass nor operator, and they must read nothing rather than fall through to `all`. The route gates `MANAGEMENT_READ_ROLES` (RENTER/PARTNER → 403) and requires the date range.

**Tech Stack:** Hono, Drizzle (Postgres `tstzrange && tstzrange` GiST), Vitest, Bun, neon-http.

**Spec:** `docs/plans/2026-06-26-vehicle-blocks-calendar-design.md`. (Note: that spec sketched `findOverlappingInRange(scope, …)`; this plan uses `(ctx, …)` resolving scope internally, matching the `vehicle-class` repo convention discovered during planning.)

**Branch:** `feat/1101-blocks-calendar-ui` (worktree `~/Dev/kuruma-1101-blocks-ui`, off develop). **No migration.**

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/api/src/tenancy.ts` | `VehicleBlockReadScope` type + `vehicleBlockReadScope(ctx)` resolver | Modify |
| `packages/api/src/tenancy.test.ts` | Resolver unit tests | Modify |
| `packages/api/src/repositories/types-vehicle-block.ts` | Add `findOverlappingInRange(ctx, from, to)` to interface | Modify |
| `packages/api/src/repositories/in-memory/vehicle-block.ts` | In-memory impl | Modify |
| `packages/api/src/repositories/in-memory/vehicle-block.test.ts` | In-memory scope tests | Modify |
| `packages/api/src/repositories/drizzle/vehicle-block.ts` | Drizzle impl | Modify |
| `packages/api/src/services/vehicle-block.ts` | `listBlocks(ctx, from, to)` | Modify |
| `packages/api/src/services/vehicle-block.test.ts` | Service scope tests | Modify |
| `packages/api/src/routes/vehicle-blocks.ts` | `GET /vehicle-blocks` + auth for the new path | Modify |
| `packages/api/tests/routes/vehicle-blocks.test.ts` | Route tests (200/403/400) | Modify |
| `packages/api/tests/integration/vehicle-blocks.test.ts` | real-pg range + cross-operator | Modify |

No `index.ts` change: the `GET` lives inside the already-mounted `createVehicleBlockRoutes` factory.

---

## Task 1: `vehicleBlockReadScope` resolver

**Files:**
- Modify: `packages/api/src/tenancy.ts` (add after `operatorReadScope`, ~line 39)
- Test: `packages/api/src/tenancy.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/api/src/tenancy.test.ts` (it already imports `describe, expect, it`, `CallerContext`, and from `./tenancy`):

```typescript
import { vehicleBlockReadScope } from './tenancy'

describe('vehicleBlockReadScope', () => {
  it('returns all for a bypass caller (PLATFORM_ADMIN)', () => {
    const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
    expect(vehicleBlockReadScope(admin)).toEqual({ kind: 'all' })
  })

  it('returns operator for an OPERATOR_* caller with operatorId', () => {
    const op: CallerContext = { userId: 'u1', role: 'OPERATOR_OWNER', operatorId: 'op-1' }
    expect(vehicleBlockReadScope(op)).toEqual({ kind: 'operator', operatorId: 'op-1' })
  })

  it('returns none for an OPERATOR_* caller missing operatorId (fail-closed)', () => {
    const op: CallerContext = { userId: 'u1', role: 'OPERATOR_STAFF' }
    expect(vehicleBlockReadScope(op)).toEqual({ kind: 'none' })
  })

  it('returns none for an in-gate non-bypass non-operator (legacy STAFF/ADMIN)', () => {
    // STAFF/ADMIN pass MANAGEMENT_READ_ROLES but #487 removed them from
    // SCOPE_BYPASS_ROLES — they must read nothing, not fall through to `all`.
    const staff: CallerContext = { userId: 's1', role: 'STAFF', bypassScope: false }
    const admin: CallerContext = { userId: 'a1', role: 'ADMIN', bypassScope: false }
    expect(vehicleBlockReadScope(staff)).toEqual({ kind: 'none' })
    expect(vehicleBlockReadScope(admin)).toEqual({ kind: 'none' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @kuruma/api test -- tenancy.test.ts`
Expected: FAIL — `vehicleBlockReadScope is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/api/src/tenancy.ts`, immediately after `operatorReadScope` (line 39), add:

```typescript
/**
 * #1101: row-scope for the fleet-wide blocks read. Blocks are operator-internal
 * management data, so the route gates MANAGEMENT_READ_ROLES (RENTER/PARTNER → 403
 * before this runs). This resolver must be TOTAL over the gate's admitted set and
 * fail closed: MANAGEMENT_READ_ROLES (= BUSINESS_ROLES) also admits legacy
 * STAFF/ADMIN, and #487 removed them from SCOPE_BYPASS_ROLES, so they are neither
 * bypass nor isOperatorRole — they must read nothing. Do NOT copy
 * `operatorReadScope` (`!isOperatorRole → all`): that catalog pattern would leak
 * cross-tenant blocks to a legacy admin.
 */
export type VehicleBlockReadScope =
  | { kind: 'all' }
  | { kind: 'operator'; operatorId: string }
  | { kind: 'none' }

export function vehicleBlockReadScope(ctx: CallerContext): VehicleBlockReadScope {
  if (ctx.bypassScope) return { kind: 'all' }
  if (isOperatorRole(ctx.role)) {
    return ctx.operatorId ? { kind: 'operator', operatorId: ctx.operatorId } : { kind: 'none' }
  }
  return { kind: 'none' } // in-gate but neither bypass nor tenant: read nothing
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @kuruma/api test -- tenancy.test.ts`
Expected: PASS (all 4 new `vehicleBlockReadScope` cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/tenancy.ts packages/api/src/tenancy.test.ts
git commit -m "feat(#1101): add fail-closed vehicleBlockReadScope resolver"
```

---

## Task 2: `findOverlappingInRange` — interface + in-memory

**Files:**
- Modify: `packages/api/src/repositories/types-vehicle-block.ts`
- Modify: `packages/api/src/repositories/in-memory/vehicle-block.ts`
- Test: `packages/api/src/repositories/in-memory/vehicle-block.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the top-level `describe('InMemoryVehicleBlockRepository', …)` in `vehicle-block.test.ts`. It already has `OP='op_a'`, `VEH='veh_1'`, `T0`, `hours`, `seed`, `repo`. Add a context helper import + a new describe:

```typescript
import type { CallerContext } from '../../middleware/auth'

const adminCtx: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const opACtx: CallerContext = { userId: 'u_a', role: 'OPERATOR_OWNER', operatorId: 'op_a' }
const opBCtx: CallerContext = { userId: 'u_b', role: 'OPERATOR_OWNER', operatorId: 'op_b' }

describe('findOverlappingInRange', () => {
  it('operator scope returns only the caller-tenant blocks overlapping the window', async () => {
    const mine = await seed({ operatorId: 'op_a', startAt: hours(10), endAt: hours(20) })
    await seed({ operatorId: 'op_b', vehicleId: 'veh_b', startAt: hours(10), endAt: hours(20) })
    const hits = await repo.findOverlappingInRange(opACtx, hours(12), hours(18))
    expect(hits).toEqual([mine])
  })

  it('all scope (admin) returns blocks across operators in the window', async () => {
    const a = await seed({ operatorId: 'op_a', startAt: hours(10), endAt: hours(20) })
    const b = await seed({ operatorId: 'op_b', vehicleId: 'veh_b', startAt: hours(10), endAt: hours(20) })
    const hits = await repo.findOverlappingInRange(adminCtx, hours(0), hours(48))
    expect(new Set(hits)).toEqual(new Set([a, b]))
  })

  it('none scope (operator missing operatorId) returns []', async () => {
    await seed({ startAt: hours(10), endAt: hours(20) })
    const noneCtx: CallerContext = { userId: 'u', role: 'OPERATOR_STAFF' }
    expect(await repo.findOverlappingInRange(noneCtx, hours(0), hours(48))).toEqual([])
  })

  it('excludes a block outside the window (half-open, adjacent = no overlap)', async () => {
    await seed({ operatorId: 'op_b', startAt: hours(0), endAt: hours(10) })
    // window starts exactly where the block ends
    expect(await repo.findOverlappingInRange(opBCtx, hours(10), hours(20))).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @kuruma/api test -- in-memory/vehicle-block.test.ts`
Expected: FAIL — `repo.findOverlappingInRange is not a function`.

- [ ] **Step 3a: Add to the interface**

In `packages/api/src/repositories/types-vehicle-block.ts`, add the `CallerContext` import and the method (after `findOverlapping`, line 20):

```typescript
import type { CallerContext } from '../middleware/auth'
import type { VehicleBlock } from '../stores'
```

```typescript
  /** Fleet-wide blocks whose [startAt, endAt) overlaps [from, to), row-scoped by
   *  `vehicleBlockReadScope(ctx)` — `all` (admin) spans operators, `operator`
   *  filters to the tenant, `none` returns []. Powers the operator calendar read. */
  findOverlappingInRange(ctx: CallerContext, from: Date, to: Date): Promise<VehicleBlock[]>
```

- [ ] **Step 3b: Implement in-memory**

In `packages/api/src/repositories/in-memory/vehicle-block.ts`, add imports + method:

```typescript
import type { CallerContext } from '../../middleware/auth'
import { vehicleBlockReadScope } from '../../tenancy'
```

Add inside the class (after `findOverlapping`, line 52):

```typescript
  async findOverlappingInRange(
    ctx: CallerContext,
    from: Date,
    to: Date,
  ): Promise<VehicleBlock[]> {
    const scope = vehicleBlockReadScope(ctx)
    if (scope.kind === 'none') return []
    return [...this.store.values()].filter(
      (b) =>
        b.startAt < to &&
        b.endAt > from &&
        (scope.kind === 'operator' ? b.operatorId === scope.operatorId : true),
    )
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @kuruma/api test -- in-memory/vehicle-block.test.ts`
Expected: PASS (4 new `findOverlappingInRange` cases green; existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/repositories/types-vehicle-block.ts \
  packages/api/src/repositories/in-memory/vehicle-block.ts \
  packages/api/src/repositories/in-memory/vehicle-block.test.ts
git commit -m "feat(#1101): findOverlappingInRange (interface + in-memory, scope-aware)"
```

---

## Task 3: `findOverlappingInRange` — Drizzle (real-pg)

**Files:**
- Modify: `packages/api/src/repositories/drizzle/vehicle-block.ts`
- Test: `packages/api/tests/integration/vehicle-blocks.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/api/tests/integration/vehicle-blocks.test.ts` (uses `DrizzleVehicleBlockRepository(db)`, `SYSTEM_CONTEXT`, and the existing seed helpers `seedLocation`/`seedVehicleClass`/`vehicleRepo.create`). Seed two operators' vehicles, one block each, and assert scope:

```typescript
it('findOverlappingInRange: operator scope returns only the tenant blocks in the window', async () => {
  // (Reuse the file's existing two-operator seed helpers; create one block per op.)
  const opACtx: CallerContext = { userId: 'u_a', role: 'OPERATOR_OWNER', operatorId: opA.id }
  const from = new Date('2026-07-01T00:00:00Z')
  const to = new Date('2026-07-02T00:00:00Z')

  const mine = await blockRepo.create({
    operatorId: opA.id, vehicleId: vehicleA.id,
    startAt: new Date('2026-07-01T09:00:00Z'), endAt: new Date('2026-07-01T17:00:00Z'),
    kind: 'MAINTENANCE', reason: 'shaken', notes: null, createdBy: 'u_a',
  })
  await blockRepo.create({
    operatorId: opB.id, vehicleId: vehicleB.id,
    startAt: new Date('2026-07-01T09:00:00Z'), endAt: new Date('2026-07-01T17:00:00Z'),
    kind: 'MAINTENANCE', reason: 'shaken', notes: null, createdBy: 'u_b',
  })

  const operatorHits = await blockRepo.findOverlappingInRange(opACtx, from, to)
  expect(operatorHits.map((b) => b.id)).toEqual([mine.id])

  const adminHits = await blockRepo.findOverlappingInRange(SYSTEM_CONTEXT, from, to)
  expect(adminHits.length).toBe(2) // all scope spans both operators
})
```

> If the file doesn't already expose `opA/opB/vehicleA/vehicleB/blockRepo`, add them mirroring the existing setup in that file (it already constructs `DrizzleVehicleBlockRepository(db)` and seeds vehicles). Import `CallerContext` from `../../src/middleware/auth`.

- [ ] **Step 2: Run test to verify it fails**

Run (real pg must be up — the file's `./setup` handles the test DB):
`bun run --filter @kuruma/api test -- integration/vehicle-blocks.test.ts`
Expected: FAIL — `blockRepo.findOverlappingInRange is not a function`.

- [ ] **Step 3: Implement Drizzle**

In `packages/api/src/repositories/drizzle/vehicle-block.ts`, extend imports and add the method (after `findOverlapping`, line 52). Mirror the `vehicle-class.ts` scope-branching idiom (`operator → eq`, `none → sql\`false\``):

```typescript
import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { CallerContext } from '../../middleware/auth'
import { vehicleBlockReadScope } from '../../tenancy'
```

```typescript
  async findOverlappingInRange(
    ctx: CallerContext,
    from: Date,
    to: Date,
  ): Promise<VehicleBlock[]> {
    const scope = vehicleBlockReadScope(ctx)
    const conditions: SQL[] = [
      sql`tstzrange("startAt", "endAt") && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)`,
    ]
    if (scope.kind === 'operator') {
      conditions.push(eq(vehicleBlocks.operatorId, scope.operatorId))
    } else if (scope.kind === 'none') {
      conditions.push(sql`false`)
    }
    const rows = await this.db
      .select(vehicleBlockColumns)
      .from(vehicleBlocks)
      .where(and(...conditions))
    return rows.map(toVehicleBlock)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @kuruma/api test -- integration/vehicle-blocks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/repositories/drizzle/vehicle-block.ts \
  packages/api/tests/integration/vehicle-blocks.test.ts
git commit -m "feat(#1101): findOverlappingInRange Drizzle impl + real-pg scope test"
```

---

## Task 4: `VehicleBlockService.listBlocks`

**Files:**
- Modify: `packages/api/src/services/vehicle-block.ts`
- Test: `packages/api/src/services/vehicle-block.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/api/src/services/vehicle-block.test.ts` (has `ctxFor(operatorId)` returning an `OPERATOR_OWNER` ctx, and seeds vehicles via `vehicleRepo.create(SYSTEM_CONTEXT, …)`). Add:

```typescript
describe('listBlocks', () => {
  it('operator caller sees only its own blocks in the window', async () => {
    const vA = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-a'))
    const vB = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-b'))
    await blockRepo.create({
      operatorId: 'op-a', vehicleId: vA.id,
      startAt: new Date('2026-07-01T09:00:00Z'), endAt: new Date('2026-07-01T17:00:00Z'),
      kind: 'MAINTENANCE', reason: 'x', notes: null, createdBy: 'u',
    })
    await blockRepo.create({
      operatorId: 'op-b', vehicleId: vB.id,
      startAt: new Date('2026-07-01T09:00:00Z'), endAt: new Date('2026-07-01T17:00:00Z'),
      kind: 'MAINTENANCE', reason: 'y', notes: null, createdBy: 'u',
    })
    const from = new Date('2026-07-01T00:00:00Z')
    const to = new Date('2026-07-02T00:00:00Z')

    const own = await service.listBlocks(ctxFor('op-a'), from, to)
    expect(own.map((b) => b.operatorId)).toEqual(['op-a'])

    const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
    const all = await service.listBlocks(admin, from, to)
    expect(all.length).toBe(2)
  })
})
```

> Match the file's existing helper names. If it lacks `vehicleInput`/`blockRepo`, mirror the route test's `vehicleInput(operatorId)` and the `beforeEach` that builds `new InMemoryVehicleBlockRepository()`. `service` is the `VehicleBlockService` built in the file's setup.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @kuruma/api test -- services/vehicle-block.test.ts`
Expected: FAIL — `service.listBlocks is not a function`.

- [ ] **Step 3: Implement**

In `packages/api/src/services/vehicle-block.ts`, add the method to the class (after `deleteBlock`, line 95):

```typescript
  /**
   * Fleet-wide read for the operator calendar. Row-scope is enforced in the repo
   * via `vehicleBlockReadScope(ctx)` (operator → own tenant, admin → all, else →
   * []), so this is a thin delegation — no separate scope check to drift.
   */
  async listBlocks(ctx: CallerContext, from: Date, to: Date): Promise<VehicleBlock[]> {
    return this.vehicleBlockRepo.findOverlappingInRange(ctx, from, to)
  }
```

(`CallerContext` and `VehicleBlock` are already imported in this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @kuruma/api test -- services/vehicle-block.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/vehicle-block.ts \
  packages/api/src/services/vehicle-block.test.ts
git commit -m "feat(#1101): VehicleBlockService.listBlocks (scoped fleet read)"
```

---

## Task 5: `GET /vehicle-blocks` route

**Files:**
- Modify: `packages/api/src/routes/vehicle-blocks.ts`
- Test: `packages/api/tests/routes/vehicle-blocks.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/api/tests/routes/vehicle-blocks.test.ts` (has `appAs(role, operatorId)`, `vehicleRepo`/`blockRepo`, `vehicleInput`, `testAuthMiddleware`). Add:

```typescript
const RANGE = '?from=2026-07-01T00:00:00.000Z&to=2026-07-02T00:00:00.000Z'

async function getBlocks(app: Hono, query = RANGE) {
  return app.request(`/vehicle-blocks${query}`)
}

describe('GET /vehicle-blocks', () => {
  it('returns the operator-scoped blocks in the window (200)', async () => {
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-a'))
    await blockRepo.create({
      operatorId: 'op-a', vehicleId: vehicle.id,
      startAt: new Date('2026-07-01T09:00:00Z'), endAt: new Date('2026-07-01T17:00:00Z'),
      kind: 'MAINTENANCE', reason: 'shaken', notes: null, createdBy: 'u',
    })
    const res = await getBlocks(appAs('OPERATOR_OWNER', 'op-a'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: Array<{ operatorId: string }> }
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.operatorId).toBe('op-a')
  })

  it('rejects RENTER and PARTNER with 403', async () => {
    expect((await getBlocks(appAs('RENTER'))).status).toBe(403)
    expect((await getBlocks(appAs('PARTNER'))).status).toBe(403)
  })

  it('returns 400 when from/to are missing', async () => {
    const res = await getBlocks(appAs('OPERATOR_OWNER', 'op-a'), '')
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @kuruma/api test -- routes/vehicle-blocks.test.ts`
Expected: FAIL — `GET /vehicle-blocks` 404s (route not defined), so status assertions fail.

- [ ] **Step 3: Implement the route**

In `packages/api/src/routes/vehicle-blocks.ts`:

a) Extend imports — add `MANAGEMENT_READ_ROLES` and `parseDateRange`:

```typescript
import {
  FLEET_WRITE_ROLES,
  MANAGEMENT_READ_ROLES,
  requireAuth,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
import { fail, ok, parseBody, parseDateRange, parseId } from './helpers'
```

b) Guard the new path (after the existing `app.use(...)` lines, ~line 13):

```typescript
  // The fleet-wide read lives at a top-level path, so it is NOT covered by the
  // app-level `/vehicles/*` requireAuth — guard it here (requireUser throws 500
  // without it). Reads are management-tier (RENTER/PARTNER excluded at the gate).
  app.use('/vehicle-blocks', requireAuth())
```

c) Add the handler to the returned chain (before the closing `}` of the chain, e.g. after the `.delete(...)` block):

```typescript
    .get('/vehicle-blocks', async (c) => {
      const user = requireUser(c)
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      // The time window is the only bound (no limit/cursor), so require it: an
      // omitted range must 400, never dump all-time fleet-wide (or cross-operator).
      const range = parseDateRange(c, true)
      if (!range.ok) return range.response

      const blocks = await service.listBlocks(toCallerContext(user), range.from, range.to)
      return ok(c, blocks)
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @kuruma/api test -- routes/vehicle-blocks.test.ts`
Expected: PASS (3 new GET cases + all existing POST/DELETE cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/vehicle-blocks.ts \
  packages/api/tests/routes/vehicle-blocks.test.ts
git commit -m "feat(#1101): GET /vehicle-blocks fleet-wide read (management-gated, range-required)"
```

---

## Final verification (before PR)

- [ ] **Typecheck:** `bun run --filter @kuruma/api typecheck` (or `tsc --noEmit`) → 0 errors.
- [ ] **Boundaries lint:** `bun run --filter @kuruma/api lint:boundaries` → exit 0 (no route→repo import; scope type/resolver live in `tenancy.ts`).
- [ ] **Aggregate tests:** `bun run test` → shared + api + web all green (per the run-aggregate-before-push rule; per-package filters skip shared contract tests).
- [ ] **Format:** `bun run format` (biome). Re-read edited files afterward if biome reorders imports.
- [ ] **Push + PR:** rebase onto `origin/develop` first; PR body `Closes #1101` is premature (Slice B remains) — use `Refs #1101` and note "Slice A of 2; Slice B = web UI". Base = `develop`. Owner squash-merges (no `--admin`).

---

## Self-Review (completed by plan author)

- **Spec coverage:** read endpoint (✓ Tasks 2-5), explicit `VehicleBlockReadScope` union + fail-closed resolver incl. legacy-admin arm (✓ Task 1 + test), `MANAGEMENT_READ_ROLES` gate with RENTER/PARTNER 403 (✓ Task 5), required range → 400 (✓ Task 5), in-memory ⇄ Drizzle parity (✓ Tasks 2-3), `/vehicle-blocks` path (✓ Task 5). Slice B (web) intentionally deferred to its own plan.
- **Type consistency:** `findOverlappingInRange(ctx, from, to)` signature identical across interface (Task 2), in-memory (Task 2), Drizzle (Task 3), service (Task 4), route call (Task 5). `vehicleBlockReadScope` returns the same union consumed by both repos.
- **Placeholder scan:** the two "match the file's existing helpers" notes (Tasks 3-4) point at concrete, named helpers already present in those test files (`seedVehicleClass`, `vehicleInput`, `blockRepo`) — adapt-to-existing, not invent-from-scratch.
