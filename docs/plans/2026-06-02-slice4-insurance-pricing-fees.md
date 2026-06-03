# Slice 4 Amendment — Insurance, Pricing & Fees (issue #389)

**Date:** 2026-06-02
**Status:** Draft v2 — review incorporated (P0 + 3×P1 + P2, 2026-06-02); awaiting final green light to create issues
**Parent epic:** #385
**Source of truth:** `docs/plans/2026-05-25-marketplace-mvp-proposal.md` (§6 slice 4, §4 business portal items 4-6, §9 items 5/19, §10 items 5/9)
**Supersedes:** the thin body of #389 (insufficient detail for AFK implementation per review 2026-06-02)

---

## 0. Decision: split #389 into 4a / 4b / 4c

#389 bundles three independent domains. Per review, it is split into three sub-issues under epic #385, each a mergeable vertical slice on its own worktree off `marketplace-pivot`:

| Sub-slice | Domain | New? | Independent of | Effort |
|---|---|---|---|---|
| **4a** | Insurance options (per-operator CRUD) | New entity | 4b, 4c | ~1 day |
| **4b** | Fee schedules (per-operator, optional per-class) | New entity | 4a, 4c | ~1-1.5 days |
| **4c** | Vehicle pricing finalization (drop legacy class pricing) | Removal/cleanup | 4a, 4b | ~0.5 day |

**4a and 4b run in parallel** (separate worktrees) — they share no business logic, only three merge-surface files (`schema.ts`, `index.ts` DI block, `messages/*.json`). **4c sequences after #388** (ACRISS + vehicle CRUD) because both rework the vehicle/class forms.

**Insurance scope decision:** per-operator CRUD only. No `vehicle_insurance_options` join table in MVP — at booking (slice 6) the renter picks from the operator's full active list and the booking stores the selected option + price snapshot. Per-vehicle applicability is deferred until proven needed.

---

## 1. Preconditions (MUST hold before kickoff)

| Precondition | Why | Status 2026-06-02 |
|---|---|---|
| **#401 merged to `marketplace-pivot`** | Slice 4 repos build on the post-#401 write contract: `resolveOperatorIdForWrite(ctx, input, operators)` with single-operator inference + `OperatorRequiredError`, **no `BEST_CAR_RENTAL_OPERATOR_ID` fallback**. Building on the current pivot branch bakes in a contract actively being removed (`memory/project_operator-2-gate`). | On `feat/401-drop-operator-fallback`, not yet merged |
| **#387 (locations) merged** — for the WEB layer of 4a/4c only | 4a/4c pages reuse #387's `[operatorSlug]` layout + operator slug-resolution + `BusinessSidebar` conditional-link pattern. Backend repos/services have no #387 dependency and can start earlier. | In progress (`feature/387-locations`) |
| **#388 (ACRISS + vehicle CRUD)** — for **4c only** | 4c drops legacy class pricing while #388 reworks the class/vehicle forms; landing 4c first would conflict. 4a/4b do not depend on #388. | Not started |

