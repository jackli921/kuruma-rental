# Operator Combo Deals (class rate plan CRUD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators a portal page to create, edit, activate/deactivate, and delete the class-combo "deals" (`class_rate_plans`) that renters already book — the last unbuilt slice of #464.

**Architecture:** Structural clone of the existing **fee-schedules** feature across `shared` → `api` (routes → services → repositories) → `web`, plus two divergences forced by locked owner decisions: a composite `(operatorId, pickupLocationId)` DB FK for tenant sealing (Q-A), and a service-side publishability check that rejects deals on archived class/location (Q-B). The rate plan is a **singleton** per `(operator, class, location)` — edited in place with an `isActive` toggle, never archive-and-recreate.

**Tech Stack:** TypeScript (strict), Hono + Drizzle (neon), Zod, Bun test + real-pg integration, Vite + TanStack Router + TanStack Query + shadcn, Playwright.

**Locked decisions (design doc `docs/plans/2026-07-12-464-operator-combo-deals-design.md`):**
- Q-A: composite DB FK `(operatorId, pickupLocationId) -> locations(operatorId, id)`; map named `23503` -> 400 `INVALID_LOCATION`. FK target `locations_operatorId_id_unique` already exists.
- Q1: hard delete + `isActive` toggle.
- Q2: unflagged (no `CLASS_COMBO` flag — verified none exists).
- Q-B: reject create/activate against archived class/location (400); deactivate always allowed.
- Q3 (resolved): `label` is operator-only — never reaches the renter DTO.
- Q5: date ranges deferred (columns do not exist; a future slice adds them).

**Reconciliation of Q-A + Q-B:** the composite FKs seal *ownership* at the DB (backstop + clean race mapping); the service still injects the class + location repos' `findById` (narrowed via `Pick<>`) to read *status* for the publishability check. Both earn their place.

**Review status:** reviewed in three rounds (2026-07-12) — code-reviewer + architect agents, then a config/path pass. Verdict *fundamentally sound, cleared after corrections*. All findings folded in. Key fixes:
- Repo layer uses the real `Map` store + `requireManagementRead(ctx)` + `operatorReadScope(ctx)` branch (it returns a `{kind}` union, NOT a bare SQL condition).
- The `update` publishability gate no longer over-fires on plain rate/label edits (Q-B literal scope).
- Route imports `ClassRatePlanFilters` from `services/filters` (layering); integration suite uses the real `createApp` + `app.request` + `authHeaders` template (`vehicle-classes-route-fk.test.ts`); shared subpath exports are mandatory; service deps are `Pick<...,'findById'>` (ISP).
- Migrations output to repo-root `drizzle/` (not `packages/shared/drizzle`); messages are single files per locale (`messages/en.json`); E2E uses `test:e2e:real-db`; base branch is `develop`; the route is registered in `OPERATOR_CONTEXT_ROUTE_IDS`; and the `VITE_CROSS_FEATURE_REACH_IN_BASELINE` ratchet is bumped for the route's feature reach-ins.

---

## File Structure

**Create:**
- `packages/shared/src/types/class-rate-plan.ts` — wire DTO `ClassRatePlanData` (JSON shape, ISO dates).
- `packages/shared/src/validators/class-rate-plan.ts` — create/adminCreate/update Zod schemas + inferred types.
- `packages/api/src/services/class-rate-plan.ts` — `ClassRatePlanService` (business logic, Q-B lifecycle, error mapping).
- `packages/api/src/services/class-rate-plan.test.ts` — service unit tests.
- `packages/api/src/routes/class-rate-plans.ts` — `createClassRatePlanRoutes` (HTTP only).
- `packages/api/tests/integration/class-rate-plans.test.ts` — real-pg route integration.
- `packages/api/src/repositories/in-memory/class-rate-plan.test.ts` — extend (already exists; add CRUD tests).
- `packages/web/src/vite/operator-combo-deals/` — `api.ts`, `OperatorCombosView.tsx`, `ComboRow.tsx`, `ComboForm.tsx`, `AddComboDialog.tsx`, `EditComboDialog.tsx`, `RemoveComboDialog.tsx`, `ComboActiveBadge.tsx`.
- `packages/web/src/routes/$locale/_business/manage/combo-deals.tsx` — operator route.
- `e2e/real-db/operator-combo-deals.auth.spec.ts` — E2E journey.

**Modify:**
- `packages/shared/src/db/pricing.ts:218-280` — swap the simple `pickupLocationId` FK for the composite FK.
- `packages/shared/package.json` — add `./types/class-rate-plan` + `./validators/class-rate-plan` subpath exports (required — no glob).
- `packages/shared/src/lib/error-codes.ts:12` + `error-codes.test.ts:14` — add `INVALID_LOCATION` (source: free slot; test: alphabetical slot).
- `packages/api/src/pg-errors.ts:27-35` — add `CLASS_RATE_PLANS_CLASS_FK`, `CLASS_RATE_PLANS_LOCATION_FK`.
- `packages/api/src/repositories/types-pricing.ts` — extend `ClassRatePlanRepository` + `ClassRatePlanFilters`.
- `packages/api/src/services/filters.ts` — re-export `ClassRatePlanFilters` (so the route imports it without touching `repositories/`).
- `packages/api/src/repositories/in-memory/class-rate-plan.ts` — add ctx-scoped CRUD (Map store) + `23505` simulation.
- `packages/api/src/repositories/drizzle/class-rate-plan.ts` — add ctx-scoped CRUD (scope-branch preamble).
- `packages/api/src/index.ts:~533,~652` — construct `ClassRatePlanService`, mount routes.
- `packages/api/src/wire-contract.test.ts` — fence `ClassRatePlan` row to `ClassRatePlanData` (`Exact<Jsonified<...>>`).
- `packages/web/src/vite/nav/business-nav-items.ts:23` — add `combo-deals` nav item.
- `packages/web/messages/{en,ja,zh}.json` (one file per locale — NOT per-namespace files) — add `nav.comboDeals` + a `business.comboDeals` namespace.
- `packages/web/src/vite/operator-context/operator-context.ts:97` — register `/$locale/_business/manage/combo-deals` in `OPERATOR_CONTEXT_ROUTE_IDS` (else platform-admins lose the operator picker).
- `scripts/lint-module-boundaries.ts:116` — bump `VITE_CROSS_FEATURE_REACH_IN_BASELINE` for the route's feature reach-ins (see Task 7 Step 4).

---

## Task 1: Composite location FK + pg-errors constants + migration

**Files:**
- Modify: `packages/shared/src/db/pricing.ts:218-280`
- Modify: `packages/api/src/pg-errors.ts:27-35`
- Create (generated): `drizzle/0NNN_*.sql` — **repo root** (`drizzle.config.ts` `out: './drizzle'`), NOT `packages/shared/drizzle`.

- [ ] **Step 1: Add the pg-errors constants**

In `packages/api/src/pg-errors.ts`, right after `FEE_SCHEDULES_CLASS_FK` (:35), add:

```typescript
// #464 slice 6: class_rate_plans tenant seals. The class FK already exists in
// the schema (pricing.ts); the location FK is added in this slice. Named so the
// service maps each 23503 to the right 400 code.
export const CLASS_RATE_PLANS_CLASS_FK = 'class_rate_plans_operator_class_fk'
export const CLASS_RATE_PLANS_LOCATION_FK = 'class_rate_plans_operator_location_fk'
```

- [ ] **Step 2: Swap the simple location FK for a composite FK in the schema**

In `packages/shared/src/db/pricing.ts`, in the `classRatePlans` column block, change the `pickupLocationId` column (:235-237) from the inline reference to a bare column:

```typescript
    // Per-location. Ownership is sealed by the composite FK below (Q-A #464
    // slice 6), mirroring vehicles' (operatorId, pickupLocationId) seal.
    pickupLocationId: text('pickupLocationId').notNull(),
```

Then, in the table-extras array, immediately after the composite class FK block (`class_rate_plans_operator_class_fk`, :273-277), add:

