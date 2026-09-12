# Operator combo-deals management (class rate plans) — design

Date: 2026-07-12
Feature: #464 slice 6 (operator write-side for class-combo deal rates)
Status: APPROVED 2026-07-12 — reviewed (architect + follow-up), all findings cleared, all decisions locked by owner. Ready for implementation planning.

## Review outcome (2026-07-12)

Architect review verdict: fundamentally sound, correctly mirrors the fees feature.
Confirmed: no orphan risk on delete (nothing FKs to `class_rate_plans`; the combo total is snapshotted into `basePriceJpy` at book time — `booking-creation.ts:635` — the plan id never persists), the singleton toggle-not-archive model is mandated by the schema comment (`pricing.ts:242-247`), and date-range deferral matches recorded owner intent (`pricing.ts:211-213`).
Corrections from the review are folded into the sections below.
The one genuine design fork is **Q-A (composite location FK vs service-side ownership check)** — see open questions.

A second review round (2026-07-12) added four fixes, all verified against code and folded in:
- **`label` is operator-only** — `ClassOfferingService` emits `classLabel: vc?.name` and never reads `plan.label` (`class-offering.ts:124`); the renter DTO has no deal-label field (`search-result.ts:30`). Renter visibility would be new API/DTO/web/test work — out of scope this slice (see Q3, non-goals).
- **Lifecycle, not just tenancy** — ownership checks prove same-operator, not *publishable*. An `isActive=true` deal can point at an archived location/class and silently vanish from active-only storefronts. Added a rule + tests (see §3, Q-B).
- **Update error mapping** — a class/location-changing PATCH can lose a race to DB `23505`/`23503`; mirror `FeeScheduleService.update`'s post-write catch (`fee-schedule.ts:144-152`), not just a pre-check (see §3).
- **Web api pattern** — the real sibling uses `fetch` + `unwrap` + a Zod schema pinned `satisfies z.ZodType<...Data>` fenced by `wire-contract.test.ts`, NOT `hono/client`. Add a shared `ClassRatePlanData` DTO + wire-contract test (see §0, §6).

## Problem

An operator has no way to set "combo deals."
The renter-facing half of #464 already ships: a `CLASS_COMBO` booking is priced on its vehicle *class* at a per-(operator, class, pickup-location) day rate, surfaced as combo cards in search and priced deterministically at book time.
But the pricing rows that drive it (`class_rate_plans`) are **seed-only and read-only**.
The repository interface says so directly: `ClassRatePlanRepository` exposes `findActiveRate`, `findActiveRatePlans`, and `create`, and the header comment reads *"CRUD lands with slice 6; the DB UNIQUE seals it."*
The only runtime caller of `create` is the seed script.
There is no API write route, no service, and no operator page.

This slice adds the missing operator configuration surface so an operator can create, edit, activate/deactivate, and remove a combo deal from the portal.

## What already exists (no work needed)

The data model is complete and needs **no migration** — *unless* open question Q-A picks the composite location FK, which is the only change that would require one.
`packages/shared/src/db/pricing.ts:218` — `class_rate_plans` with:
- Composite FK `class_rate_plans_operator_class_fk` sealing `classId` to the same operator (mirrors `fee_schedules`).
- Plain FK `pickupLocationId -> locations(id)` (NOT operator-sealed — see risk below).
- `unique(operatorId, classId, pickupLocationId)` — one plan per class per store.
- `check(dayRateJpy >= 0)`.
- `isActive boolean default true` — the on/off toggle.
- `label text` nullable — operator display name ("Weekend Compact Deal").

The read/pricing path (`ClassOfferingService`, `booking-creation.ts:622`) is untouched by this slice.

## Design: mirror the fees feature end-to-end

The sibling to copy is **fee schedules**, the closest existing per-(operator, class, location) pricing config.
Every layer below has a fees analogue; deltas from fees are called out.

### Key difference from fees: singleton, toggle-not-archive