`operators` table, `roleEnum` (incl. `OPERATOR_OWNER`/`OPERATOR_STAFF`/`PLATFORM_ADMIN`), `vehicles`/`vehicleClasses.operatorId`, the `(operatorId, id)` composite-unique on `vehicle_classes` (#395), and `CallerContext.operatorId`/`bypassScope` (#401) are all assumed present from slices 1-3.

If the contract names differ at kickoff, each sub-slice adapts its own PR — never refactor a landed slice.

---

## 2. The canonical pattern (all three sub-slices conform)

Established by `vehicles` / `vehicle_classes` (per AGENTS.md API layout `routes/ → services/ → repositories/`, NOT `modules/`):

- **Repo interface** (`repositories/types.ts`): `CallerContext` on every method.
- **Drizzle repo** reads: insurance/fees are **operator-private config**, so `findAll`/`findById` first call a management-read guard `requireManagementRead(ctx)` that rejects `RENTER` **and** `PARTNER` (unlike vehicles, whose catalog is public). Allowed read roles = `MANAGEMENT_READ_ROLES = STAFF_ROLES ∪ OPERATOR_ROLES` = `{STAFF, ADMIN, PLATFORM_ADMIN, OPERATOR_OWNER, OPERATOR_STAFF}`. **After** the guard, apply `operatorReadScope(ctx)` → `{kind:'all'|'operator'|'none'}` (`kind:'none'` ⇒ `sql\`false\``, fail-closed). Writes call `requireFleetWriteScope(ctx)` then insert with the route-resolved `operatorId`.

> **[P0] Why `operatorReadScope` alone is unsafe here:** it maps every non-operator role — **including `RENTER`** — to `{kind:'all'}` because the vehicle *catalog* is public. Insurance/fees are private; a renter (or `PARTNER` API caller) hitting `findAll` would read every operator's config. `requireManagementRead(ctx)` is the seal; `operatorReadScope` only handles the operator-vs-bypass split *after* renters/partners are rejected. Add `requireManagementRead` to `middleware/auth.ts` alongside `requireFleetWriteScope`.
- **InMemory repo** mirrors the interface (injected in tests via `createApp(overrides)`).
- **Service** is auth-agnostic; returns `{ ok: true, ... } | { ok: false, error, status, code? }`.
- **Route** gates mutations with role check, builds ctx via `toCallerContext(requireUser(c))`, uses `ok()`/`fail()`/`parseBody()` from `routes/helpers.ts`. Mounted at `/` in `index.ts`.
- **Validators** (`packages/shared/src/validators/<entity>.ts`): `create<X>Schema` / `update<X>Schema` (= `.partial()`), cross-field rules via `.superRefine()`.
- **Web** module `packages/web/src/modules/<entity>/` (`api.ts`, `hooks.ts`, `components/`) + page under `manage/[operatorSlug]/<entity>/page.tsx`, i18n namespace `business.<entity>`.

**Bypass-caller scoping (every list/create, mirrors #387):** operator callers auto-scope to `ctx.operatorId` and any `?operatorId=` they pass is dropped at the route. **[P1] Gate on `ctx.bypassScope === true`, not on the `PLATFORM_ADMIN` string** — during transition, legacy `STAFF`/`ADMIN` are bypass equivalents and must obey the same rule. A bypass caller's GET requires explicit `?operatorId=<id>` OR `?includeAll=true` (else 400); a bypass caller's POST requires `operatorId` in body (`platformAdmin*` schema variant; missing → 400 via `parseBody`). Cross-operator id on GET/PATCH/DELETE returns **404, not 403** (no tenant-existence leak). Mutations load the row first to capture its tenant before writing.

**[P1] Validation status code = `400` (contract):** every validation failure — Zod via `parseBody()`, missing `operatorId` on a bypass create, and fee-type↔unit coherence — returns **400**, matching the existing `parseBody()` helper. The plan and tests use 400 throughout; do **not** introduce a second validation status (422). If a future caller needs to distinguish "well-formed but semantically invalid," add a `code` field to the error body, not a new HTTP status.

---

## 3. Sub-slice 4a — Insurance options

### Schema (`packages/shared/src/db/schema.ts`)

```ts
export const insuranceStatusEnum = pgEnum('insurance_status', ['ACTIVE', 'ARCHIVED'])

export const insuranceOptions = pgTable('insurance_options', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  operatorId: text('operatorId').notNull().references(() => operators.id),
  name: text('name').notNull(),
  description: text('description'),
  dailyPriceJpy: integer('dailyPriceJpy').notNull(),
  deductibleJpy: integer('deductibleJpy'),          // null = no deductible (full cover)
  status: insuranceStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_insurance_options_operatorId').on(t.operatorId),
  unique('insurance_options_operatorId_id_unique').on(t.operatorId, t.id),
  unique('insurance_options_operator_name_unique').on(t.operatorId, t.name),
  check('insurance_options_daily_price_non_negative', sql`${t.dailyPriceJpy} >= 0`),
  check('insurance_options_deductible_non_negative',
    sql`${t.deductibleJpy} IS NULL OR ${t.deductibleJpy} >= 0`),
])
```

Seed (proposal §2): Best Car Rental gets two options — normal (deductible 150,000) + premium (deductible 250,000); `dailyPriceJpy` operator-set placeholders.

### Validators — `packages/shared/src/validators/insurance-option.ts`
- `createInsuranceOptionSchema`: name (1-200), description (≤2000, optional), `dailyPriceJpy` int ≥ 0, `deductibleJpy` int ≥ 0 nullish.
- `updateInsuranceOptionSchema = base.partial()`.
- `platformAdminCreateInsuranceOptionSchema = createInsuranceOptionSchema.extend({ operatorId: z.string() })`.

### Repo interface — `repositories/types.ts`
```ts
export interface InsuranceOptionFilters { status?: 'ACTIVE' | 'ARCHIVED'; includeArchived?: boolean; operatorId?: string }
export interface InsuranceOptionRepository {
  findAll(ctx: CallerContext, filters?: InsuranceOptionFilters): Promise<InsuranceOption[]>
  findById(ctx: CallerContext, id: string): Promise<InsuranceOption | undefined>
  create(ctx: CallerContext, data: Omit<InsuranceOption, 'id'|'createdAt'|'updatedAt'>): Promise<InsuranceOption>
  update(ctx: CallerContext, id: string, data: Partial<InsuranceOption>): Promise<InsuranceOption | undefined>
  archive(ctx: CallerContext, id: string): Promise<InsuranceOption | undefined>
}
```
Drizzle + InMemory pair under `repositories/{drizzle,in-memory}/insurance-option.ts`. Service `services/insurance-option.ts` (name-uniqueness 409, archive sets status). Routes `routes/insurance-options.ts` at `/insurance-options`. DI + mount in `index.ts`.

### Web
`manage/[operatorSlug]/insurance/page.tsx` + `modules/insurance/` (`InsuranceList`, `InsuranceForm`, `InsuranceArchiveDialog`, `useInsuranceOptions`). i18n `business.insurance.*`. Sidebar link gated on `operatorId`.

---

## 4. Sub-slice 4b — Fee schedules

### Schema

```ts
export const feeTypeEnum = pgEnum('fee_type', ['OVERTIME_HOURLY', 'CLEANING_FLAT', 'NO_FUEL_FLAT'])
export const feeUnitEnum = pgEnum('fee_unit', ['PER_HOUR', 'PER_DAY', 'PER_KM', 'FLAT'])
export const feeScheduleStatusEnum = pgEnum('fee_schedule_status', ['ACTIVE', 'ARCHIVED'])

export const feeSchedules = pgTable('fee_schedules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  operatorId: text('operatorId').notNull().references(() => operators.id),
  vehicleClassId: text('vehicleClassId'),            // null = operator-wide
  feeType: feeTypeEnum('feeType').notNull(),
  unit: feeUnitEnum('unit').notNull(),
  amountJpy: integer('amountJpy').notNull(),
  status: feeScheduleStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // [P2] Composite index covering the operator read-scope (leading column) AND the
  // composite FK source, so lint:fk-indexes + FK maintenance are satisfied. (operatorId)
  // is a prefix of this, so no separate idx_fee_schedules_operatorId is needed. The
  // partial UNIQUE indexes below are conditional and do NOT count as FK cover.
  index('idx_fee_schedules_operator_class').on(t.operatorId, t.vehicleClassId),
  // Composite FK seal (#395): a per-class fee's class must belong to the SAME operator.
  // MATCH SIMPLE — when vehicleClassId IS NULL the FK is not enforced (operator-wide row).
  foreignKey({
    columns: [t.operatorId, t.vehicleClassId],
    foreignColumns: [vehicleClasses.operatorId, vehicleClasses.id],
    name: 'fee_schedules_operator_class_fk',
  }),
  check('fee_schedules_amount_non_negative', sql`${t.amountJpy} >= 0`),
  // Uniqueness: ONE active fee per (operator, type, scope). Two partial indexes because
  // NULL != NULL in a plain UNIQUE — operator-wide rows would otherwise never dedupe.
  // Scoped to status='ACTIVE' so archiving frees the slot for a re-created fee.
  uniqueIndex('fee_schedules_active_class_unique')
    .on(t.operatorId, t.feeType, t.vehicleClassId)
    .where(sql`status = 'ACTIVE' AND "vehicleClassId" IS NOT NULL`),
  uniqueIndex('fee_schedules_active_operatorwide_unique')
    .on(t.operatorId, t.feeType)
    .where(sql`status = 'ACTIVE' AND "vehicleClassId" IS NULL`),
])
```

### Validators — `packages/shared/src/validators/fee-schedule.ts`
- `createFeeScheduleSchema`: `feeType` enum, `unit` enum, `amountJpy` int ≥ 0, `vehicleClassId` uuid nullish. `.superRefine()` enforces **fee-type ↔ unit coherence**:
  - `OVERTIME_HOURLY` ⇒ `unit === 'PER_HOUR'`
  - `CLEANING_FLAT` ⇒ `unit === 'FLAT'`
  - `NO_FUEL_FLAT` ⇒ `unit === 'FLAT'`
- `updateFeeScheduleSchema = base.partial()`. **[P1] The schema cannot fully enforce coherence on patch** — a patch of only `{ unit: 'FLAT' }` against an existing `OVERTIME_HOURLY` row never sees `feeType`, so the `.superRefine()` can't fire. Coherence on update is therefore enforced in the **service** on the merged value (below); the schema's `.superRefine()` stays only as a create-time + both-keys-present fast-path.
- Platform-admin extend variant adds `operatorId`.

### Repo / Service / Routes / Web
Same shape as 4a. `FeeScheduleFilters` adds `feeType?` and `vehicleClassId?`. **[P1] Service is the coherence + uniqueness seal:** `update` fetches the existing row, **merges the patch**, then validates (a) fee-type↔unit coherence on the *merged* `feeType`+`unit` (400 on mismatch) and (b) active-uniqueness on the merged `(operatorId, feeType, vehicleClassId)` **excluding the current row id** (409) — so a no-key-change edit (e.g. bumping only `amountJpy`) does not falsely collide with itself. This is the merge-then-validate pattern `VehicleClassService.update` uses for "at least one rate". `create` validates the same on the full payload (no exclusion). The DB partial-unique indexes + the schema `.superRefine()` are backstops, not the only checks. Routes at `/fee-schedules`. Page `manage/[operatorSlug]/fees/page.tsx` + `modules/fees/` — form: feeType select → unit auto-constrained by type, amount, optional class dropdown (operator's classes only). i18n `business.fees.*`.

### Slice-6 boundary (explicit — does NOT ship in 4b)
4b stores schedules only. **Deferred to slice 6 (#392):** snapshot of applicable `fee_schedules` rows into `bookings.fee_snapshot jsonb` at booking; overtime compute `ceil(overage_hours) * snapshotted_hourly_rate`; the confirmation-page "potential additional charges" block. 4b ships zero renter-facing surface and zero booking coupling.

---

## 5. Sub-slice 4c — Vehicle pricing finalization

Vehicle-level pricing already exists (`vehicles.dailyRateJpy`/`hourlyRateJpy`, `createVehicleSchema` "at least one rate", operator write-scope). 4c finishes the migration to vehicle-only pricing by **removing** class-level pricing. This is a destructive removal — discipline matters more than volume.

### Step 1 — Reader audit (BEFORE any drop)
Grep and reroute every reader of `vehicleClasses.dailyRateJpy` / `hourlyRateJpy`:
```
rg "dailyRateJpy|hourlyRateJpy" packages/api packages/web packages/shared \
  | rg -i "class" --color=never
```
Known readers to resolve first: `VehicleClassService.update` "at least one rate" validation, any `ClassCatalogCard` / renter catalog "from ¥X", booking-by-class pricing. Storefront min-price becomes `min(vehicles.dailyRateJpy)` per storefront (that computation lands in slice 5 — 4c only ensures nothing still *requires* class pricing).

### Step 2 — Migration (dedicated, after readers rerouted)
Drop in one `db:generate --name drop_class_level_pricing` migration:
- columns `vehicle_classes.dailyRateJpy`, `vehicle_classes.hourlyRateJpy`
- CHECK constraints `vehicle_classes_pricing_at_least_one`, `vehicle_classes_daily_rate_non_negative`, `vehicle_classes_hourly_rate_non_negative`

Then remove the fields from `vehicleClassObjectSchema`, the `VehicleClassService` rate validation, and the `ClassForm` price inputs. `db:verify` (3 green) after migrate.

### Step 3 — Sequence
Land **after #388** merges (it owns the class/vehicle form rework). Coordinate the `schema.ts` migration order to avoid the drizzle journal out-of-order `when` trap (CLAUDE.md 2026-04-17): regenerate 4c's migration on top of whatever #388 added.

No new UI. No new page. Vehicle form already carries price.

---

## 6. Migration ordering across 4a / 4b / 4c (the real parallel hazard)

All three append to `schema.ts` + `drizzle/`. Concurrent worktrees ⇒ journal `when` collisions. Rules:
- 4a and 4b each generate **additive** table migrations — order between them is irrelevant *except* the journal must stay monotonic. Whichever merges second **regenerates** its migration on the rebased branch (`bun run db:generate` after rebase), never hand-edits `_journal.json` unless cherry-picking (then bump `when` to `max(prev)+1` per CLAUDE.md).
- 4c is a **drop** — must be the last of the three and after #388. Never interleave a drop migration between two pending additive ones.
- Every sub-slice runs `bun run db:verify` post-migrate; CI `db-drift` enforces.

---

## 7. Tests (TDD vertical-slice, mutation-resistant)

Per sub-slice, mirroring `packages/api/tests/integration/rls-context.test.ts` (seed operator A + operator B + their `OPERATOR_STAFF` users; assert isolation both directions):

| Layer | 4a Insurance | 4b Fees | 4c Pricing |
|---|---|---|---|
| **Validator** (`packages/shared/test/validators/`) | reject empty name, negative price, negative deductible; accept null deductible | **fee-type↔unit coherence**: `OVERTIME_HOURLY`+`FLAT` rejected; `CLEANING_FLAT`+`PER_HOUR` rejected; valid combos pass; negative amount rejected | class schema no longer accepts rate fields |
| **InMemory repo** | CRUD; op-A staff can't see/update/archive op-B rows; **[P0] `RENTER` and `PARTNER` reads → Forbidden (NOT all-operators)**; bypass roles see both | same + filter by feeType/classId; **[P1] merged-patch coherence: patching only `unit` against an existing row is validated against the stored `feeType`** | — |
| **Drizzle repo** (Neon `test`) | FK on operatorId; unique `(operatorId,name)` → 23505 | **composite FK rejects a fee whose class belongs to another operator → 23503**; **second ACTIVE fee of same (operator,type,scope) → 23505** on the partial index | post-drop: inserting a class with a rate column fails (column gone) |
| **Service** | name-uniqueness 409; archive sets status; cross-operator id update → 404 | active-uniqueness 409 message; archive frees the slot (re-create succeeds) | `VehicleClassService` has no rate path |
| **Route** | 401/403/404 matrix; **`RENTER`/`PARTNER` read → 403**; bypass GET w/o operatorId→400, POST w/o operatorId→400; operator `?operatorId=B` dropped | same matrix; unit-coherence + merged-patch coherence → **400** | n/a (no new route) |
| **Web** | `InsuranceForm` validation surfaces | `FeeScheduleForm` constrains unit by type | `ClassForm` no longer renders rate inputs |

E2E: none required for slice 4 (operator-portal only; renter-facing E2E starts slice 5 per proposal §6.1).

---

## 8. Per-sub-slice merge gate (proposal §6.1)

All green before merge: `bun run test` · `bun run lint` · `bun run --filter @kuruma/api lint:boundaries` · `bun run lint:modules` · `bun run db:verify` · code-reviewer + architect agents (`memory/feedback_review-before-ship`).

---

## 9. Execution order & worktrees

```
git worktree add ../kuruma-insurance -b feature/389a-insurance marketplace-pivot   # 4a
git worktree add ../kuruma-fees      -b feature/389b-fees      marketplace-pivot   # 4b (parallel)
# 4c after #388:
git worktree add ../kuruma-pricing   -b feature/389c-pricing   marketplace-pivot
```
Within each: schema migration → validator (RED/GREEN per rule) → InMemory repo → service → routes → DI wire → Drizzle repo (integration) → web → i18n (restart dev) → review → rebase → PR (`Closes #389a` etc.).

**Parallelism:** 4a ∥ 4b from day one (after #401). 4c trails #388. Net wall-clock ≈ max(4a, 4b) + 4c ≈ ~1.5 + 0.5 = **~2 days** vs ~2.5-3 sequential.

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dropping class pricing breaks renter catalog / booking-by-class | Medium | High | 4c step-1 reader audit + reroute BEFORE the drop migration; integration test asserts no rate column remains |
| 4a/4b concurrent migrations collide in `_journal.json` | Medium | Medium | Second-to-merge regenerates on rebase; never hand-edit journal; `db:verify` + CI `db-drift` |
| Fee operator-wide uniqueness silently broken by NULL semantics | Medium | Medium | Two partial unique indexes (not a plain UNIQUE); integration test inserts a duplicate operator-wide fee and asserts 23505 |
| Per-class fee points at another operator's class | Low | Critical | Composite FK `(operatorId, vehicleClassId) → vehicle_classes(operatorId, id)`; integration test asserts 23503 |
| Built on pre-#401 fallback contract | Medium | High | Precondition: #401 merged first; repos call `resolveOperatorIdForWrite(ctx, input, operators)` (no hardcoded operator) |
| 4c lands before #388 and conflicts on class form | Low | Medium | Explicit sequencing: 4c after #388 |

---

## 11. Critical files

**4a:** `validators/insurance-option.ts`, `repositories/{drizzle,in-memory}/insurance-option.ts`, `services/insurance-option.ts`, `routes/insurance-options.ts`, `modules/insurance/*`, `manage/[operatorSlug]/insurance/page.tsx`; modify `schema.ts`, `repositories/types.ts`, `index.ts`, `messages/{en,ja,zh}.json`, `BusinessSidebar.tsx`, `seed.ts`.
**4b:** same set for `fee-schedule` / `fees`.
**4c:** modify `schema.ts` (drop columns+checks), `validators/vehicle-class.ts`, `services/vehicle-class.ts`, `modules/classes/components/ClassForm.tsx`; new drop migration.

---

## 12. Open questions — RESOLVED (reviewer 2026-06-02)

1. `insurance_options.dailyPriceJpy` — **required**. (An option with no price is meaningless.)
2. Keep `PER_DAY` / `PER_KM` in the unit enum now — **yes** (proposal names them; the fee-type↔unit validation prevents misuse).
3. 4c deletes class pricing — **yes, but only after the reader audit (§5 step 1) AND after #388.**

## 13. Review log

**v2 (2026-06-02)** incorporated reviewer findings:
- **[P0]** Reads of insurance/fees now gated by `requireManagementRead(ctx)` (rejects `RENTER`/`PARTNER`) before `operatorReadScope` — §2, §7.
- **[P1]** Fee coherence + active-uniqueness enforced in the **service** on merged existing+patch, not the partial schema — §4, §7.
- **[P1]** Bypass-caller scoping gates on `ctx.bypassScope` (covers legacy `STAFF`/`ADMIN`), not the `PLATFORM_ADMIN` string — §2.
- **[P1]** Standardized all validation failures on **400** (matches `parseBody()`); 422 removed — §2, §7.
- **[P2]** Added composite FK-source index `(operatorId, vehicleClassId)` for `lint:fk-indexes` — §4.