```typescript
    // Composite FK seal (Q-A #464 slice 6): the pickup location must belong to
    // the SAME operator. Mirrors vehicles_operatorId_pickupLocationId_fk. The FK
    // target locations_operatorId_id_unique already exists (location.ts:91).
    // pickupLocationId leads idx_class_rate_plans_pickup_location and operatorId
    // leads idx_class_rate_plans_operator, so both FK columns keep their cover.
    foreignKey({
      columns: [table.operatorId, table.pickupLocationId],
      foreignColumns: [locations.operatorId, locations.id],
      name: 'class_rate_plans_operator_location_fk',
    }),
```

Confirm `locations` and `foreignKey` are already imported in `pricing.ts` (they are — the class FK uses `foreignKey`, and `pickupLocationId` referenced `locations`).

- [ ] **Step 3: Generate the migration**

Run: `bun run db:generate --name class_rate_plans_location_composite_fk`
Expected: a new `drizzle/0NNN_*.sql` dropping the old `class_rate_plans_pickupLocationId_locations_id_fk` and adding `class_rate_plans_operator_location_fk`. Open it and confirm it only touches that FK (no unintended drops).

- [ ] **Step 4: Apply + verify**

Run: `bun run db:migrate` then `bun run db:verify`
Expected: migrate succeeds; `db:verify` shows **3 green checks**.
(Local darwin gotcha: if `db:migrate` exits 1 on a one-tx rollback, apply the generated `drizzle/0NNN_*.sql` via `docker exec -i <pg> psql`; CI migrates fine on Linux.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/db/pricing.ts packages/api/src/pg-errors.ts drizzle
git commit -m "feat(#464): composite (operator, pickupLocation) FK on class_rate_plans"
```

---

## Task 2: Add `INVALID_LOCATION` error code

**Files:**
- Modify: `packages/shared/src/lib/error-codes.ts:12`
- Modify: `packages/shared/src/lib/error-codes.test.ts:14-42`

- [ ] **Step 1: Update the exhaustive test first (RED)**

The test asserts `[...ERROR_CODES].sort()` equals a hard-coded alphabetical list, so `INVALID_LOCATION` must go in its correct **alphabetical** slot: between `INVALID_DURATION` and `INVALID_STATUS` (i.e. `... INVALID_DURATION, INVALID_LOCATION, INVALID_STATUS ...`) — NOT next to `INVALID_VEHICLE_CLASS`. Add it there in `error-codes.test.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --filter @kuruma/shared test error-codes`
Expected: FAIL — the `ERROR_CODES` set does not yet contain `INVALID_LOCATION`.

- [ ] **Step 3: Add the code (GREEN)**

In `error-codes.ts` the `ERROR_CODES` array is **grouped by feature (not sorted)**, so placement in the SOURCE is free — add `'INVALID_LOCATION'` near the other route/handler codes (by `'INVALID_VEHICLE_CLASS'`) with a `// #464 slice 6` comment matching the file's convention:

```typescript
  'INVALID_LOCATION', // #464 slice 6
```

(Only the TEST list is alphabetical — Step 1 handled that slot.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --filter @kuruma/shared test error-codes`
Expected: PASS (both the sorted-set test and the no-duplicates test).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/lib/error-codes.ts packages/shared/src/lib/error-codes.test.ts
git commit -m "feat(#464): add INVALID_LOCATION error code"
```

---

## Task 3: Shared wire DTO + validators

**Files:**
- Create: `packages/shared/src/types/class-rate-plan.ts`
- Create: `packages/shared/src/validators/class-rate-plan.ts`
- Create: `packages/shared/src/validators/class-rate-plan.test.ts`
- Modify: `packages/shared/package.json` (subpath export, if not glob) — verify `./types/*` and `./validators/*` subpaths resolve; add if the package uses explicit per-file exports.

- [ ] **Step 1: Create the wire DTO**

`packages/shared/src/types/class-rate-plan.ts`:

```typescript
// JSON-serialized ClassRatePlan wire shape (#464 slice 6). Dates cross the wire
// as ISO strings. The api repo row is fenced to this DTO in wire-contract.test.ts
// and the web Zod schema pins to it with `satisfies` — a producer-side field
// drift then fails to compile at both ends. Pure type module, no runtime deps.
export interface ClassRatePlanData {
  id: string
  operatorId: string
  classId: string
  pickupLocationId: string
  dayRateJpy: number
  isActive: boolean
  // Operator-only display name (Q3). Never surfaced to renters.
  label: string | null
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: Write the failing validator test (RED)**

`packages/shared/src/validators/class-rate-plan.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import {
  createClassRatePlanSchema,
  updateClassRatePlanSchema,
  platformAdminCreateClassRatePlanSchema,
} from './class-rate-plan'

const uuid = '11111111-1111-1111-1111-111111111111'

describe('createClassRatePlanSchema', () => {
  test('accepts a well-formed deal', () => {
    const r = createClassRatePlanSchema.safeParse({
      classId: uuid,
      pickupLocationId: uuid,
      dayRateJpy: 8000,
    })
    expect(r.success).toBe(true)
  })

  test('rejects a negative day rate', () => {
    const r = createClassRatePlanSchema.safeParse({
      classId: uuid,
      pickupLocationId: uuid,
      dayRateJpy: -1,
    })
    expect(r.success).toBe(false)
  })

  test('rejects a non-uuid classId', () => {
    const r = createClassRatePlanSchema.safeParse({
      classId: 'not-a-uuid',
      pickupLocationId: uuid,
      dayRateJpy: 8000,
    })
    expect(r.success).toBe(false)
  })
})

describe('platformAdminCreateClassRatePlanSchema', () => {
  test('requires operatorId', () => {
    const r = platformAdminCreateClassRatePlanSchema.safeParse({
      classId: uuid,
      pickupLocationId: uuid,
      dayRateJpy: 8000,
    })
    expect(r.success).toBe(false)
  })
})

describe('updateClassRatePlanSchema', () => {
  test('accepts a partial patch (isActive only)', () => {
    const r = updateClassRatePlanSchema.safeParse({ isActive: false })
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `bun run --filter @kuruma/shared test class-rate-plan`
Expected: FAIL — module `./class-rate-plan` not found.

- [ ] **Step 4: Create the validators (GREEN)**

`packages/shared/src/validators/class-rate-plan.ts`:

```typescript
import { z } from 'zod'
import { jpyAmount } from './money'

// #464 slice 6 operator CRUD for class-combo deals. No fee-type/unit coherence
// rule (simpler than fee schedules). Ownership of classId/pickupLocationId is
// sealed by the composite DB FKs; publishability (not archived) is checked in
// the service (Q-B). `label` is operator-only (Q3).
const objectSchema = z.object({
  classId: z.string().uuid('classId must be a UUID'),
  pickupLocationId: z.string().uuid('pickupLocationId must be a UUID'),
  dayRateJpy: jpyAmount('Day rate'),
  label: z.string().trim().min(1).max(80).nullish(),
  isActive: z.boolean().optional(),
})

export const createClassRatePlanSchema = objectSchema

// Platform-admin writes are cross-tenant, so they MUST name the operator
// (mirrors platformAdminCreateFeeScheduleSchema). Operator callers never send it.
export const platformAdminCreateClassRatePlanSchema = objectSchema.extend({
  operatorId: z.string().trim().min(1, 'operatorId is required'),
})

// PATCH carries any subset.
export const updateClassRatePlanSchema = objectSchema.partial()

export type CreateClassRatePlanInput = z.infer<typeof createClassRatePlanSchema>
export type CreateClassRatePlanFormInput = z.input<typeof createClassRatePlanSchema>
export type PlatformAdminCreateClassRatePlanInput = z.infer<
  typeof platformAdminCreateClassRatePlanSchema
>
export type UpdateClassRatePlanInput = z.infer<typeof updateClassRatePlanSchema>
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun run --filter @kuruma/shared test class-rate-plan`
Expected: PASS (all 5 cases).

- [ ] **Step 6: Add the subpath exports (REQUIRED — not conditional)**

`packages/shared` uses **explicit per-file `exports`** (no `./types/*` glob), so `@kuruma/shared/types/class-rate-plan` and `.../validators/class-rate-plan` will NOT resolve until you add them. In `packages/shared/package.json` `exports`, mirror the `fee-schedule` entries:

```jsonc
"./types/class-rate-plan": "./src/types/class-rate-plan.ts",
"./validators/class-rate-plan": "./src/validators/class-rate-plan.ts",
```

Then run: `bun run --filter @kuruma/shared exec tsc --noEmit` — expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types/class-rate-plan.ts packages/shared/src/validators/class-rate-plan.ts packages/shared/src/validators/class-rate-plan.test.ts packages/shared/package.json
git commit -m "feat(#464): ClassRatePlanData DTO + operator CRUD validators"
```

---

## Task 4: Repository port + in-memory + drizzle CRUD

**Files:**
- Modify: `packages/api/src/repositories/types-pricing.ts`
- Modify: `packages/api/src/repositories/in-memory/class-rate-plan.ts`
- Modify: `packages/api/src/repositories/in-memory/class-rate-plan.test.ts`
- Modify: `packages/api/src/repositories/drizzle/class-rate-plan.ts`

- [ ] **Step 1: Extend the port**

In `types-pricing.ts`, add `CallerContext` import and extend the interface + filters:

```typescript
import type { CallerContext } from '../middleware/auth'
// ...existing imports...

export interface ClassRatePlanFilters {
  operatorId?: string
  locationIds?: string[]
  classId?: string
  pickupLocationId?: string
  isActive?: boolean
}

export interface ClassRatePlanRepository {
  // --- read/pricing (existing, unchanged) ---
  findActiveRate(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<ClassRatePlan | undefined>
  findActiveRatePlans(filters?: ClassRatePlanFilters): Promise<ClassRatePlan[]>
  create(data: Omit<ClassRatePlan, 'id' | 'createdAt' | 'updatedAt'>): Promise<ClassRatePlan>

  // --- operator CRUD (#464 slice 6) ---
  findAll(ctx: CallerContext, filters: ClassRatePlanFilters): Promise<ClassRatePlan[]>
  findById(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined>
  // Scope-only singleton lookup (ignores isActive) for the 409 pre-check.
  findByScope(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<ClassRatePlan | undefined>
  update(
    ctx: CallerContext,
    id: string,
    patch: Partial<Pick<ClassRatePlan, 'classId' | 'pickupLocationId' | 'dayRateJpy' | 'isActive' | 'label'>>,
  ): Promise<ClassRatePlan | undefined>
  remove(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined>
}
```

- [ ] **Step 2: Write the failing in-memory repo test (RED)**

Append to `packages/api/src/repositories/in-memory/class-rate-plan.test.ts` (mirror the CallerContext construction used by `in-memory/fee-schedule.test.ts` — copy its `ctx` helper):

```typescript
import { PG_ERROR } from '../../pg-errors'

const OP = 'op-1'
const CLS = 'cls-1'
const LOC = 'loc-1'
// ctx: an operator caller bound to OP — copy the exact helper shape from
// in-memory/fee-schedule.test.ts (CallerContext for role FLEET_MANAGER, operatorId OP).

test('findByScope returns the singleton regardless of isActive', async () => {
  const repo = new InMemoryClassRatePlanRepository()
  const created = await repo.create({
    operatorId: OP, classId: CLS, pickupLocationId: LOC,
    dayRateJpy: 8000, isActive: false, label: null,
  })
  const found = await repo.findByScope(OP, CLS, LOC)
  expect(found?.id).toBe(created.id)
})

test('create twice on the same scope throws a 23505', async () => {
  const repo = new InMemoryClassRatePlanRepository()
  const base = { operatorId: OP, classId: CLS, pickupLocationId: LOC, dayRateJpy: 8000, isActive: true, label: null }
  await repo.create(base)
  await expect(repo.create(base)).rejects.toMatchObject({ code: PG_ERROR.UNIQUE_VIOLATION })
})

test('update patches dayRateJpy in place', async () => {
  const repo = new InMemoryClassRatePlanRepository()
  const c = await repo.create({ operatorId: OP, classId: CLS, pickupLocationId: LOC, dayRateJpy: 8000, isActive: true, label: null })
  const u = await repo.update(ctx, c.id, { dayRateJpy: 9500 })
  expect(u?.dayRateJpy).toBe(9500)
})

test('remove deletes the row (findById -> undefined after)', async () => {
  const repo = new InMemoryClassRatePlanRepository()
  const c = await repo.create({ operatorId: OP, classId: CLS, pickupLocationId: LOC, dayRateJpy: 8000, isActive: true, label: null })
  await repo.remove(ctx, c.id)
  expect(await repo.findById(ctx, c.id)).toBeUndefined()
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `bun run --filter @kuruma/api test in-memory/class-rate-plan`
Expected: FAIL — `findByScope`/`update`/`remove` are not functions.

- [ ] **Step 4: Implement the in-memory CRUD (GREEN)**

The existing repo stores `private readonly store: Map<string, ClassRatePlan>` — **keep the `Map`; do NOT switch to an array**. Mirror `in-memory/fee-schedule.ts` method-for-method: every scoped method calls `requireManagementRead(ctx)` first (rejects RENTER/PARTNER before `operatorReadScope` maps them to `all`), then branches on `operatorReadScope(ctx)` (a `{ kind: 'all' | 'operator' | 'none' }` discriminated union — NOT SQL).

```typescript
import { PG_ERROR } from '../../pg-errors'
import { operatorReadScope, requireManagementRead } from '../../tenancy'
// existing imports + CallerContext, ClassRatePlanFilters

  async findAll(ctx: CallerContext, filters: ClassRatePlanFilters): Promise<ClassRatePlan[]> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []
    return [...this.store.values()].filter((p) => {
      if (scope.kind === 'operator' && p.operatorId !== scope.operatorId) return false
      if (filters.operatorId && p.operatorId !== filters.operatorId) return false
      if (filters.classId && p.classId !== filters.classId) return false
      if (filters.pickupLocationId && p.pickupLocationId !== filters.pickupLocationId) return false
      if (filters.isActive !== undefined && p.isActive !== filters.isActive) return false
      return true
    })
  }

  async findById(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const plan = this.store.get(id)
    if (!plan) return undefined
    // Repo-layer tenant seal (#1288 defense-in-depth): an operator caller never
    // reads another operator's plan by id, even if a service guard is bypassed.
    if (scope.kind === 'operator' && plan.operatorId !== scope.operatorId) return undefined
    return plan
  }

  // NOT ctx-scoped: the service passes an already-resolved operatorId; the DB
  // UNIQUE is the real seal. Never wire this to a route.
  async findByScope(operatorId: string, classId: string, pickupLocationId: string) {
    return [...this.store.values()].find(
      (p) => p.operatorId === operatorId && p.classId === classId && p.pickupLocationId === pickupLocationId,
    )
  }

  async update(
    ctx: CallerContext,
    id: string,
    patch: Partial<Pick<ClassRatePlan, 'classId' | 'pickupLocationId' | 'dayRateJpy' | 'isActive' | 'label'>>,
  ): Promise<ClassRatePlan | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    const current = this.store.get(id)
    if (!current) return undefined
    if (scope.kind === 'operator' && current.operatorId !== scope.operatorId) return undefined
    // Pin server-owned columns (id/operatorId/createdAt): a patch can never
    // migrate the row across tenants, and updatedAt bumps (parity with drizzle).
    const next: ClassRatePlan = {
      ...current,
      ...patch,
      id: current.id,
      operatorId: current.operatorId,
      createdAt: current.createdAt,
      updatedAt: new Date(),
    }
    if (
      [...this.store.values()].some(
        (p) => p.id !== id && p.operatorId === next.operatorId && p.classId === next.classId && p.pickupLocationId === next.pickupLocationId,
      )
    ) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: PG_ERROR.UNIQUE_VIOLATION,
      })
    }
    this.store.set(id, next)
    return next
  }

  async remove(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    const current = this.store.get(id)
    if (!current) return undefined
    if (scope.kind === 'operator' && current.operatorId !== scope.operatorId) return undefined
    this.store.delete(id)
    return current
  }
```

Also make `create` throw a `23505` when a scope duplicate exists (mirror `in-memory/fee-schedule.ts:33-37`), keeping the `Map` insert:

```typescript
  async create(data) {
    if (await this.findByScope(data.operatorId, data.classId, data.pickupLocationId)) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: PG_ERROR.UNIQUE_VIOLATION,
      })
    }
    // ...existing insert (this.store.set(id, plan) with generated id/timestamps)...
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun run --filter @kuruma/api test in-memory/class-rate-plan`
Expected: PASS.

- [ ] **Step 6: Implement the drizzle CRUD**

In `drizzle/class-rate-plan.ts`, copy the `drizzle/fee-schedule.ts` scope preamble exactly. **`operatorReadScope(ctx)` returns a `{ kind: 'all' | 'operator' | 'none' }` union — it is NOT an `SQL` condition**, so you branch on `scope.kind` and only push `eq(operatorId, scope.operatorId)` in the `'operator'` branch. Every method calls `requireManagementRead(ctx)` first.

```typescript
import { and, eq, type SQL } from 'drizzle-orm'
import { operatorReadScope, requireManagementRead } from '../../tenancy'
// classRatePlanColumns, toClassRatePlan from './shared'; classRatePlans schema; CallerContext

  async findAll(ctx: CallerContext, filters: ClassRatePlanFilters): Promise<ClassRatePlan[]> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return []
    const conditions: SQL[] = []
    if (scope.kind === 'operator') conditions.push(eq(classRatePlans.operatorId, scope.operatorId))
    if (filters.operatorId) conditions.push(eq(classRatePlans.operatorId, filters.operatorId))
    if (filters.classId) conditions.push(eq(classRatePlans.classId, filters.classId))
    if (filters.pickupLocationId) conditions.push(eq(classRatePlans.pickupLocationId, filters.pickupLocationId))
    if (filters.isActive !== undefined) conditions.push(eq(classRatePlans.isActive, filters.isActive))
    const rows = await this.db
      .select(classRatePlanColumns)
      .from(classRatePlans)
      .where(conditions.length ? and(...conditions) : undefined)
    return rows.map(toClassRatePlan)
  }

  async findById(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(classRatePlans.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(classRatePlans.operatorId, scope.operatorId))
    const [row] = await this.db.select(classRatePlanColumns).from(classRatePlans).where(and(...conditions))
    return row ? toClassRatePlan(row) : undefined
  }

  // NOT ctx-scoped: the service passes a resolved operatorId; the DB UNIQUE is
  // the seal. Never wire this to a route.
  async findByScope(operatorId: string, classId: string, pickupLocationId: string) {
    const [row] = await this.db.select(classRatePlanColumns).from(classRatePlans).where(
      and(
        eq(classRatePlans.operatorId, operatorId),
        eq(classRatePlans.classId, classId),
        eq(classRatePlans.pickupLocationId, pickupLocationId),
      ),
    )
    return row ? toClassRatePlan(row) : undefined
  }

  async update(
    ctx: CallerContext,
    id: string,
    patch: Partial<Pick<ClassRatePlan, 'classId' | 'pickupLocationId' | 'dayRateJpy' | 'isActive' | 'label'>>,
  ): Promise<ClassRatePlan | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(classRatePlans.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(classRatePlans.operatorId, scope.operatorId))
    // `patch` type excludes id/operatorId/createdAt, so no tenant-migration strip
    // is needed (unlike the fee-schedule DTO). updatedAt bumps for parity.
    const [row] = await this.db
      .update(classRatePlans)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(...conditions))
      .returning()
    return row ? toClassRatePlan(row) : undefined
  }

  async remove(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined> {
    requireManagementRead(ctx)
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(classRatePlans.id, id)]
    if (scope.kind === 'operator') conditions.push(eq(classRatePlans.operatorId, scope.operatorId))
    const [row] = await this.db.delete(classRatePlans).where(and(...conditions)).returning()
    return row ? toClassRatePlan(row) : undefined
  }
```

- [ ] **Step 7: Typecheck**

Run: `bun run --filter @kuruma/api exec tsc --noEmit`
Expected: no errors (the interface and both impls agree).

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/repositories/types-pricing.ts packages/api/src/repositories/in-memory/class-rate-plan.ts packages/api/src/repositories/in-memory/class-rate-plan.test.ts packages/api/src/repositories/drizzle/class-rate-plan.ts
git commit -m "feat(#464): class-rate-plan repo CRUD (in-memory + drizzle)"
```

---

## Task 5: `ClassRatePlanService` (business logic, Q-B, error mapping)

**Files:**
- Create: `packages/api/src/services/class-rate-plan.ts`
- Create: `packages/api/src/services/class-rate-plan.test.ts`

- [ ] **Step 1: Write failing service tests (RED)**

`packages/api/src/services/class-rate-plan.test.ts` — use `InMemoryClassRatePlanRepository` plus small stub class/location repos exposing `findById`:

```typescript
import { describe, expect, test } from 'bun:test'
import { InMemoryClassRatePlanRepository } from '../repositories/in-memory/class-rate-plan'
import type { Location, VehicleClass } from '../stores'
import type { LocationRepository, VehicleClassRepository } from '../repositories/types'
import { ClassRatePlanService } from './class-rate-plan'

const OP = 'op-1', CLS = 'cls-1', LOC = 'loc-1'
// ctx: an operator caller bound to OP. Reuse the sibling test's helper — copy
// `operatorCtx`/`ctxFor` from `fee-schedule.test.ts` (a real CallerContext for a
// FLEET_MANAGER on OP) rather than hand-rolling the shape.
const ctx = operatorCtx(OP)
const activeClass = { id: CLS, operatorId: OP, status: 'ACTIVE' as const }
const activeLoc = { id: LOC, operatorId: OP, status: 'ACTIVE' as const }
// Typed stubs: declare they implement ONLY findById (the service's real need),
// and cast the partial to the entity the service reads (id/operatorId/status).
// No `as any` on the whole repo — the Pick<> contract keeps it honest.
const stubClassRepo = (cls: Pick<VehicleClass, 'id' | 'operatorId' | 'status'>): Pick<VehicleClassRepository, 'findById'> => ({
  findById: async () => cls as VehicleClass,
})
const stubLocRepo = (loc: Pick<Location, 'id' | 'operatorId' | 'status'>): Pick<LocationRepository, 'findById'> => ({
  findById: async () => loc as Location,
})
const base = { operatorId: OP, classId: CLS, pickupLocationId: LOC, dayRateJpy: 8000, isActive: true, label: null }

test('create succeeds for an active class + location', async () => {
  const svc = new ClassRatePlanService(new InMemoryClassRatePlanRepository(), stubClassRepo(activeClass), stubLocRepo(activeLoc))
  const r = await svc.create(ctx, base)
  expect(r.ok).toBe(true)
  if (r.ok) expect(r.plan.dayRateJpy).toBe(8000)
})

test('create rejects a duplicate scope with 409', async () => {
  const repo = new InMemoryClassRatePlanRepository()
  const svc = new ClassRatePlanService(repo, stubClassRepo(activeClass), stubLocRepo(activeLoc))
  await svc.create(ctx, base)
  const r = await svc.create(ctx, base)
  expect(r).toMatchObject({ ok: false, status: 409 })
})

test('create rejects an archived class with 400 INVALID_VEHICLE_CLASS', async () => {
  const svc = new ClassRatePlanService(new InMemoryClassRatePlanRepository(), stubClassRepo({ ...activeClass, status: 'ARCHIVED' }), stubLocRepo(activeLoc))
  const r = await svc.create(ctx, base)
  expect(r).toMatchObject({ ok: false, status: 400, code: 'INVALID_VEHICLE_CLASS' })
})

test('create rejects an archived location with 400 INVALID_LOCATION', async () => {
  const svc = new ClassRatePlanService(new InMemoryClassRatePlanRepository(), stubClassRepo(activeClass), stubLocRepo({ ...activeLoc, status: 'ARCHIVED' }))
  const r = await svc.create(ctx, base)
  expect(r).toMatchObject({ ok: false, status: 400, code: 'INVALID_LOCATION' })
})

test('create rejects a cross-operator location with 400 INVALID_LOCATION', async () => {
  const svc = new ClassRatePlanService(new InMemoryClassRatePlanRepository(), stubClassRepo(activeClass), stubLocRepo({ ...activeLoc, operatorId: 'other' }))
  const r = await svc.create(ctx, base)
  expect(r).toMatchObject({ ok: false, status: 400, code: 'INVALID_LOCATION' })
})

test('update that ACTIVATES against an archived class is rejected 400', async () => {
  const repo = new InMemoryClassRatePlanRepository()
  const svc = new ClassRatePlanService(repo, stubClassRepo(activeClass), stubLocRepo(activeLoc))
  const c = await svc.create(ctx, { ...base, isActive: false })
  if (!c.ok) throw new Error('setup')
  const svc2 = new ClassRatePlanService(repo, stubClassRepo({ ...activeClass, status: 'ARCHIVED' }), stubLocRepo(activeLoc))
  const r = await svc2.update(ctx, c.plan.id, { isActive: true })
  expect(r).toMatchObject({ ok: false, status: 400, code: 'INVALID_VEHICLE_CLASS' })
})

test('deactivate (isActive=false) is always allowed even if class archived', async () => {
  const repo = new InMemoryClassRatePlanRepository()
  const c = await new ClassRatePlanService(repo, stubClassRepo(activeClass), stubLocRepo(activeLoc)).create(ctx, base)
  if (!c.ok) throw new Error('setup')
  const svc = new ClassRatePlanService(repo, stubClassRepo({ ...activeClass, status: 'ARCHIVED' }), stubLocRepo(activeLoc))
  const r = await svc.update(ctx, c.plan.id, { isActive: false })
  expect(r.ok).toBe(true)
})

// Regression (review HIGH): a plain rate/label edit is neither an activation nor
// a retarget, so it must NOT re-run publishability — an operator can still fix a
// live deal's price after its class was archived.
test('a rate-only edit of an active deal is allowed even after its class archived', async () => {
  const repo = new InMemoryClassRatePlanRepository()
  const c = await new ClassRatePlanService(repo, stubClassRepo(activeClass), stubLocRepo(activeLoc)).create(ctx, base)
  if (!c.ok) throw new Error('setup')
  const svc = new ClassRatePlanService(repo, stubClassRepo({ ...activeClass, status: 'ARCHIVED' }), stubLocRepo(activeLoc))
  const r = await svc.update(ctx, c.plan.id, { dayRateJpy: 9500 })
  expect(r.ok).toBe(true)
  if (r.ok) expect(r.plan.dayRateJpy).toBe(9500)
})

test('remove deletes and returns the plan', async () => {
  const repo = new InMemoryClassRatePlanRepository()
  const c = await new ClassRatePlanService(repo, stubClassRepo(activeClass), stubLocRepo(activeLoc)).create(ctx, base)
  if (!c.ok) throw new Error('setup')
  const svc = new ClassRatePlanService(repo, stubClassRepo(activeClass), stubLocRepo(activeLoc))
  const r = await svc.remove(ctx, c.plan.id)
  expect(r.ok).toBe(true)
  expect(await repo.findById(ctx, c.plan.id)).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run --filter @kuruma/api test services/class-rate-plan`
Expected: FAIL — module `./class-rate-plan` not found.

- [ ] **Step 3: Implement the service (GREEN)**

`packages/api/src/services/class-rate-plan.ts`:

```typescript
import type { ErrorCode } from '@kuruma/shared/lib/error-codes'
import type { CallerContext } from '../middleware/auth'
import {
  CLASS_RATE_PLANS_CLASS_FK,
  CLASS_RATE_PLANS_LOCATION_FK,
  PG_ERROR,
  pgConstraintName,
  pgErrorCode,
} from '../pg-errors'
import type { ClassRatePlan } from '../stores'
import type { ClassRatePlanFilters, ClassRatePlanRepository } from '../repositories/types'
import type { LocationRepository, VehicleClassRepository } from '../repositories/types'
import {
  type CrossOperatorRead,
  applyCrossOperatorReadScope,
  assertFleetWriteWithinOperator,
  fleetWriteDenialResult,
} from '../tenancy'

export type ClassRatePlanResult =
  | { ok: true; plan: ClassRatePlan }
  | { ok: false; error: string; status: number; code?: string }

export type ClassRatePlanUpdate = Partial<
  Pick<ClassRatePlan, 'classId' | 'pickupLocationId' | 'dayRateJpy' | 'isActive' | 'label'>
>

const DUPLICATE_SCOPE = 'A deal already exists for this class at this location. Edit it instead.'
const NOT_FOUND = 'Combo deal not found'
const INVALID_CLASS_MSG = 'Invalid or archived vehicle class'
const INVALID_LOCATION_MSG = 'Invalid or archived pickup location'

const invalidClass = (): ClassRatePlanResult => ({
  ok: false, error: INVALID_CLASS_MSG, status: 400, code: 'INVALID_VEHICLE_CLASS' satisfies ErrorCode,
})
const invalidLocation = (): ClassRatePlanResult => ({
  ok: false, error: INVALID_LOCATION_MSG, status: 400, code: 'INVALID_LOCATION' satisfies ErrorCode,
})
const duplicate = (): ClassRatePlanResult => ({ ok: false, error: DUPLICATE_SCOPE, status: 409 })

const isDuplicate = (err: unknown) => pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION
const isClassFk = (err: unknown) =>
  pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION && pgConstraintName(err) === CLASS_RATE_PLANS_CLASS_FK
const isLocationFk = (err: unknown) =>
  pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION && pgConstraintName(err) === CLASS_RATE_PLANS_LOCATION_FK

export class ClassRatePlanService {
  // ISP: the service reads only `findById` from the class/location repos (for
  // status), so it depends on exactly that method — not the whole 5+-method
  // interfaces. Composition passes the concrete repos (structurally assignable).
  constructor(
    private readonly repo: ClassRatePlanRepository,
    private readonly classRepo: Pick<VehicleClassRepository, 'findById'>,
    private readonly locationRepo: Pick<LocationRepository, 'findById'>,
  ) {}

  async findAll(ctx: CallerContext, read: CrossOperatorRead, filters: ClassRatePlanFilters = {}): Promise<ClassRatePlan[]> {
    return this.repo.findAll(ctx, applyCrossOperatorReadScope(ctx, read, filters))
  }

  async findById(ctx: CallerContext, id: string): Promise<ClassRatePlan | undefined> {
    return this.repo.findById(ctx, id)
  }

  async create(ctx: CallerContext, data: Omit<ClassRatePlan, 'id' | 'createdAt' | 'updatedAt'>): Promise<ClassRatePlanResult> {
    const publishable = await this.assertPublishable(ctx, data.operatorId, data.classId, data.pickupLocationId)
    if (publishable) return publishable

    if (await this.repo.findByScope(data.operatorId, data.classId, data.pickupLocationId)) return duplicate()

    try {
      return { ok: true, plan: await this.repo.create(data) }
    } catch (err) {
      return this.mapWriteError(err) ?? this.rethrow(err)
    }
  }

  async update(ctx: CallerContext, id: string, data: ClassRatePlanUpdate, actingOperatorId?: string): Promise<ClassRatePlanResult> {
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND, status: 404 }

    const denial = assertFleetWriteWithinOperator(ctx, existing.operatorId, actingOperatorId)
    if (denial) return fleetWriteDenialResult(denial, NOT_FOUND)

    const mergedClassId = data.classId ?? existing.classId
    const mergedLocationId = data.pickupLocationId ?? existing.pickupLocationId
    const mergedActive = data.isActive ?? existing.isActive
    const targetChanged = mergedClassId !== existing.classId || mergedLocationId !== existing.pickupLocationId
    const activating = mergedActive && !existing.isActive

    // Q-B (design §3, literal scope): publishability runs ONLY when the PATCH
    // ACTIVATES the deal or RETARGETS its class/location — never on a plain
    // rate/label edit of an already-active deal. This lets an operator repair the
    // price of a live deal whose class/location was archived after creation.
    // (Dropping the `existing.isActive` disjunct — review HIGH.)
    if (activating || (mergedActive && targetChanged)) {
      const publishable = await this.assertPublishable(ctx, existing.operatorId, mergedClassId, mergedLocationId)
      if (publishable) return publishable
    }

    if (targetChanged) {
      const clash = await this.repo.findByScope(existing.operatorId, mergedClassId, mergedLocationId)
      if (clash && clash.id !== id) return duplicate()
    }

    try {
      const updated = await this.repo.update(ctx, id, data)
      if (!updated) return { ok: false, error: NOT_FOUND, status: 404 }
      return { ok: true, plan: updated }
    } catch (err) {
      return this.mapWriteError(err) ?? this.rethrow(err)
    }
  }

  async remove(ctx: CallerContext, id: string, actingOperatorId?: string): Promise<ClassRatePlanResult> {
    const existing = await this.repo.findById(ctx, id)
    if (!existing) return { ok: false, error: NOT_FOUND, status: 404 }
    const denial = assertFleetWriteWithinOperator(ctx, existing.operatorId, actingOperatorId)
    if (denial) return fleetWriteDenialResult(denial, NOT_FOUND)
    const removed = await this.repo.remove(ctx, id)
    if (!removed) return { ok: false, error: NOT_FOUND, status: 404 }
    return { ok: true, plan: removed }
  }

  // Reads status via caller-scoped findById and asserts same-operator (matters
  // for a bypass admin whose findById is not tenant-clamped). The composite FKs
  // are the DB backstop; this gives a clean pre-write 400.
  private async assertPublishable(ctx: CallerContext, operatorId: string, classId: string, locationId: string): Promise<ClassRatePlanResult | null> {
    const cls = await this.classRepo.findById(ctx, classId)
    if (!cls || cls.operatorId !== operatorId || cls.status === 'ARCHIVED') return invalidClass()
    const loc = await this.locationRepo.findById(ctx, locationId)
    if (!loc || loc.operatorId !== operatorId || loc.status === 'ARCHIVED') return invalidLocation()
    return null
  }

  private mapWriteError(err: unknown): ClassRatePlanResult | null {
    if (isDuplicate(err)) return duplicate()
    if (isClassFk(err)) return invalidClass()
    if (isLocationFk(err)) return invalidLocation()
    return null
  }

  private rethrow(err: unknown): never {
    throw err
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun run --filter @kuruma/api test services/class-rate-plan`
Expected: PASS (all cases).

- [ ] **Step 5: Sabotage-verify a gate**

Temporarily change `assertPublishable` to `return null` always. Run the tests. Expected: the archived-class/location/cross-operator tests go RED. Revert.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/class-rate-plan.ts packages/api/src/services/class-rate-plan.test.ts
git commit -m "feat(#464): ClassRatePlanService with publishability + error mapping"
```

---

## Task 6: Routes + composition wiring + wire-contract fence

**Files:**
- Create: `packages/api/src/routes/class-rate-plans.ts`
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/wire-contract.test.ts`
- Create: `packages/api/tests/integration/class-rate-plans.test.ts`

- [ ] **Step 1a: Re-export `ClassRatePlanFilters` from `services/filters.ts` (layering)**

Routes must NOT import from `repositories/` (`lint:boundaries`; the fee route imports `FeeScheduleFilters` from `../services/filters`, not `repositories/types`). In `packages/api/src/services/filters.ts`, add to the re-export barrel:

```typescript
export type { ClassRatePlanFilters } from '../repositories/types'
```

- [ ] **Step 1b: Create the routes (mirror `routes/fee-schedules.ts`, no status filter)**

`packages/api/src/routes/class-rate-plans.ts`:

```typescript
import {
  createClassRatePlanSchema,
  platformAdminCreateClassRatePlanSchema,
  updateClassRatePlanSchema,
} from '@kuruma/shared/validators/class-rate-plan'
import { Hono } from 'hono'
import { MANAGEMENT_READ_ROLES, requireAuth, requireUser, toCallerContext } from '../middleware/auth'
import type { ClassRatePlanService } from '../services/class-rate-plan'
import type { ClassRatePlanFilters } from '../services/filters'
import type { ResolveWriteOperatorId } from '../tenancy'
import {
  fail, failResult, ok, parseBody, parseCrossOperatorRead, parseId, parseScopedCreate,
  requireFleetWriteRole, stripUndefined,
} from './helpers'

export function createClassRatePlanRoutes(service: ClassRatePlanService, resolveWriteOperatorId: ResolveWriteOperatorId) {
  const app = new Hono()
  app.use('/class-rate-plans', requireAuth())
  app.use('/class-rate-plans/*', requireAuth())

  return app
    .get('/class-rate-plans', async (c) => {
      const user = requireUser(c)
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)
      const filters: ClassRatePlanFilters = {}
      const classId = c.req.query('classId')
      if (classId) filters.classId = classId
      const pickupLocationId = c.req.query('pickupLocationId')
      if (pickupLocationId) filters.pickupLocationId = pickupLocationId
      const isActive = c.req.query('isActive')
      if (isActive === 'true' || isActive === 'false') filters.isActive = isActive === 'true'
      return ok(c, await service.findAll(ctx, parseCrossOperatorRead(c), filters))
    })
    .get('/class-rate-plans/:id', async (c) => {
      const user = requireUser(c)
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response
      const plan = await service.findById(toCallerContext(user), idResult.id)
      if (!plan) return fail(c, 'Combo deal not found', 404)
      return ok(c, plan)
    })
    .post('/class-rate-plans', async (c) => {
      const user = requireUser(c)
      const denied = requireFleetWriteRole(c, user)
      if (denied) return denied
      const ctx = toCallerContext(user)
      const parsed = await parseScopedCreate(
        c, ctx,
        { operator: createClassRatePlanSchema, admin: platformAdminCreateClassRatePlanSchema },
        resolveWriteOperatorId,
      )
      if (!parsed.ok) return parsed.response
      const { data: d, operatorId } = parsed
      const result = await service.create(ctx, {
        operatorId, classId: d.classId, pickupLocationId: d.pickupLocationId,
        dayRateJpy: d.dayRateJpy, isActive: d.isActive ?? true, label: d.label ?? null,
      })
      if (!result.ok) return failResult(c, result)
      return ok(c, result.plan, 201)
    })
    .patch('/class-rate-plans/:id', async (c) => {
      const user = requireUser(c)
      const denied = requireFleetWriteRole(c, user)
      if (denied) return denied
      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response
      const parsed = await parseBody(c, updateClassRatePlanSchema)
      if (!parsed.ok) return parsed.response
      const result = await service.update(toCallerContext(user), idResult.id, stripUndefined(parsed.data), c.req.query('operatorId'))
      if (!result.ok) return failResult(c, result)
      return ok(c, result.plan)
    })
    .delete('/class-rate-plans/:id', async (c) => {
      const user = requireUser(c)
      const denied = requireFleetWriteRole(c, user)
      if (denied) return denied
      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response
      const result = await service.remove(toCallerContext(user), idResult.id, c.req.query('operatorId'))
      if (!result.ok) return failResult(c, result)
      return ok(c, result.plan)
    })
}
```

- [ ] **Step 2: Wire the service + routes in the composition root**

In `packages/api/src/index.ts`, near the fee-schedule service (`:533`) add:

```typescript
  const classRatePlanService = new ClassRatePlanService(classRatePlanRepo, vehicleClassRepo, locationRepo)
```

Near the fee-schedule route mount (`:652`) add:

```typescript
    .route('/', createClassRatePlanRoutes(classRatePlanService, resolveWriteOperatorId))
```

Add the imports at the top of `index.ts`:

```typescript
import { ClassRatePlanService } from './services/class-rate-plan'
import { createClassRatePlanRoutes } from './routes/class-rate-plans'
```

- [ ] **Step 3: Add the wire-contract fence**

In `packages/api/src/wire-contract.test.ts`, add a fence for `ClassRatePlan -> ClassRatePlanData` using the file's existing helpers (NOT `satisfies`): the real pattern is a bidirectional `Exact<Jsonified<T>, Data>` const plus a runtime assertion. Mirror the `FeeSchedule` entry:

```typescript
import type { ClassRatePlanData } from '@kuruma/shared/types/class-rate-plan'
import type { ClassRatePlan } from './stores'
// ...alongside the existing fences:
const classRatePlanContract: Exact<Jsonified<ClassRatePlan>, ClassRatePlanData> = true
test('ClassRatePlan wire row matches ClassRatePlanData', () => {
  expect(classRatePlanContract).toBe(true)
})
```

(`Exact`/`Jsonified` are already defined in the file — reuse them; `Jsonified` maps `Date -> string`.)

- [ ] **Step 4: Write the integration test (RED)**

`packages/api/tests/integration/class-rate-plans.test.ts` — the correct template is the **route-level FK suite** `tests/integration/vehicle-classes-route-fk.test.ts` (NOT `fee-schedules.test.ts`, which is a repo/service-level suite with no HTTP layer). Use `createApp({ ...overrides })` + `app.request(path, { method, headers, body })` + `authHeaders({ sub, role })` + `setupAuthEnv()`. There are no `POST/GET/...` helpers — call `app.request` directly. Seed an operator with an active class + active location (and an archived class + archived location for the negative cases):

```typescript
import { createApp } from '../../src/index'          // or the app factory the sibling imports
import { authHeaders, setupAuthEnv } from '../helpers/auth' // mirror the sibling's imports exactly

setupAuthEnv()
const app = createApp({ /* drizzle repos against the test db, per the sibling */ })
const owner = authHeaders({ sub: ownerUserId, role: 'FLEET_MANAGER' })

async function req(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { ...owner, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

test('POST creates, GET lists, PATCH toggles, DELETE removes', async () => {
  const created = await req('POST', '/class-rate-plans', { classId, pickupLocationId, dayRateJpy: 8000 })
  expect(created.status).toBe(201)
  const createdBody = await created.json()
  const list = await (await req('GET', '/class-rate-plans')).json()
  expect(list.data).toHaveLength(1)
  const patched = await (await req('PATCH', `/class-rate-plans/${createdBody.data.id}`, { isActive: false })).json()
  expect(patched.data.isActive).toBe(false)
  expect((await req('DELETE', `/class-rate-plans/${createdBody.data.id}`)).status).toBe(200)
  expect((await (await req('GET', '/class-rate-plans')).json()).data).toHaveLength(0)
})

test('POST a second deal for the same (class, location) -> 409', async () => {
  await req('POST', '/class-rate-plans', { classId, pickupLocationId, dayRateJpy: 8000 })
  expect((await req('POST', '/class-rate-plans', { classId, pickupLocationId, dayRateJpy: 9000 })).status).toBe(409)
})

test('POST for an archived class -> 400 INVALID_VEHICLE_CLASS', async () => {
  const r = await req('POST', '/class-rate-plans', { classId: archivedClassId, pickupLocationId, dayRateJpy: 8000 })
  expect(r.status).toBe(400)
  expect((await r.json()).code).toBe('INVALID_VEHICLE_CLASS')
})

test('POST for an archived location -> 400 INVALID_LOCATION', async () => {
  const r = await req('POST', '/class-rate-plans', { classId, pickupLocationId: archivedLocationId, dayRateJpy: 8000 })
  expect(r.status).toBe(400)
  expect((await r.json()).code).toBe('INVALID_LOCATION')
})

test('a cross-tenant id reads as 404', async () => {
  expect((await req('GET', `/class-rate-plans/${otherOperatorPlanId}`)).status).toBe(404)
})
```

Also add one race-path case that exercises the composite location FK -> 400 `INVALID_LOCATION` mapping directly at the repo (mirror how `vehicle-classes-route-fk.test.ts` triggers its FK), since the service pre-check would otherwise mask it.

- [ ] **Step 5: Run integration (RED then GREEN)**

Run: `bun run --filter @kuruma/api test:integration class-rate-plans`
Expected: initially FAIL (routes unmounted), then PASS after Steps 1-2 land. Fix until green.

- [ ] **Step 6: Full api typecheck + unit + integration**

Run: `bun run --filter @kuruma/api exec tsc --noEmit` then `bun run --filter @kuruma/api test` then `bun run --filter @kuruma/api test:integration`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes/class-rate-plans.ts packages/api/src/services/filters.ts packages/api/src/index.ts packages/api/src/wire-contract.test.ts packages/api/tests/integration/class-rate-plans.test.ts
git commit -m "feat(#464): class-rate-plan CRUD routes + wiring + integration"
```

---

## Task 7: Web operator module + route + nav + i18n + E2E

**Files:**
- Create: `packages/web/src/vite/operator-combo-deals/api.ts` (+ components below)
- Create: `packages/web/src/routes/$locale/_business/manage/combo-deals.tsx`
- Modify: `packages/web/src/vite/nav/business-nav-items.ts`
- Modify: `packages/web/messages/{en,ja,zh}.json` (one JSON per locale) — add `nav.comboDeals` + `business.comboDeals.*` keys
- Modify: `packages/web/src/vite/operator-context/operator-context.ts` — register the route id
- Modify: `scripts/lint-module-boundaries.ts` — bump the reach-in baseline
- Create: `e2e/real-db/operator-combo-deals.auth.spec.ts`

- [ ] **Step 1: Create the data layer `api.ts` (mirror `operator-fees/api.ts`, no status enum)**

`packages/web/src/vite/operator-combo-deals/api.ts`:

```typescript
import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { type WithOperatorId, buildScopeParam } from '@/vite/operator-context'
import type { ClassRatePlanData } from '@kuruma/shared/types/class-rate-plan'
import type {
  CreateClassRatePlanInput,
  UpdateClassRatePlanInput,
} from '@kuruma/shared/validators/class-rate-plan'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

export type { CreateClassRatePlanInput, UpdateClassRatePlanInput }

// Pinned to the shared wire DTO with `satisfies` (#847): a producer field drift
// fails to compile here, not at runtime. The api row is fenced to the same DTO
// in wire-contract.test.ts.
const schema = z.object({
  id: z.string(),
  operatorId: z.string(),
  classId: z.string(),
  pickupLocationId: z.string(),
  dayRateJpy: z.number(),
  isActive: z.boolean(),
  label: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<ClassRatePlanData>
export type { ClassRatePlanData }

export const COMBO_QUERY_KEY = ['operator-combo-deals'] as const

export async function fetchComboDeals(pickedOperatorId?: string): Promise<ClassRatePlanData[]> {
  const res = await fetch(`${getApiBaseUrl()}/class-rate-plans?${buildScopeParam(pickedOperatorId)}`, { credentials: 'include' })
  return unwrap(res, schema.array())
}

export function comboDealsQueryOptions(pickedOperatorId?: string) {
  return queryOptions({
    queryKey: [...COMBO_QUERY_KEY, pickedOperatorId ?? 'all'] as const,
    queryFn: () => fetchComboDeals(pickedOperatorId),
  })
}

async function writeJson(path: string, method: 'POST' | 'PATCH', body: unknown, csrfToken: string): Promise<ClassRatePlanData> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method, credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return unwrap(res, schema)
}

function operatorQuery(pickedOperatorId?: string): string {
  return pickedOperatorId ? `?operatorId=${encodeURIComponent(pickedOperatorId)}` : ''
}

export async function createComboDeal(input: WithOperatorId<CreateClassRatePlanInput>, csrfToken: string): Promise<ClassRatePlanData> {
  return writeJson('/class-rate-plans', 'POST', input, csrfToken)
}

export async function updateComboDeal(id: string, input: UpdateClassRatePlanInput, csrfToken: string, pickedOperatorId?: string): Promise<ClassRatePlanData> {
  return writeJson(`/class-rate-plans/${encodeURIComponent(id)}${operatorQuery(pickedOperatorId)}`, 'PATCH', input, csrfToken)
}

export async function removeComboDeal(id: string, csrfToken: string, pickedOperatorId?: string): Promise<ClassRatePlanData> {
  const res = await fetch(`${getApiBaseUrl()}/class-rate-plans/${encodeURIComponent(id)}${operatorQuery(pickedOperatorId)}`, {
    method: 'DELETE', credentials: 'include', headers: { 'X-CSRF-Token': csrfToken },
  })
  return unwrap(res, schema)
}
```

- [ ] **Step 2: Create the UI components by cloning `operator-fees/` with these substitutions**

Clone each `operator-fees/*` file to `operator-combo-deals/*`, applying the field mapping:
- `OperatorFeesView.tsx` -> `OperatorCombosView.tsx`: props `{ deals: ClassRatePlanData[]; classes; locations; scope }`; list rows; "Add deal" button opens `AddComboDialog`.
- `FeeRow.tsx` -> `ComboRow.tsx`: show class name (resolved from `classes` by `classId`), location name (from `locations` by `pickupLocationId`), `dayRateJpy` formatted yen, `label` if present, an active/inactive badge, and Edit / Toggle / Delete actions.
- `FeeScheduleForm.tsx` -> `ComboForm.tsx`: a class `<Select>` (operator's active `vehicleClasses`), a location `<Select>` (operator's active `locations`), a `dayRateJpy` money input, an optional `label` text input, an `isActive` switch. No fee-type/unit fields.
- `AddFeeDialog.tsx` / `EditFeeDialog.tsx` -> `AddComboDialog.tsx` / `EditComboDialog.tsx`: call `createComboDeal` / `updateComboDeal`; invalidate `COMBO_QUERY_KEY`; surface the API `ApiError.code` (`INVALID_LOCATION` / `INVALID_VEHICLE_CLASS` -> field-level message; 409 -> "a deal already exists" banner).
- `ArchiveFeeDialog.tsx` -> `RemoveComboDialog.tsx`: confirm hard delete, call `removeComboDeal`.
- `FeeScheduleStatusBadge.tsx` -> `ComboActiveBadge.tsx`: green "Active" / muted "Inactive" from `isActive`.

Follow `packages/web/DESIGN.md`: shadcn `@/components/ui/*`, `Button` variants (`destructive` for delete), Lucide icons, `text-sm text-muted-foreground` captions.

- [ ] **Step 3: Create the route (mirror `manage/fees.tsx`)**

`packages/web/src/routes/$locale/_business/manage/combo-deals.tsx`: `createFileRoute` with `loaderDeps: ({ search }) => ({ operator: search.operator })`, a `loader` that `Promise.all`s THREE queries — `ensureQueryData(comboDealsQueryOptions(deps.operator))`, `ensureQueryData(operatorClassesQueryOptions({}, deps.operator))`, and **`ensureQueryData(operatorLocationsQueryOptions(deps.operator))`** (from `@/vite/operator-locations/api` — the fees template does NOT load locations, but the combo form has a location picker, so you MUST add it); `pendingComponent: PageSkeleton`; an `errorComponent`; the component uses `useOperatorScope()` + `useSuspenseQuery` for deals, classes, AND locations, and renders `<OperatorCombosView deals={deals} classes={classes} locations={locations} scope={scope} />`. No feature-flag redirect (Q2 unflagged).

- [ ] **Step 4: Regenerate the route tree + add the nav item**

Run: `bun run --filter @kuruma/web build` (regenerates `routeTree.gen.ts`).

In `business-nav-items.ts`, add after the `add-ons` entry (:23) — no gate entry in `visibleBusinessNavItems` (unflagged):

```typescript
  { to: '/$locale/manage/combo-deals', labelKey: 'comboDeals' },
```

In `packages/web/src/vite/operator-context/operator-context.ts`, add the route id to `OPERATOR_CONTEXT_ROUTE_IDS` (:97) — otherwise a platform-admin gets no operator picker on this page and is stuck read-only in all-mode (the route uses `useOperatorScope()` + picked-operator reads):

```typescript
  '/$locale/_business/manage/combo-deals',
```

Handle the cross-feature reach-in ratchet: the route composing `OperatorCombosView` + the `api` query options counts as reach-ins into `vite/operator-combo-deals/` from outside the feature. This is the sanctioned "routes-compose-a-vite-feature" pattern (same as `manage/terms.tsx`, which bumped the baseline for view + api). Bump `VITE_CROSS_FEATURE_REACH_IN_BASELINE` in `scripts/lint-module-boundaries.ts:116` by the exact number of reach-ins you add (2 if route imports view + api), with a matching `// N (#464 combo deals): ...` comment mirroring the existing entries. Then run `bun run lint:modules` — expected: at/under baseline, exit 0. (Alternative: add an `operator-combo-deals/index.ts` barrel and import via `@/vite/operator-combo-deals` so the import is not a reach-in and no bump is needed — but the sibling precedent is the baseline bump.)

- [ ] **Step 5: Add i18n keys (en, ja, zh)**

Messages are **one JSON file per locale** (`packages/web/messages/en.json`, `ja.json`, `zh.json`) — there are NO per-namespace files. In each, add a `nav.comboDeals` key ("Combo deals" / "コンボプラン" / "组合优惠") and a `business.comboDeals` object with the form/dialog/empty-state strings (operator-portal copy lives under `business.*` — the sibling route uses `useTranslations('business.fees')`). Add the keys in all three files. Then run: `bun run --filter @kuruma/web test i18n-parity` — expected PASS (keys present in all three).

- [ ] **Step 6: Web typecheck + unit**

Run: `bun run --filter @kuruma/web exec tsc --noEmit` then `bun run --filter @kuruma/web test`
Expected: green (add a `ComboRow` render test and an `AddComboDialog` submit test that mocks `createComboDeal` and asserts `COMBO_QUERY_KEY` invalidation + error-code surfacing).

- [ ] **Step 7: E2E journey (mirror `e2e/real-db/locations.auth.spec.ts`)**

`e2e/real-db/operator-combo-deals.auth.spec.ts`: sign in as an operator, go to `/manage/combo-deals`, create a deal for a class + location, assert it appears in the list with the yen rate, toggle it inactive (badge flips), then delete it (row disappears). Run: `bun run test:e2e:real-db operator-combo-deals` (the default `test:e2e` config IGNORES `e2e/real-db/**` — you MUST use the real-db config).

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/vite/operator-combo-deals packages/web/src/routes/$locale/_business/manage/combo-deals.tsx packages/web/src/vite/nav/business-nav-items.ts packages/web/messages e2e/real-db/operator-combo-deals.auth.spec.ts packages/web/src/routeTree.gen.ts
git commit -m "feat(#464): operator combo-deals page (view, CRUD, nav, i18n, e2e)"
```

---

## Final verification

- [ ] `bun run lint` and `bun run --filter @kuruma/api lint:boundaries` and `bun run lint:modules` and `bun run lint:size` — all green.
- [ ] `bun run --filter @kuruma/shared test` / `@kuruma/api test` / `@kuruma/api test:integration` / `@kuruma/web test` — all green.
- [ ] `bun run db:verify` — 3 green checks.
- [ ] `bun run test:e2e:real-db operator-combo-deals` — green.
- [ ] Rebase onto `origin/develop` (the integration branch — NOT `main`), open PR against `develop`: title in plain English ("Let operators set combo deals"), body `Refs #464` (epic stays open until the date-range slice — do NOT `Closes`).

---

## Self-review notes

- **Spec coverage:** Q-A (Task 1 composite FK + Task 5 FK error mapping), Q1 (Task 6 DELETE route + Task 4 `remove`), Q2 (Task 7 Step 4 no gate), Q-B (Task 5 `assertPublishable` + Task 6 integration 400s), Q3 (`label` never in a renter surface — only operator api/UI), Q5 (no date columns touched). Wire-contract fence (Task 6 Step 3). All covered.
- **Type consistency:** service returns `{ ok, plan }` (not `feeSchedule`); repo method names `findByScope`/`remove` used identically in tasks 4-6; `ClassRatePlanData` fields identical across DTO (Task 3), api.ts schema (Task 7), wire-contract (Task 6).
- **Divergences from fees to remember:** no status enum / no `parseArchivableFilters`; singleton plain-UNIQUE (no partial-active indexes); `findByScope` ignores `isActive`; publishability check is net-new (fees has none).