A fee schedule is archive-and-recreate (a `status` enum + partial-on-active unique indexes).
A rate plan is a **singleton per (operator, class, location)**: you edit it in place and flip `isActive`.
So this slice uses a plain `PATCH { isActive }` toggle, **not** an archive lifecycle.
The DB has one `UNIQUE` (not two partial indexes), and the create-time duplicate check keys on `(operatorId, classId, pickupLocationId)` regardless of `isActive`.

### 0. Shared wire DTO — `packages/shared/src/types/class-rate-plan.ts` (new)

The sibling fences its JSON row at both ends (the #847 pattern): a shared `FeeScheduleData` DTO, a web Zod schema pinned `satisfies z.ZodType<FeeScheduleData>`, and an api `wire-contract.test.ts` that fences the repo row type to the same DTO.
Add the analogue: a `ClassRatePlanData` type (id/operatorId/classId/pickupLocationId/dayRateJpy/isActive/label with dates as ISO strings) and a `wire-contract.test.ts` entry fencing the `ClassRatePlan` row to it.
This closes the producer/consumer seam so a field drift fails to compile, not at runtime.

### 1. Validators — `packages/shared/src/validators/class-rate-plan.ts` (new)

Mirror `validators/fee-schedule.ts`, minus the fee-type/unit coherence machinery (a rate plan has no coherent-pair rule — simpler).

```
const objectSchema = z.object({
  classId: z.string().uuid(),
  pickupLocationId: z.string().uuid(),
  dayRateJpy: jpyAmount('Day rate'),
  label: z.string().trim().min(1).max(80).nullish(),
  isActive: z.boolean().optional(),          // create defaults true
})
createClassRatePlanSchema            = objectSchema
platformAdminCreateClassRatePlanSchema = objectSchema.extend({ operatorId: z.string().trim().min(1) })
updateClassRatePlanSchema            = objectSchema.partial()   // PATCH: dayRateJpy | label | isActive | classId | pickupLocationId
```

No `.superRefine` needed.
Existence + same-operator for `classId` is sealed by the composite DB FK; `pickupLocationId` ownership is checked in the service (below).

### 2. Repository port — extend `ClassRatePlanRepository` (`repositories/types-pricing.ts`)

Add the CRUD the interface comment reserved for this slice:

```
findAll(ctx, filters): Promise<ClassRatePlan[]>          // operator-scoped list (+ cross-operator read for admin)
findById(ctx, id): Promise<ClassRatePlan | undefined>    // caller-scoped
update(ctx, id, patch): Promise<ClassRatePlan | undefined>
remove(ctx, id): Promise<ClassRatePlan | undefined>      // hard delete — a plan is config, not a financial record (see open Q1)
findByScope(operatorId, classId, pickupLocationId)       // 409 pre-check
```

**Review fix:** the pre-check is `findByScope`, NOT `findActiveByScope`.
This is a plain-UNIQUE singleton — exactly one row per `(operator, class, location)` regardless of `isActive`.
Filtering the pre-check on `isActive=true` (the fees pattern) would let an *inactive* existing row slip past and surface as a raw `23505` instead of a clean 409, so the pre-check must ignore `isActive`.

`ClassRatePlanFilters` gains `classId?`, `pickupLocationId?`, and `isActive?` for the operator list query (keep the existing read-side `operatorId?`/`locationIds?`).
There is **no** `status`/archivable filter here (rate plans have no status enum) — do not reuse the fees `parseArchivableFilters`.
Implement in both `repositories/in-memory/class-rate-plan.ts` and `repositories/drizzle/class-rate-plan.ts`.
The in-memory version must throw the same `23505`/`23503` constraint-named errors on unique/FK violation so service error-mapping has parity (the fees in-memory repo is the template).

### 3. Service — `packages/api/src/services/class-rate-plan.ts` (new)

Mirror `FeeScheduleService`:
- `create`: pre-check `findByScope` -> 409 (message-only, no `code` — matches fees, which returns a bare 409 message at `fee-schedule.ts:89`); catch unique violation -> same 409; catch composite-class FK -> 400 `INVALID_VEHICLE_CLASS`.
- **New vs fees — location ownership.** The `pickupLocationId` FK is NOT operator-sealed, so location ownership must be enforced. Two options, see **Q-A**:
  - **(preferred) composite DB FK** `(operatorId, pickupLocationId) -> locations(operatorId, id)` mirroring `vehicles`' `VEHICLES_PICKUP_LOCATION_FK` and this table's own class seal — then map the named `23503` to 400 `INVALID_LOCATION` (the `isInvalidVehicleClass` pattern), and **no `LocationRepository` injection is needed**. Requires a migration. The FK target already exists — `locations_operatorId_id_unique` (`location.ts:91`), the same seal vehicles use — so nothing changes on the `locations` side.
  - **(zero-migration) service check** via the already-caller-scoped `LocationRepository.findById` (`drizzle/location.ts` filters by `operatorReadScope`, so an operator reading a foreign location gets `undefined` for free). **Admin caveat:** a platform-admin ctx reads `all` scope, so `findById` returns any operator's location — the service must then assert `location.operatorId === resolvedOperatorId` explicitly, not just existence.
- `update`: fetch caller-scoped row -> 404 if absent; `assertFleetWriteWithinOperator(ctx, existing.operatorId, actingOperatorId)` (#1442 admin-must-name-operator); if `classId`/`pickupLocationId` changed re-run the 409 scope check excluding self, and re-validate location ownership. **Then wrap the write in the same post-write try/catch as `fee-schedule.ts:144-152`** — a class/location-changing PATCH can still lose a race and hit DB `23505` (-> 409) or the composite class FK `23503` (-> 400 `INVALID_VEHICLE_CLASS`). The pre-check is UX; the constraint mapping is the concurrency seal.
- **Lifecycle rule (new — publishable, not just owned).** Ownership FKs prove same-operator identity, not that the target is *bookable*. An `isActive=true` plan pointing at an archived location or archived/non-bookable class silently disappears from active-only storefronts (`flat-search.ts` scopes to active locations; capacity counts vehicles by class without checking class status — `availability.ts:223`). On create and on any PATCH that sets `isActive=true` (or changes class/location), reject with 400 (`INVALID_LOCATION`/`INVALID_VEHICLE_CLASS`) if the target class or location is archived/non-bookable. Deactivating (`isActive=false`) is always allowed. See Q-B.
- `toggle` is just `update({ isActive })` — no separate method (still runs the lifecycle rule above when toggling ON).
- `remove`: fetch + `assertFleetWriteWithinOperator` -> delete -> 404 if absent.

Register `INVALID_LOCATION` (new) in the `ERROR_CODES` array in `lib/error-codes.ts`, pin it in `error-codes.test.ts`, and emit it with `satisfies ErrorCode`.
`INVALID_VEHICLE_CLASS` already exists.
Add a `CLASS_RATE_PLANS_CLASS_FK` constant (and, under Q-A option 1, a location-FK constant) to `pg-errors.ts` mirroring `FEE_SCHEDULES_CLASS_FK` so the service maps the named `23503` to the right 400.

### 4. Route — `packages/api/src/routes/class-rate-plans.ts` (new)

Structural copy of `routes/fee-schedules.ts`:
- `app.use('/class-rate-plans', requireAuth())` + `/*`.
- `GET /class-rate-plans` — `MANAGEMENT_READ_ROLES` gate, `parseCrossOperatorRead`, filters (`classId`, `pickupLocationId`, `isActive`). Do NOT copy fees' `parseArchivableFilters` — there is no status enum here.
- `GET /class-rate-plans/:id` — read gate + `parseId` -> 404.
- `POST` — `requireFleetWriteRole`, `parseScopedCreate({ operator, admin }, resolveWriteOperatorId)`, `service.create` -> 201.
- `PATCH /:id` — `requireFleetWriteRole`, `parseBody(updateClassRatePlanSchema)`, `stripUndefined`, `service.update(..., c.req.query('operatorId'))`.
- `DELETE /:id` — `requireFleetWriteRole` -> `service.remove`.
Use `ok/fail/failResult` helpers — no manual `c.json`.

### 5. Composition root wiring

- `packages/api/src/index.ts` — construct `ClassRatePlanService(classRatePlanRepo, locationRepo)`, mount `createClassRatePlanRoutes(service, resolveWriteOperatorId)`. The Drizzle `classRatePlanRepo` already exists in the root; only the service + route are new.
- `packages/api/src/app-overrides.ts` — wire the in-memory repo for tests (it is already referenced there).

### 6. Web module — `packages/web/src/vite/operator-deals/` (new)

Structural copy of `vite/operator-fees/`:
- `OperatorDealsView.tsx` — list of deals grouped/filterable by class + location, add button.
- `DealRow.tsx` — one plan, active/inactive badge, edit + toggle + delete actions.
- `DealForm.tsx`, `AddDealDialog.tsx`, `EditDealDialog.tsx` — class picker (operator's `vehicleClasses`), location picker (operator's `locations`), `dayRateJpy` money input, optional `label`.
- `RemoveDealDialog.tsx` — confirm hard delete.
- `api.ts` — mirror `operator-fees/api.ts` exactly (NOT `hono/client`): `fetch` + `unwrap(res, schema)` from `@/lib/api-error`, a local Zod `classRatePlanSchema` pinned `satisfies z.ZodType<ClassRatePlanData>`, `queryOptions` for reads, and CSRF-header'd `writeJson` for POST/PATCH. Writes take the canonical `Create/UpdateClassRatePlanInput` types from `@kuruma/shared/validators/class-rate-plan`, and scope via `buildScopeParam`/`?operatorId=` (the #1442 picker-admin pattern).
- `label` renders in the management list as the deal's display name; it is **operator-only** (no renter surface this slice — see Q3).
- **Review fix:** mirror `operator-fees` exactly — it has **no `index.ts` barrel**, and the route imports its files deep (`manage/fees.tsx` imports `@/vite/operator-fees/OperatorFeesView` + `.../api`). `lint:modules` only blocks *cross-feature* deep imports (one feature reaching into another's internals); importing your own feature's files from its route is fine. A barrel is optional, not required.

### 7. Route + nav

- `packages/web/src/routes/$locale/_business/manage/deals.tsx` — under the `_business` membership guard; renders `OperatorDealsView`.
- Run `vite build` to regenerate `routeTree.gen.ts` before typecheck (new route).
- `packages/web/src/vite/nav/business-nav-items.ts` — add `{ to: '/$locale/manage/deals', labelKey: 'deals' }` to the array (one-line; the nav-count test updates with it). **If flag-gated (Q2), this is NOT one line:** you must also add a field to `BusinessNavFlags` and a `navItemGates` entry in `visibleBusinessNavItems`, plus a redirect in the route when the flag is OFF (mirroring `add-ons`/`messages`).

### 8. i18n

- `nav.deals` label in en/ja/zh.
- A `deals` message namespace (form labels, dialog copy, empty state) in all three locales.
- Verify key parity after merge (`i18n-parity`) — conflict resolution silently drops keys (known gotcha).

## Tenancy & security (reused, not reinvented)

Every guard is the fees pattern:
- `requireFleetWriteRole` on writes, `MANAGEMENT_READ_ROLES` on reads.
- `parseScopedCreate` + `resolveWriteOperatorId` so an operator session is tenant-clamped and a platform-admin must name the operator.
- `assertFleetWriteWithinOperator` (#1442) binds update/delete to the picked operator.
- Composite class FK + service-side location-ownership check prevent cross-tenant class/location references.

## Tests

- **Unit** (`services/class-rate-plan.test.ts`): create 409 on duplicate scope, 400 on foreign class, 400 on cross-operator location; **update** self-collision-free AND 409/400 on class/location-changing PATCH that clashes (the post-write race path); **lifecycle** — create/activate against an archived class or location -> 400; deactivate always allowed; delete 404 cross-tenant. Sabotage each gate.
- **Integration** (real-pg route): full CRUD round-trip + the error codes + cross-tenant 404 + the archived-target 400s, mirroring the fee-schedule integration spec.
- **Wire-contract** (`wire-contract.test.ts`): fence the `ClassRatePlan` repo row to `ClassRatePlanData` (the §0 seam).
- **E2E** (`e2e/real-db/operator-deals.auth.spec.ts`): operator signs in, opens `/manage/deals`, creates a deal for a class+location, sees it listed, toggles it inactive, deletes it. Template = `e2e/real-db/locations.auth.spec.ts`.

## Decisions (LOCKED 2026-07-12 by owner)

0. **Q-A — location ownership → composite DB FK. LOCKED.**
   Add `(operatorId, pickupLocationId) -> locations(operatorId, id)` mirroring `vehicles` and this table's class seal; map the named `23503` to 400 `INVALID_LOCATION`; NO `LocationRepository` in the service.
   Needs a migration; the FK target `locations_operatorId_id_unique` already exists (`location.ts:91`), so nothing changes on the `locations` side.
   Rationale (owner): tenant seals belong in the DB here, and the migration is worth it since the target unique already exists.

1. **Remove semantics → hard delete + `isActive` toggle. LOCKED.**
   `DELETE` removes the row; `isActive=false` hides it. Orphan-safe (combo total snapshotted at book time; nothing FKs the plan id).
   Rationale (owner): deals are config, not ledger data — toggle for temporary hiding, delete for cleanup.
2. **Feature-flag gate → UNFLAGGED. LOCKED.**
   Ship the `deals` nav + route unconditionally. Verified no `CLASS_COMBO`/combo flag exists in `feature-flags/registry.ts`; the renter combo side is already live and unflagged.
   Rationale (owner): a one-sided operator flag would mostly create rollout cleanup.
3. **`label` — operator-only or renter-visible? RESOLVED 2026-07-12: operator-only, no renter-facing changes (owner).**
   Verified: today `label` has **no renter consumer** — `ClassOfferingService` emits `classLabel: vc?.name` (`class-offering.ts:124`) and the renter DTO (`ClassComboSearchResult`) has no deal-label field.
   Decision: `label` is optional in the form and shown only in the management list; renter combo cards keep showing the class name. No `search-result.ts` field, no `class-offering.ts` read, no combo-card change. Renter visibility, if ever wanted, is a separate slice.
4. **Q-B — active deals against archived/non-bookable class or location → REJECT on create/activate. LOCKED.**
   Ownership checks prove tenancy, not publishability. Reject (400) creating or activating a deal whose class or location is archived/non-bookable; deactivation is always allowed (§3 lifecycle rule).
   Rationale (owner): friendliest product behavior — no "it saved but never appears" confusion.
5. **Date ranges → DEFER. LOCKED.**
   Stay a strict singleton (one row per operator+class+location). `validFrom/validUntil` are named in a schema comment (`pricing.ts:212`) as a future axis but are **not columns yet**, so a future seasonal-deals slice will need its own schema work (an additive migration, not a reshape).
   Rationale (owner): right scope for this slice; the date-range slice is a separate future effort.

## Non-goals

- No date-ranged / seasonal / channel-specific deals (named as future axes in a schema comment, not columns yet — a later additive migration).
- No changes to the renter-facing combo search/booking/pricing path (locked — Q3 resolved operator-only). `label` never reaches the renter DTO or combo cards this slice.
- No per-car (SPECIFIC) pricing changes — that is #406.
