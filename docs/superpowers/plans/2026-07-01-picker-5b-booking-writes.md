# Picker Slice 5b — Booking Writes as the Picked Operator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `PLATFORM_ADMIN` using the operator-context picker create manual bookings and vehicle blocks as the picked operator, with the whole bookings calendar (vehicles, blocks, locations) scoped to that operator.

**Architecture:** No new write-authorization surface — booking/block writes already derive `operatorId` from the chosen vehicle, so the API already authorizes an admin write. The slice narrows the three tenant-shaped calendar reads server-side (bookings shipped in 5a; this adds vehicles + blocks) and flips the web write gates from `isOperatorSession` to `canWriteAsOperator`. The vehicle narrow is gated on the platform tier explicitly (`PRIVILEGED_ROLES`) because the vehicle catalog is public and `operatorReadScope.all` includes renters; the block narrow rides `vehicleBlockReadScope`, whose `all` is already bypass-only.

**Tech Stack:** Hono + Drizzle (API), Vite + TanStack Router + React Query (web), Vitest, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-07-01-picker-5b-booking-writes-design.md`

**Conventions:** run api tests with `cd packages/api && bunx vitest run <path>` (NOT `bun test`); integration tests need `export DATABASE_URL=...` (own docker) and `--config vitest.integration.config.ts`; web tests with `cd packages/web && bunx vitest run <path>`. Commit per task.

---

## File Structure

**API — vehicles narrow (Part A):**
- `packages/api/src/repositories/types.ts` — add `operatorId?` to `VehicleFilters`
- `packages/api/src/repositories/drizzle/vehicle.ts` — `findAll` applies the narrow in the `all` branch
- `packages/api/src/repositories/in-memory/vehicle.ts` — same
- `packages/api/src/services/vehicle.ts` — `findAll` gains `requestedOperatorId`, gated on `PRIVILEGED_ROLES`
- `packages/api/src/routes/vehicles.ts` — `GET /vehicles` reads `?operatorId=`

**API — blocks narrow (Part B):**
- `packages/api/src/repositories/types-vehicle-block.ts` — `findOverlappingInRange` gains optional `requestedOperatorId`
- `packages/api/src/repositories/drizzle/vehicle-block.ts` — narrow in the `all` branch
- `packages/api/src/repositories/in-memory/vehicle-block.ts` — same
- `packages/api/src/services/vehicle-block.ts` — `listBlocks` narrows via `narrowReadToOperator(ctx, id, vehicleBlockReadScope)`
- `packages/api/src/routes/vehicle-blocks.ts` — `GET /vehicle-blocks` reads `?operatorId=`

**Web (Part C):**
- `packages/web/src/vite/operator-bookings/api.ts` — vehicles + blocks queries thread the pick
- `packages/web/src/routes/$locale/_business/manage/bookings/index.tsx` — gate flips + thread the pick into vehicles/blocks/locations queries + loader warm

**New test files:** `tests/repositories/vehicle-operator-narrow.test.ts`, `tests/services/vehicle-operator-scope.test.ts`, `tests/routes/vehicles-operator-narrow.test.ts`, `tests/integration/vehicle-operator-narrow.test.ts`, and the block equivalents; web tests extend `tests/vite/operator-bookings/api-operator-narrow.test.ts` and `OperatorBookingsRoute.test.tsx`.

---

## Part A — Vehicles narrow (API)

### Task A1: `VehicleFilters.operatorId` + repo `all`-branch narrow

**Files:**
- Modify: `packages/api/src/repositories/types.ts:287-293`
- Modify: `packages/api/src/repositories/drizzle/vehicle.ts:40-45`
- Modify: `packages/api/src/repositories/in-memory/vehicle.ts:22-26`
- Test: `packages/api/tests/repositories/vehicle-operator-narrow.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/repositories/vehicle-operator-narrow.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import type { Vehicle } from '../../src/stores'

// #1230 slice 5b: a picker admin (operatorReadScope `all`) narrows the vehicle
// list to one operator via VehicleFilters.operatorId. The gate applies the id
// ONLY in the `all` branch, so a tenant operator's own scope always wins.
const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const opA: CallerContext = { userId: 'ua', role: 'OPERATOR_OWNER', operatorId: 'op-A' }

function vehicleInput(operatorId: string, name: string): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId, name, classId: null, pickupLocationId: null, description: null, photos: [],
    seats: 5, luggageCapacity: null, luggageSize: null, transmission: 'AUTO', fuelType: null,
    licensePlate: null, status: 'AVAILABLE', minRentalHours: null, maxRentalHours: null,
    advanceBookingHours: null, make: null, model: null, year: null, color: null,
    dailyRateJpy: 8000, hourlyRateJpy: null, shakenExpiryDate: null, insuranceExpiryDate: null,
  }
}

async function seedTwoOperators(): Promise<InMemoryVehicleRepository> {
  const repo = new InMemoryVehicleRepository()
  await repo.create(SYSTEM_CONTEXT, vehicleInput('op-A', 'Car A'))
  await repo.create(SYSTEM_CONTEXT, vehicleInput('op-B', 'Car B'))
  return repo
}

describe('vehicle findAll operator narrowing (#1230 slice 5b, repo gate)', () => {
  it('narrows an all-scope admin to the requested operator', async () => {
    const repo = await seedTwoOperators()
    const { data, total } = await repo.findAll(admin, { operatorId: 'op-A' })
    expect(total).toBe(1)
    expect(data.map((v) => v.operatorId)).toEqual(['op-A'])
  })

  it('an all-scope admin with no narrow sees both operators (control)', async () => {
    const repo = await seedTwoOperators()
    const { total } = await repo.findAll(admin)
    expect(total).toBe(2)
  })

  it('a tenant operator ignores a foreign operatorId (base scope wins, H2)', async () => {
    const repo = await seedTwoOperators()
    const { data, total } = await repo.findAll(opA, { operatorId: 'op-B' })
    expect(total).toBe(1)
    expect(data.map((v) => v.operatorId)).toEqual(['op-A'])
  })

  it('a scoped operator with no operatorId (none scope) sees nothing', async () => {
    const repo = await seedTwoOperators()
    const noneCtx: CallerContext = { userId: 'no', role: 'OPERATOR_OWNER' }
    const { total } = await repo.findAll(noneCtx, { operatorId: 'op-A' })
    expect(total).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && bunx vitest run tests/repositories/vehicle-operator-narrow.test.ts`
Expected: FAIL — `VehicleFilters` has no `operatorId`, so the admin-narrow test sees both (total 2, not 1). (The `none`-scope test already passes — it documents existing fail-closed behavior.)

- [ ] **Step 3: Add `operatorId` to `VehicleFilters`**

In `packages/api/src/repositories/types.ts`, replace the `VehicleFilters` interface (lines 287-293):

```typescript
export interface VehicleFilters {
  status?: string
  includeRetired?: boolean
  classId?: string
  limit?: number
  offset?: number
  // RESOLVED privileged-tier narrowing (#1230 slice 5b): a picker admin narrows the
  // public catalog read to one operator. Set ONLY by VehicleService (gated on the
  // platform tier); never populate from raw request input, or a renter could reshape
  // the catalog via ?operatorId= (the #1272 vocabulary trap).
  operatorId?: string
}
```

- [ ] **Step 4: Apply the narrow in the Drizzle repo**

In `packages/api/src/repositories/drizzle/vehicle.ts`, extend the scope block (lines 40-45):

```typescript
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'operator') {
      conditions.push(eq(vehicles.operatorId, scope.operatorId))
    } else if (scope.kind === 'none') {
      conditions.push(sql`false`)
    } else if (filters?.operatorId) {
      // scope.kind === 'all': the picker admin's narrow (service-gated to the platform
      // tier). Applied ONLY in the bypass/catalog `all` branch — H2.
      conditions.push(eq(vehicles.operatorId, filters.operatorId))
    }
```

- [ ] **Step 5: Apply the narrow in the in-memory repo**

In `packages/api/src/repositories/in-memory/vehicle.ts`, replace the `all` filter (lines 24-26):

```typescript
    const all = [...this.store.values()].filter((v) => {
      if (scope.kind === 'operator') return v.operatorId === scope.operatorId
      // scope.kind === 'all': apply the service-resolved picker narrow when present.
      if (filters?.operatorId) return v.operatorId === filters.operatorId
      return true
    })
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/api && bunx vitest run tests/repositories/vehicle-operator-narrow.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/repositories/types.ts packages/api/src/repositories/drizzle/vehicle.ts packages/api/src/repositories/in-memory/vehicle.ts packages/api/tests/repositories/vehicle-operator-narrow.test.ts
git commit -m "feat(#1230): VehicleFilters.operatorId repo narrow (picker slice 5b)"
```

---

### Task A2: `VehicleService.findAll` privileged-tier gate

**Files:**
- Modify: `packages/api/src/services/vehicle.ts:7` (import) and `:91-93` (`findAll`)
- Test: `packages/api/tests/services/vehicle-operator-scope.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/services/vehicle-operator-scope.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import { VehicleService } from '../../src/services/vehicle'
import type { Vehicle } from '../../src/stores'
import { testResolveWriteOperatorId } from '../helpers/operator'

// #1230 slice 5b: the vehicle catalog is PUBLIC (operatorReadScope maps renters and
// partners to `all`), so the picker narrow must gate on the platform tier explicitly.
// A renter/partner passing ?operatorId= is NOT narrowed — they still read the whole
// catalog; only a PLATFORM_ADMIN narrows.
const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const renter: CallerContext = { userId: 'r', role: 'RENTER' }
const partner: CallerContext = { userId: 'p', role: 'PARTNER', bypassScope: true }
const opA: CallerContext = { userId: 'ua', role: 'OPERATOR_OWNER', operatorId: 'op-A' }

function vehicleInput(operatorId: string, name: string): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId, name, classId: null, pickupLocationId: null, description: null, photos: [],
    seats: 5, luggageCapacity: null, luggageSize: null, transmission: 'AUTO', fuelType: null,
    licensePlate: null, status: 'AVAILABLE', minRentalHours: null, maxRentalHours: null,
    advanceBookingHours: null, make: null, model: null, year: null, color: null,
    dailyRateJpy: 8000, hourlyRateJpy: null, shakenExpiryDate: null, insuranceExpiryDate: null,
  }
}

async function service(): Promise<VehicleService> {
  const repo = new InMemoryVehicleRepository()
  await repo.create(SYSTEM_CONTEXT, vehicleInput('op-A', 'Car A'))
  await repo.create(SYSTEM_CONTEXT, vehicleInput('op-B', 'Car B'))
  return new VehicleService(repo, testResolveWriteOperatorId(), '')
}

describe('VehicleService.findAll — privileged-tier picker narrow (#1230 slice 5b)', () => {
  it('narrows a PLATFORM_ADMIN to the requested operator', async () => {
    const { total, data } = await (await service()).findAll(admin, {}, 'op-A')
    expect(total).toBe(1)
    expect(data.map((v) => v.operatorId)).toEqual(['op-A'])
  })

  it('does NOT narrow a renter — the public catalog stays whole', async () => {
    const { total } = await (await service()).findAll(renter, {}, 'op-A')
    expect(total).toBe(2)
  })

  it('does NOT narrow a partner', async () => {
    const { total } = await (await service()).findAll(partner, {}, 'op-A')
    expect(total).toBe(2)
  })

  it('does NOT narrow legacy STAFF or ADMIN (not the platform tier)', async () => {
    const staff: CallerContext = { userId: 's', role: 'STAFF' }
    const legacyAdmin: CallerContext = { userId: 'a2', role: 'ADMIN' }
    expect((await (await service()).findAll(staff, {}, 'op-A')).total).toBe(2)
    expect((await (await service()).findAll(legacyAdmin, {}, 'op-A')).total).toBe(2)
  })

  it('a tenant operator cannot widen via a foreign operatorId', async () => {
    const { total, data } = await (await service()).findAll(opA, {}, 'op-B')
    expect(total).toBe(1)
    expect(data.map((v) => v.operatorId)).toEqual(['op-A'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && bunx vitest run tests/services/vehicle-operator-scope.test.ts`
Expected: FAIL — `findAll` takes no third arg, so the admin-narrow test sees both (total 2). (TypeScript in tests is not compiled by tsc, so the extra arg is ignored at runtime until the impl accepts it.)

- [ ] **Step 3: Add the `PRIVILEGED_ROLES` import**

In `packages/api/src/services/vehicle.ts`, change line 7 from `import type { CallerContext } from '../middleware/auth'` to:

```typescript
import { type CallerContext, PRIVILEGED_ROLES } from '../middleware/auth'
```

- [ ] **Step 4: Gate the narrow in `findAll`**

In `packages/api/src/services/vehicle.ts`, replace `findAll` (lines 91-93):

```typescript
  async findAll(
    ctx: CallerContext,
    filters?: VehicleFilters,
    requestedOperatorId?: string,
  ): Promise<PaginatedResult<Vehicle>> {
    // Picker narrow (#1230 slice 5b): the vehicle catalog is PUBLIC, so operatorReadScope
    // maps renters/partners to `all` — keying the narrow off it would echo their
    // ?operatorId= (the #1272 trap). Vehicles have no bypass-only read resolver, so gate
    // the narrow on the platform tier explicitly here — the single enforcement point.
    const narrowedOperatorId = PRIVILEGED_ROLES.has(ctx.role) ? requestedOperatorId : undefined
    return this.repo.findAll(ctx, {
      ...filters,
      ...(narrowedOperatorId ? { operatorId: narrowedOperatorId } : {}),
    })
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/api && bunx vitest run tests/services/vehicle-operator-scope.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/vehicle.ts packages/api/tests/services/vehicle-operator-scope.test.ts
git commit -m "feat(#1230): gate vehicle picker narrow on PRIVILEGED_ROLES (5b P2)"
```

---

### Task A3: `GET /vehicles` reads `?operatorId=`

**Files:**
- Modify: `packages/api/src/routes/vehicles.ts:18-31`
- Test: `packages/api/tests/routes/vehicles-operator-narrow.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/routes/vehicles-operator-narrow.test.ts`:

```typescript
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import { SYSTEM_CONTEXT, type UserRole } from '../../src/middleware/auth'
import { InMemoryMaintenanceLogRepository, InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import type { RunInTransaction } from '../../src/repositories/types'
import { createVehicleRoutes } from '../../src/routes/vehicles'
import { MaintenanceService } from '../../src/services/maintenance'
import { VehicleService } from '../../src/services/vehicle'
import type { Vehicle } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'
import { testResolveWriteOperatorId } from '../helpers/operator'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'

function vehicleInput(operatorId: string, name: string): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId, name, classId: null, pickupLocationId: null, description: null, photos: [],
    seats: 5, luggageCapacity: null, luggageSize: null, transmission: 'AUTO', fuelType: null,
    licensePlate: null, status: 'AVAILABLE', minRentalHours: null, maxRentalHours: null,
    advanceBookingHours: null, make: null, model: null, year: null, color: null,
    dailyRateJpy: 8000, hourlyRateJpy: null, shakenExpiryDate: null, insuranceExpiryDate: null,
  }
}

async function seedRepo(): Promise<InMemoryVehicleRepository> {
  const repo = new InMemoryVehicleRepository()
  await repo.create(SYSTEM_CONTEXT, vehicleInput(OP_A, 'Car A'))
  await repo.create(SYSTEM_CONTEXT, vehicleInput(OP_B, 'Car B'))
  return repo
}

function mountRead(repo: InMemoryVehicleRepository, role: UserRole, operatorId?: string): Hono {
  const logRepo = new InMemoryMaintenanceLogRepository()
  const runInTransaction: RunInTransaction = async (fn) => fn({ vehicleRepo: repo, maintenanceLogRepo: logRepo })
  const maintenanceService = new MaintenanceService(repo, logRepo, runInTransaction)
  const vehicleService = new VehicleService(repo, testResolveWriteOperatorId(), '')
  const a = new Hono()
  setupGlobalHandlers(a)
  a.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  a.route('/', createVehicleRoutes(vehicleService, maintenanceService))
  return a
}

describe('GET /vehicles — picker operator narrowing (#1230 slice 5b)', () => {
  it('narrows a PLATFORM_ADMIN to ?operatorId=', async () => {
    const res = await mountRead(await seedRepo(), 'PLATFORM_ADMIN').request(`/vehicles?operatorId=${OP_A}`)
    const body = (await res.json()) as { success: boolean; data: Array<{ operatorId: string }> }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.operatorId).toBe(OP_A)
  })

  it('ignores ?operatorId= for a renter (public catalog stays whole)', async () => {
    const res = await mountRead(await seedRepo(), 'RENTER').request(`/vehicles?operatorId=${OP_A}`)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(2)
  })

  it('ignores ?operatorId= for a tenant operator (its own scope wins)', async () => {
    const res = await mountRead(await seedRepo(), 'OPERATOR_OWNER', OP_A).request(`/vehicles?operatorId=${OP_B}`)
    const body = (await res.json()) as { data: Array<{ operatorId: string }> }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.operatorId).toBe(OP_A)
  })

  it('treats an empty ?operatorId= as no narrow', async () => {
    const res = await mountRead(await seedRepo(), 'PLATFORM_ADMIN').request('/vehicles?operatorId=')
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && bunx vitest run tests/routes/vehicles-operator-narrow.test.ts`
Expected: FAIL — the route ignores `operatorId`, so the admin-narrow test returns 2.

- [ ] **Step 3: Read `operatorId` in the route**

In `packages/api/src/routes/vehicles.ts`, replace the `GET /vehicles` handler (lines 18-31):

```typescript
    .get('/vehicles', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const status = c.req.query('status')
      const operatorId = c.req.query('operatorId')
      const pg = parsePagination(c, { defaultLimit: 50 })
      if (!pg.ok) return pg.response
      const { limit, offset } = pg

      const { data, total } = await service.findAll(
        ctx,
        { limit, offset, ...(status ? { status } : {}) },
        operatorId,
      )
      return ok(c, data, 200, { total, limit, offset })
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && bunx vitest run tests/routes/vehicles-operator-narrow.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/vehicles.ts packages/api/tests/routes/vehicles-operator-narrow.test.ts
git commit -m "feat(#1230): GET /vehicles reads ?operatorId= picker narrow (5b)"
```

---

### Task A4: Real-Postgres integration test (vehicles narrow)

**Files:**
- Test: `packages/api/tests/integration/vehicle-operator-narrow.test.ts` (create)

- [ ] **Step 1: Write the test**

Create `packages/api/tests/integration/vehicle-operator-narrow.test.ts`:

```typescript
import { operators, vehicles } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { DrizzleVehicleRepository } from '../../src/repositories/drizzle'
import { DEFAULT_DAILY_RATE_JPY, db } from './setup'

// #1230 slice 5b: the picker admin's vehicle narrowing, proven against real Postgres
// at the repo layer. A bypass admin (operatorReadScope `all`) narrows via
// VehicleFilters.operatorId; the gate applies it ONLY for an `all` scope, so a tenant
// operator passing a foreign id stays clamped (H2).
describe('vehicle findAll operator narrowing (#1230 slice 5b, Drizzle, real Postgres)', () => {
  const repo = new DrizzleVehicleRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `veh_narrow_a_${uniq}`
  const opBId = `veh_narrow_b_${uniq}`
  let vehAId: string
  let vehBId: string

  const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
  const opB: CallerContext = { userId: 'owner', role: 'OPERATOR_OWNER', operatorId: opBId, bypassScope: false }

  async function seedVehicle(opId: string, name: string): Promise<string> {
    const v = await repo.create(SYSTEM_CONTEXT, {
      operatorId: opId, classId: null, name, description: null, photos: [], seats: 5,
      transmission: 'AUTO', fuelType: null, licensePlate: null, status: 'AVAILABLE',
      minRentalHours: null, maxRentalHours: null, advanceBookingHours: null, make: null,
      model: null, year: null, color: null, dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null, shakenExpiryDate: null, insuranceExpiryDate: null,
    })
    return v.id
  }

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `veh-narrow-a-${uniq}`, name: 'Veh Narrow A' },
      { id: opBId, slug: `veh-narrow-b-${uniq}`, name: 'Veh Narrow B' },
    ])
    vehAId = await seedVehicle(opAId, 'Narrow Car A')
    vehBId = await seedVehicle(opBId, 'Narrow Car B')
  })

  afterAll(async () => {
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('an all-scope admin with no narrow sees both operators (control)', async () => {
    const { data } = await repo.findAll(admin)
    const ids = data.map((v) => v.id)
    expect(ids).toContain(vehAId)
    expect(ids).toContain(vehBId)
  })

  it('an all-scope admin narrows to just the requested operator', async () => {
    const { data } = await repo.findAll(admin, { operatorId: opAId })
    const ids = data.map((v) => v.id)
    expect(ids).toContain(vehAId)
    expect(ids).not.toContain(vehBId)
    expect(data.every((v) => v.operatorId === opAId)).toBe(true)
  })

  it('a tenant operator cannot widen via a foreign operatorId (H2)', async () => {
    const { data } = await repo.findAll(opB, { operatorId: opAId })
    expect(data.every((v) => v.operatorId === opBId)).toBe(true)
    expect(data.map((v) => v.id)).not.toContain(vehAId)
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `export DATABASE_URL="postgres://postgres:postgres@localhost:<your-port>/kuruma" && cd packages/api && bunx vitest run --config vitest.integration.config.ts tests/integration/vehicle-operator-narrow.test.ts`
Expected: PASS (2 tests). If it fails on connection, confirm your docker Postgres is migrated.

- [ ] **Step 3: Commit**

```bash
git add packages/api/tests/integration/vehicle-operator-narrow.test.ts
git commit -m "test(#1230): real-pg vehicle operator narrow (5b)"
```

---

## Part B — Blocks narrow (API)

### Task B1: block repo `all`-branch narrow

**Files:**
- Modify: `packages/api/src/repositories/types-vehicle-block.ts:25`
- Modify: `packages/api/src/repositories/drizzle/vehicle-block.ts:56-76`
- Modify: `packages/api/src/repositories/in-memory/vehicle-block.ts:56-65`
- Test: `packages/api/tests/repositories/vehicle-block-operator-narrow.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/repositories/vehicle-block-operator-narrow.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import { InMemoryVehicleBlockRepository } from '../../src/repositories/in-memory/vehicle-block'

// #1230 slice 5b: a picker admin (vehicleBlockReadScope `all`) narrows the fleet-wide
// block read to one operator. vehicleBlockReadScope's `all` is bypass-only, so the
// narrow rides it cleanly; a tenant operator's own scope always wins.
const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const opA: CallerContext = { userId: 'ua', role: 'OPERATOR_OWNER', operatorId: 'op-A' }

const FROM = new Date('2026-07-01T00:00:00Z')
const TO = new Date('2026-07-02T00:00:00Z')

async function seedTwoOperators(): Promise<InMemoryVehicleBlockRepository> {
  const repo = new InMemoryVehicleBlockRepository()
  await repo.create({
    operatorId: 'op-A', vehicleId: 'veh-A', startAt: new Date('2026-07-01T09:00:00Z'),
    endAt: new Date('2026-07-01T17:00:00Z'), kind: 'MAINTENANCE', reason: 'a', notes: null, createdBy: 'u',
  })
  await repo.create({
    operatorId: 'op-B', vehicleId: 'veh-B', startAt: new Date('2026-07-01T09:00:00Z'),
    endAt: new Date('2026-07-01T17:00:00Z'), kind: 'MAINTENANCE', reason: 'b', notes: null, createdBy: 'u',
  })
  return repo
}

describe('vehicle-block findOverlappingInRange operator narrowing (#1230 slice 5b)', () => {
  it('narrows an all-scope admin to the requested operator', async () => {
    const repo = await seedTwoOperators()
    const rows = await repo.findOverlappingInRange(admin, FROM, TO, 'op-A')
    expect(rows.map((b) => b.operatorId)).toEqual(['op-A'])
  })

  it('an all-scope admin with no narrow sees both operators (control)', async () => {
    const repo = await seedTwoOperators()
    const rows = await repo.findOverlappingInRange(admin, FROM, TO)
    expect(rows).toHaveLength(2)
  })

  it('a tenant operator ignores a foreign operatorId (base scope wins, H2)', async () => {
    const repo = await seedTwoOperators()
    const rows = await repo.findOverlappingInRange(opA, FROM, TO, 'op-B')
    expect(rows.map((b) => b.operatorId)).toEqual(['op-A'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && bunx vitest run tests/repositories/vehicle-block-operator-narrow.test.ts`
Expected: FAIL — the 4th arg is ignored, so the admin-narrow test returns 2.

- [ ] **Step 3: Widen the interface**

In `packages/api/src/repositories/types-vehicle-block.ts`, replace `findOverlappingInRange` (line 25):

```typescript
  findOverlappingInRange(
    ctx: CallerContext,
    from: Date,
    to: Date,
    requestedOperatorId?: string,
  ): Promise<VehicleBlock[]>
```

- [ ] **Step 4: Apply the narrow in the Drizzle repo**

In `packages/api/src/repositories/drizzle/vehicle-block.ts`, replace `findOverlappingInRange` (lines 56-76):

```typescript
  async findOverlappingInRange(
    ctx: CallerContext,
    from: Date,
    to: Date,
    requestedOperatorId?: string,
  ): Promise<VehicleBlock[]> {
    const scope = vehicleBlockReadScope(ctx)
    const conditions: SQL[] = [
      sql`tstzrange("startAt", "endAt") && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)`,
    ]
    if (scope.kind === 'operator') {
      conditions.push(eq(vehicleBlocks.operatorId, scope.operatorId))
    } else if (scope.kind === 'none') {
      conditions.push(sql`false`)
    } else if (requestedOperatorId) {
      // scope.kind === 'all' (bypass admin): the picker narrow. vehicleBlockReadScope's
      // `all` is bypass-only (PARTNER pre-branched to none), so this branch is safe.
      conditions.push(eq(vehicleBlocks.operatorId, requestedOperatorId))
    }
    const rows = await this.db
      .select(vehicleBlockColumns)
      .from(vehicleBlocks)
      .where(and(...conditions))
    return rows.map(toVehicleBlock)
  }
```

- [ ] **Step 5: Apply the narrow in the in-memory repo**

In `packages/api/src/repositories/in-memory/vehicle-block.ts`, replace `findOverlappingInRange` (lines 56-65):

```typescript
  async findOverlappingInRange(
    ctx: CallerContext,
    from: Date,
    to: Date,
    requestedOperatorId?: string,
  ): Promise<VehicleBlock[]> {
    const scope = vehicleBlockReadScope(ctx)
    if (scope.kind === 'none') return []
    return [...this.store.values()].filter((b) => {
      if (b.startAt >= to || b.endAt <= from) return false
      if (scope.kind === 'operator') return b.operatorId === scope.operatorId
      // scope.kind === 'all': apply the service-resolved narrow when present.
      if (requestedOperatorId) return b.operatorId === requestedOperatorId
      return true
    })
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/api && bunx vitest run tests/repositories/vehicle-block-operator-narrow.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/repositories/types-vehicle-block.ts packages/api/src/repositories/drizzle/vehicle-block.ts packages/api/src/repositories/in-memory/vehicle-block.ts packages/api/tests/repositories/vehicle-block-operator-narrow.test.ts
git commit -m "feat(#1230): vehicle-block repo operator narrow (5b P1)"
```

---

### Task B2: `VehicleBlockService.listBlocks` narrow

**Files:**
- Modify: `packages/api/src/services/vehicle-block.ts` (imports + `listBlocks`, lines 128-135)
- Test: `packages/api/tests/services/vehicle-block-scope.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/services/vehicle-block-scope.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import {
  InMemoryBookingRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { VehicleBlockService } from '../../src/services/vehicle-block'

// #1230 slice 5b: listBlocks threads narrowReadToOperator(ctx, id, vehicleBlockReadScope),
// so only a bypass admin's requested operator survives; a tenant operator stays clamped.
const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const opA: CallerContext = { userId: 'ua', role: 'OPERATOR_OWNER', operatorId: 'op-A' }

const FROM = new Date('2026-07-01T00:00:00Z')
const TO = new Date('2026-07-02T00:00:00Z')

async function service(): Promise<VehicleBlockService> {
  const blockRepo = new InMemoryVehicleBlockRepository()
  await blockRepo.create({
    operatorId: 'op-A', vehicleId: 'veh-A', startAt: new Date('2026-07-01T09:00:00Z'),
    endAt: new Date('2026-07-01T17:00:00Z'), kind: 'MAINTENANCE', reason: 'a', notes: null, createdBy: 'u',
  })
  await blockRepo.create({
    operatorId: 'op-B', vehicleId: 'veh-B', startAt: new Date('2026-07-01T09:00:00Z'),
    endAt: new Date('2026-07-01T17:00:00Z'), kind: 'MAINTENANCE', reason: 'b', notes: null, createdBy: 'u',
  })
  return new VehicleBlockService(new InMemoryVehicleRepository(), blockRepo, new InMemoryBookingRepository())
}

describe('VehicleBlockService.listBlocks — picker narrow (#1230 slice 5b)', () => {
  it('narrows a bypass admin to the requested operator', async () => {
    const rows = await (await service()).listBlocks(admin, FROM, TO, 'op-A')
    expect(rows.map((b) => b.operatorId)).toEqual(['op-A'])
  })

  it('a tenant operator cannot widen via a foreign operatorId', async () => {
    const rows = await (await service()).listBlocks(opA, FROM, TO, 'op-B')
    expect(rows.map((b) => b.operatorId)).toEqual(['op-A'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && bunx vitest run tests/services/vehicle-block-scope.test.ts`
Expected: FAIL — `listBlocks` ignores the 4th arg, so the admin-narrow test returns 2.

- [ ] **Step 3: Add the tenancy imports**

In `packages/api/src/services/vehicle-block.ts`, add to the imports at the top of the file:

```typescript
import { narrowReadToOperator, vehicleBlockReadScope } from '../tenancy'
```

- [ ] **Step 4: Narrow in `listBlocks`**

In `packages/api/src/services/vehicle-block.ts`, replace `listBlocks` (lines 133-135):

```typescript
  async listBlocks(
    ctx: CallerContext,
    from: Date,
    to: Date,
    requestedOperatorId?: string,
  ): Promise<VehicleBlock[]> {
    // #1230 slice 5b: a picker admin narrows the fleet-wide read to one operator.
    // vehicleBlockReadScope's `all` is bypass-only, so only an admin's id survives.
    const operatorId = narrowReadToOperator(ctx, requestedOperatorId, vehicleBlockReadScope)
    return this.vehicleBlockRepo.findOverlappingInRange(ctx, from, to, operatorId)
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/api && bunx vitest run tests/services/vehicle-block-scope.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/vehicle-block.ts packages/api/tests/services/vehicle-block-scope.test.ts
git commit -m "feat(#1230): listBlocks narrows to picked operator (5b P1)"
```

---

### Task B3: `GET /vehicle-blocks` reads `?operatorId=`

**Files:**
- Modify: `packages/api/src/routes/vehicle-blocks.ts:27-38`
- Test: `packages/api/tests/routes/vehicle-blocks-operator-narrow.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/routes/vehicle-blocks-operator-narrow.test.ts`:

```typescript
import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT, type UserRole } from '../../src/middleware/auth'
import {
  InMemoryBookingRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { createVehicleBlockRoutes } from '../../src/routes/vehicle-blocks'
import { VehicleBlockService } from '../../src/services/vehicle-block'
import type { Vehicle } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

const RANGE = '?from=2026-07-01T00:00:00.000Z&to=2026-07-02T00:00:00.000Z'

let vehicleRepo: InMemoryVehicleRepository
let blockRepo: InMemoryVehicleBlockRepository
let bookingRepo: InMemoryBookingRepository

function vehicleInput(operatorId: string): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId, name: 'Car', classId: null, pickupLocationId: null, description: null, photos: [],
    seats: 5, luggageCapacity: null, luggageSize: null, transmission: 'AUTO', fuelType: null,
    licensePlate: null, status: 'AVAILABLE', minRentalHours: null, maxRentalHours: null,
    advanceBookingHours: null, make: null, model: null, year: null, color: null,
    dailyRateJpy: 8000, hourlyRateJpy: null, shakenExpiryDate: null, insuranceExpiryDate: null,
  }
}

function appAs(role: UserRole, operatorId?: string): Hono {
  const a = new Hono()
  a.use('*', testAuthMiddleware('caller', role, operatorId))
  a.route('/', createVehicleBlockRoutes(new VehicleBlockService(vehicleRepo, blockRepo, bookingRepo)))
  return a
}

async function seedBlock(operatorId: string, vehicleId: string): Promise<void> {
  await blockRepo.create({
    operatorId, vehicleId, startAt: new Date('2026-07-01T09:00:00Z'),
    endAt: new Date('2026-07-01T17:00:00Z'), kind: 'MAINTENANCE', reason: 'shaken', notes: null, createdBy: 'u',
  })
}

beforeEach(async () => {
  vehicleRepo = new InMemoryVehicleRepository()
  blockRepo = new InMemoryVehicleBlockRepository()
  bookingRepo = new InMemoryBookingRepository()
  const va = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-a'))
  const vb = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-b'))
  await seedBlock('op-a', va.id)
  await seedBlock('op-b', vb.id)
})

describe('GET /vehicle-blocks — picker operator narrowing (#1230 slice 5b)', () => {
  it('narrows a PLATFORM_ADMIN to ?operatorId=', async () => {
    const res = await appAs('PLATFORM_ADMIN').request(`/vehicle-blocks${RANGE}&operatorId=op-a`)
    const body = (await res.json()) as { data: Array<{ operatorId: string }> }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.operatorId).toBe('op-a')
  })

  it('a PLATFORM_ADMIN with no pick sees both operators', async () => {
    const res = await appAs('PLATFORM_ADMIN').request(`/vehicle-blocks${RANGE}`)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(2)
  })

  it('a tenant operator ignores a foreign ?operatorId=', async () => {
    const res = await appAs('OPERATOR_OWNER', 'op-a').request(`/vehicle-blocks${RANGE}&operatorId=op-b`)
    const body = (await res.json()) as { data: Array<{ operatorId: string }> }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.operatorId).toBe('op-a')
  })

  it('legacy STAFF is admitted by the route gate but reads nothing (scope none), ?operatorId= cannot widen', async () => {
    const res = await appAs('STAFF').request(`/vehicle-blocks${RANGE}&operatorId=op-a`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && bunx vitest run tests/routes/vehicle-blocks-operator-narrow.test.ts`
Expected: FAIL — the route ignores `operatorId`, so the admin-narrow test returns 2. (The legacy-STAFF test already passes — it documents existing scope behavior.)

- [ ] **Step 3: Read `operatorId` in the route**

In `packages/api/src/routes/vehicle-blocks.ts`, replace the `GET /vehicle-blocks` handler (lines 27-38):

```typescript
    .get('/vehicle-blocks', async (c) => {
      const user = requireUser(c)
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      // The time window is the only bound (no limit/cursor), so require it: an
      // omitted range must 400, never dump all-time fleet-wide (or cross-operator).
      const range = parseDateRange(c, true)
      if (!range.ok) return range.response

      // #1230 slice 5b: a picker admin narrows the fleet read to one operator. The
      // service drops the id for any non-bypass caller, so a tenant read never widens.
      const operatorId = c.req.query('operatorId')
      const blocks = await service.listBlocks(toCallerContext(user), range.from, range.to, operatorId)
      return ok(c, blocks)
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && bunx vitest run tests/routes/vehicle-blocks-operator-narrow.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/vehicle-blocks.ts packages/api/tests/routes/vehicle-blocks-operator-narrow.test.ts
git commit -m "feat(#1230): GET /vehicle-blocks reads ?operatorId= picker narrow (5b)"
```

---

### Task B4: Real-Postgres integration test (blocks narrow)

**Files:**
- Test: `packages/api/tests/integration/vehicle-block-operator-narrow.test.ts` (create)

- [ ] **Step 1: Write the test**

Create `packages/api/tests/integration/vehicle-block-operator-narrow.test.ts`:

```typescript
import { operators, vehicleBlocks, vehicles } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { DrizzleVehicleBlockRepository, DrizzleVehicleRepository } from '../../src/repositories/drizzle'
import { DEFAULT_DAILY_RATE_JPY, db } from './setup'

// #1230 slice 5b: the picker admin's block narrowing, proven against real Postgres.
describe('vehicle-block findOverlappingInRange operator narrowing (#1230 slice 5b, Drizzle)', () => {
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const blockRepo = new DrizzleVehicleBlockRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `blk_narrow_a_${uniq}`
  const opBId = `blk_narrow_b_${uniq}`
  const FROM = new Date('2027-11-01T00:00:00Z')
  const TO = new Date('2027-11-02T00:00:00Z')

  const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }

  async function seed(opId: string): Promise<void> {
    const v = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: opId, classId: null, name: 'Blk Car', description: null, photos: [], seats: 5,
      transmission: 'AUTO', fuelType: null, licensePlate: null, status: 'AVAILABLE',
      minRentalHours: null, maxRentalHours: null, advanceBookingHours: null, make: null,
      model: null, year: null, color: null, dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null, shakenExpiryDate: null, insuranceExpiryDate: null,
    })
    await blockRepo.create({
      operatorId: opId, vehicleId: v.id, startAt: new Date('2027-11-01T09:00:00Z'),
      endAt: new Date('2027-11-01T17:00:00Z'), kind: 'MAINTENANCE', reason: 'shaken', notes: null, createdBy: 'u',
    })
  }

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `blk-narrow-a-${uniq}`, name: 'Blk Narrow A' },
      { id: opBId, slug: `blk-narrow-b-${uniq}`, name: 'Blk Narrow B' },
    ])
    await seed(opAId)
    await seed(opBId)
  })

  afterAll(async () => {
    await db.delete(vehicleBlocks).where(inArray(vehicleBlocks.operatorId, [opAId, opBId]))
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('an all-scope admin narrows to just the requested operator', async () => {
    const rows = await blockRepo.findOverlappingInRange(admin, FROM, TO, opAId)
    expect(rows.every((b) => b.operatorId === opAId)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('an all-scope admin with no narrow sees both operators', async () => {
    const rows = await blockRepo.findOverlappingInRange(admin, FROM, TO)
    const ops = new Set(rows.map((b) => b.operatorId))
    expect(ops.has(opAId)).toBe(true)
    expect(ops.has(opBId)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `export DATABASE_URL="postgres://postgres:postgres@localhost:<your-port>/kuruma" && cd packages/api && bunx vitest run --config vitest.integration.config.ts tests/integration/vehicle-block-operator-narrow.test.ts`
Expected: PASS (2 tests). If `DrizzleVehicleBlockRepository` isn't exported from `../../src/repositories/drizzle`, import it from `../../src/repositories/drizzle/vehicle-block` instead.

- [ ] **Step 3: Commit**

```bash
git add packages/api/tests/integration/vehicle-block-operator-narrow.test.ts
git commit -m "test(#1230): real-pg vehicle-block operator narrow (5b)"
```

---

## Part C — Web

### Task C1: thread the pick into the vehicles + blocks queries

**Files:**
- Modify: `packages/web/src/vite/operator-bookings/api.ts:160-183` (vehicles) and `:196-208` (blocks)
- Test: `packages/web/tests/vite/operator-bookings/api-operator-narrow.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

In `packages/web/tests/vite/operator-bookings/api-operator-narrow.test.ts`, add the two functions to the import at the top (line 1-6):

```typescript
import {
  fetchCalendarBlocks,
  fetchCalendarBookings,
  fetchCalendarVehicles,
  fetchNeedsAssignment,
  needsAssignmentQueryOptions,
  operatorCalendarBlocksQueryOptions,
  operatorCalendarQueryOptions,
  operatorCalendarVehiclesQueryOptions,
} from '@/vite/operator-bookings/api'
```

Then add a new describe block at the end of the file (before the final line):

```typescript
describe('operator calendar vehicles + blocks — picked-operator narrowing (#1230 slice 5b)', () => {
  it('fetchCalendarVehicles appends operatorId when an operator is picked', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
    await fetchCalendarVehicles('op_a')
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('operatorId=op_a')
  })

  it('fetchCalendarVehicles omits operatorId when no operator is picked', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
    await fetchCalendarVehicles()
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).not.toContain('operatorId')
  })

  it('keys the vehicles cache by the picked operator', () => {
    expect(operatorCalendarVehiclesQueryOptions('op_a').queryKey).toEqual([
      'operator-bookings', 'calendar', 'vehicles', 'op_a',
    ])
  })

  it('fetchCalendarBlocks appends operatorId when an operator is picked', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
    await fetchCalendarBlocks(FROM, TO, 'op_a')
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('operatorId=op_a')
  })

  it('keys the blocks cache by the picked operator', () => {
    expect(operatorCalendarBlocksQueryOptions(FROM, TO, 'op_a').queryKey).toEqual([
      'operator-bookings', 'blocks', FROM, TO, 'op_a',
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web && bunx vitest run tests/vite/operator-bookings/api-operator-narrow.test.ts`
Expected: FAIL — `fetchCalendarVehicles`/`operatorCalendarVehiclesQueryOptions` take no pick arg, so the URL/key assertions fail.

- [ ] **Step 3: Thread the pick into the vehicles query**

In `packages/web/src/vite/operator-bookings/api.ts`, replace `fetchCalendarVehicles` and `operatorCalendarVehiclesQueryOptions` (lines 160-183):

```typescript
export async function fetchCalendarVehicles(pickedOperatorId?: string): Promise<CalendarVehicle[]> {
  // Degrade to an empty list on failure: the vehicle columns + sidebar filter are
  // a day-view convenience, so a vehicle-list error must NOT take down the whole
  // bookings calendar (week/month render fine without columns, and the route's
  // loader Promise.all would otherwise reject and blank the page).
  try {
    const sp = new URLSearchParams({ limit: String(VEHICLES_PAGE_LIMIT) })
    // #1230 slice 5b: a picker admin narrows the columns + dialog vehicle pickers to
    // one operator. The API drops the id for any non-privileged caller.
    if (pickedOperatorId) sp.set('operatorId', pickedOperatorId)
    const res = await fetch(`${getApiBaseUrl()}/vehicles?${sp.toString()}`, {
      credentials: 'include',
    })
    const data = await unwrap(res, calendarVehicleRowSchema.array())
    return data.map((v) => ({ id: v.id, name: v.name }))
  } catch {
    return []
  }
}

export function operatorCalendarVehiclesQueryOptions(pickedOperatorId?: string) {
  return queryOptions({
    queryKey: ['operator-bookings', 'calendar', 'vehicles', pickedOperatorId ?? null],
    queryFn: () => fetchCalendarVehicles(pickedOperatorId),
  })
}
```

- [ ] **Step 4: Thread the pick into the blocks query**

In `packages/web/src/vite/operator-bookings/api.ts`, replace `fetchCalendarBlocks` and `operatorCalendarBlocksQueryOptions` (lines 196-208):

```typescript
export async function fetchCalendarBlocks(
  from: string,
  to: string,
  pickedOperatorId?: string,
): Promise<CalendarBlockRow[]> {
  const sp = new URLSearchParams({ from, to })
  // #1230 slice 5b: a picker admin narrows the block bands to one operator.
  if (pickedOperatorId) sp.set('operatorId', pickedOperatorId)
  const res = await fetch(`${getApiBaseUrl()}/vehicle-blocks?${sp.toString()}`, {
    credentials: 'include',
  })
  return unwrap(res, calendarBlockSchema.array())
}

export function operatorCalendarBlocksQueryOptions(from: string, to: string, pickedOperatorId?: string) {
  return queryOptions({
    queryKey: ['operator-bookings', 'blocks', from, to, pickedOperatorId ?? null],
    queryFn: () => fetchCalendarBlocks(from, to, pickedOperatorId),
  })
}
```

- [ ] **Step 4b: Update the existing query-key assertions the shape change breaks**

The query keys now carry a trailing `pickedOperatorId ?? null` slot, so two existing assertions must be updated (they hard-code the old shorter keys).

In `packages/web/tests/vite/operator-bookings/api.test.ts`, update the `operatorCalendarVehiclesQueryOptions` key assertion (around line 459-464):

```typescript
    expect(operatorCalendarVehiclesQueryOptions().queryKey).toEqual([
      'operator-bookings',
      'calendar',
      'vehicles',
      null,
    ])
```

In `packages/web/tests/vite/operator-bookings/blocks-api.test.ts`, update the `operatorCalendarBlocksQueryOptions` key assertion (around line 107):

```typescript
    const opts = operatorCalendarBlocksQueryOptions('from-iso', 'to-iso')
    expect(opts.queryKey).toEqual(['operator-bookings', 'blocks', 'from-iso', 'to-iso', null])
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/web && bunx vitest run tests/vite/operator-bookings/api-operator-narrow.test.ts tests/vite/operator-bookings/blocks-api.test.ts tests/vite/operator-bookings/api.test.ts`
Expected: PASS — the new 5 tests plus the two updated key assertions; the added optional param is otherwise backward-compatible.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/vite/operator-bookings/api.ts packages/web/tests/vite/operator-bookings/api-operator-narrow.test.ts packages/web/tests/vite/operator-bookings/api.test.ts packages/web/tests/vite/operator-bookings/blocks-api.test.ts
git commit -m "feat(#1230): thread picked operator into web vehicles+blocks queries (5b)"
```

---

### Task C2: flip the write gates + thread the pick in the route

**Files:**
- Modify: `packages/web/src/routes/$locale/_business/manage/bookings/index.tsx` (import line 8; loader line 84; gates 114/122; locations 136; vehicles 158; blocks 166)
- Test: `packages/web/tests/vite/operator-bookings/OperatorBookingsRoute.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests**

In `packages/web/tests/vite/operator-bookings/OperatorBookingsRoute.test.tsx`, make the picked operator mutable. Add a hoisted holder near `searchState` (after line 25):

```typescript
// #1230 slice 5b: the picked operator, mutable so a test can drive the picker-admin
// write gates. Defaults to undefined (unpicked) so every pre-picker test is unchanged.
const pickedOperator = vi.hoisted(() => ({ value: undefined as string | undefined }))
```

Change the `getRouteApi` mock (lines 38-41) to read it:

```typescript
  getRouteApi: () => ({
    useSearch: () => ({ operator: pickedOperator.value }),
    useNavigate: () => navigate,
  }),
```

Add a reset to the existing `afterEach` (lines 175-179), so a picked test never leaks into the next:

```typescript
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  calendarProps = {}
  pickedOperator.value = undefined
})
```

Seed the picked keys in `renderRoute`. The helper (lines 139-152) currently seeds only the unpicked query keys; with a pick the route reads the picked keys and would suspend on a cache miss. Thread `pickedOperator.value` into all four seeds (default `undefined` keeps every existing test's key identical to today):

```typescript
  for (const range of [weekRange, timelineRange]) {
    queryClient.setQueryData(
      api.operatorCalendarQueryOptions(range.from, range.to, pickedOperator.value).queryKey,
      seed.bookings ?? [],
    )
    queryClient.setQueryData(
      api.operatorCalendarBlocksQueryOptions(range.from, range.to, pickedOperator.value).queryKey,
      seed.blocks ?? [],
    )
  }
  queryClient.setQueryData(
    api.operatorCalendarVehiclesQueryOptions(pickedOperator.value).queryKey,
    vehicles,
  )
  queryClient.setQueryData(operatorLocationsQueryOptions(pickedOperator.value).queryKey, locations)
```

Then add two tests. Place the first inside the manual-booking `describe` (near the existing `renderRoute(bypassSession)` test at line 195), and the second inside the blocks `describe` (near line 293):

```typescript
  it('shows New Booking to a bypass admin who has picked an operator (5b)', () => {
    pickedOperator.value = 'op_1'
    renderRoute(bypassSession, bookableVehicles, [nambaStore])
    expect(screen.getByRole('button', { name: c.action })).toBeInTheDocument()
  })
```

```typescript
  it('shows Schedule to a bypass admin who has picked an operator (5b)', () => {
    pickedOperator.value = 'op_1'
    renderRoute(bypassSession, blocksFleet, [], { blocks: [maintenanceBlock] })
    expect(screen.getByRole('button', { name: B.scheduleAction })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web && bunx vitest run tests/vite/operator-bookings/OperatorBookingsRoute.test.tsx`
Expected: FAIL on the two new tests — the gates still use `isOperatorSession`, so a bypass admin (no operatorId) never sees the buttons, even with a pick. The existing bypass-without-pick tests (lines 195, 293) still PASS (`pickedOperator.value` defaults undefined).

- [ ] **Step 3: Swap the guard import**

In `packages/web/src/routes/$locale/_business/manage/bookings/index.tsx`, change line 8 from `import { isOperatorSession } from '@/vite/guards'` to:

```typescript
import { canWriteAsOperator } from '@/vite/guards'
```

- [ ] **Step 4: Flip the write gates**

In the same file, replace the `canManualBook` line (114):

```typescript
  const canManualBook =
    isOperatorManualBookingEnabled() && canWriteAsOperator(session ?? null, pickedOperatorId)
```

And the `canManageBlocks` line (122):

```typescript
  const canManageBlocks = canViewBlocks && canWriteAsOperator(session ?? null, pickedOperatorId)
```

- [ ] **Step 5: Thread the pick into the locations, vehicles, and blocks queries**

In the same file, replace the locations query (line 136) so it narrows to the picked operator:

```typescript
    ...operatorLocationsQueryOptions(pickedOperatorId),
```

Replace the vehicles suspense query (line 158):

```typescript
  const { data: vehicles } = useSuspenseQuery(operatorCalendarVehiclesQueryOptions(pickedOperatorId))
```

Replace the blocks query options spread (line 166):

```typescript
    ...operatorCalendarBlocksQueryOptions(from, to, pickedOperatorId),
```

- [ ] **Step 6: Warm the picked vehicles query in the loader**

In the same file, replace the vehicles warm in the loader (line 84) so the columns share the component's cache key (no all-operator flash):

```typescript
      context.queryClient.ensureQueryData(operatorCalendarVehiclesQueryOptions(deps.operator)),
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/web && bunx vitest run tests/vite/operator-bookings/OperatorBookingsRoute.test.tsx`
Expected: PASS — the two new tests pass, all existing tests (including bypass-without-pick) still pass.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/routes/$locale/_business/manage/bookings/index.tsx packages/web/tests/vite/operator-bookings/OperatorBookingsRoute.test.tsx
git commit -m "feat(#1230): picker-admin booking/block write gates + scoped calendar (5b)"
```

---

## Final Verification (before PR)

- [ ] **API unit + integration:** `cd packages/api && bunx vitest run` then `export DATABASE_URL=... && bunx vitest run --config vitest.integration.config.ts`
- [ ] **Web:** `cd packages/web && bunx vitest run`
- [ ] **Types (all three packages):** `bun run --filter '*' tsc --noEmit` (or per-package `tsc --noEmit`)
- [ ] **Web build (routeTree):** `bun run --filter @kuruma/web build`
- [ ] **Boundaries + lint + size + modules + i18n parity:** `bun run --filter @kuruma/api lint:boundaries && bun run lint && bun run lint:size && bun run lint:modules`
- [ ] **No migration / no i18n keys added** — confirm `git diff --stat` shows no `drizzle/` or `messages/` changes.
- [ ] Open PR with `Closes #1230`? NO — epic #1230 stays open for slice 6 (Team). Reference the slice in the body; do not auto-close the epic.

---

## Self-Review Notes (author)

- **Spec coverage:** vehicles narrow (A1-A4) = spec §1; blocks narrow (B1-B4) = spec §1b; gate flips + pick threading + loader warm (C2) and query threading (C1) = spec §2; non-goals (customer search, defense-in-depth) require no task by design; test pyramid incl. renter/partner/operator (A2) and legacy STAFF/ADMIN (B3) = spec Testing. Covered.
- **Type consistency:** `requestedOperatorId?: string` third positional arg used consistently for `VehicleService.findAll`, `VehicleBlockService.listBlocks`, and `findOverlappingInRange`; `VehicleFilters.operatorId` set only by the service; web `pickedOperatorId?: string` fourth/second arg on the query fns.
- **The `?operatorId=` empty-string case:** `c.req.query('operatorId')` returns `''` for `?operatorId=`, which is falsy, so the service's `narrowedOperatorId ? {...}` / `narrowReadToOperator`'s `requestedOperatorId` both drop it — no narrow. Verified by the A3 empty-param test.
