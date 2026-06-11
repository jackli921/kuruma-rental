# Slice 3 — ACRISS + Vehicle CRUD (issue #388)

**Date:** 2026-06-02
**Status:** MERGED 2026-06-03 (#388, `f4cd0bf`) — ACRISS taxonomy + operator vehicle-class CRUD on `marketplace-pivot`. Plan retained for history.
**Parent epic:** #385
**Source of truth:** `docs/plans/2026-05-25-marketplace-mvp-proposal.md` (§6 row 3; §2 "Class taxonomy" / "Class display vs vehicle booking"; §4 business portal item 3; §4 platform item 2; §5 schema-retrofit row; §9 items 8/13; §10 item 13)
**Companion plan:** `docs/plans/2026-06-02-slice4-insurance-pricing-fees.md` (slice 4 sequences after this; 4c reworks the same class/vehicle forms)

---

## 0. What this slice actually is (and is not)

The demo target (proposal §6 row 3) is: *operator adds a Toyota Yaris in class "CCAR"*. Decomposed against the already-merged code, the work splits cleanly:

| Area | New in slice 3? | Why |
|---|---|---|
| `vehicle_classes.acriss_code` column + CHECK | **Yes** — the only new schema | Not present in `schema.ts`; §2 "Class taxonomy" makes it canonical |
| ACRISS taxonomy seed (code → friendly label) | **Yes** | §4 platform item 2; no class records are seeded today (seed only has `SEED_VEHICLES`) |
| ACRISS i18n labels (en/ja/zh) | **Yes** — new namespace | §4 platform item 2; §8.2 i18n coverage |
| `acrissCode` in class validator / type / repo / route / `ClassForm` | **Yes** | Thread the new column end-to-end |
| Vehicle `licensePlate` + `shakenExpiryDate` | **Already merged** (pre-pivot #48/#228) | Columns, validator rules, and i18n keys exist (`schema.ts:121,137`; `validators/vehicle.ts`; `messages/en.json` `business.vehicles.form.licensePlate`/`shakenExpiryDate`) |
| Vehicle operator-scoping (CRUD only under own operator) | **Already merged in #401/#386** | `DrizzleVehicleRepository` already calls `operatorReadScope` / `requireFleetWriteScope`; `routes/vehicles.ts` resolves `resolveWriteOperatorId` |
| `vehicles.class_id` references a class | **Already merged** | Composite FK `(operatorId, classId) → vehicle_classes(operatorId, id)` (#395) |

> **Honest scope note.** The proposal lists "operator vehicle CRUD with plate + sha-ken expiry" as slice-3 work, but slices 1 (#386) and 2 (#387) already landed the operator-scoped vehicle repo/route, and plate/shaken predate the pivot. **The net-new deliverable is ACRISS on `vehicle_classes`** plus the regression-proofing that vehicle CRUD enforces tenant isolation. The plan keeps a vehicle-CRUD test pass (§7) to *prove* the acceptance criteria, not to re-implement code that exists. This avoids gold-plating while satisfying #388's acceptance list.

---

## 1. Preconditions (MUST hold before kickoff)

| Precondition | Why | Status 2026-06-02 |
|---|---|---|
| **#386 (slice 1 tenancy) merged to `marketplace-pivot`** | Slice 3 builds on `operators` table, `roleEnum` (`OPERATOR_OWNER`/`OPERATOR_STAFF`/`PLATFORM_ADMIN`), `vehicleClasses.operatorId` + `vehicles.operatorId` (NOT NULL FKs), the `vehicle_classes_operatorId_id_unique` composite key (#395), and `CallerContext.operatorId`/`bypassScope`. | `origin/marketplace-pivot` contains the slice-1/operator-scope commits; the local `marketplace-pivot` branch is stale at `main`. Create worktrees from `origin/marketplace-pivot` or fast-forward the local tracking branch before kickoff. |
| **#401 (drop operator fallback) merged** | The write contract this slice extends: `resolveOperatorIdForWrite(ctx, inputOperatorId, operators)` in `packages/api/src/tenancy.ts` with single-operator inference + `OperatorRequiredError` (→ 422), **no `BEST_CAR_RENTAL` hardcode**. | Merged to `origin/marketplace-pivot` via PR #408. The local `marketplace-pivot` branch may still be stale; branch from `origin/marketplace-pivot` or fast-forward local before kickoff. |
| **#387 (locations) merged** — for the WEB layer only | Slice-3 web reuses #387's flat `/manage/*` business portal gate + `BusinessSidebar` link pattern. Routing is JWT-scoped (`/manage/classes`) with **no `[operatorSlug]` segment**. Class/vehicle backend has no #387 dependency. | In review (PR #414 → `marketplace-pivot`) |

If contract names differ at kickoff, this PR adapts — never refactor a landed slice.

---

## 2. The canonical pattern (this slice conforms)

Two *different* established shapes coexist; pick the right one per entity (per AGENTS.md `routes/ → services/ → repositories/`, NOT `modules/`):

- **`vehicle_classes` uses a SERVICE layer** (`services/vehicle-class.ts`): route → `VehicleClassService` → `VehicleClassRepository`. The service owns slug-uniqueness (409, scoped to `SYSTEM_CONTEXT` because slug is globally unique), the "at least one rate" merge-validate, and the archive-with-active-bookings guard (#326). ACRISS work threads through this layer.
- **`vehicles` is ROUTE → REPOSITORY directly** (no dedicated vehicle service; `MaintenanceService` only for status toggles). `routes/vehicles.ts` does the merge-patch and pricing validation inline. Slice 3 does **not** introduce a vehicle service — that would be gold-plating against the merged shape.

**Operator scoping (already the law, do not weaken):**
- **Reads** call `operatorReadScope(ctx)` (`tenancy.ts`) → `{kind:'all'|'operator'|'none'}`. `none` ⇒ `sql\`false\`` (fail-closed). `vehicle_classes` reads are *public catalog* (anonymous renters via `PUBLIC_CONTEXT` → `all`), so unlike slice-4 insurance/fees there is **no `requireManagementRead` gate** — the catalog is intentionally world-readable. ACRISS is catalog data and inherits this.
- **Writes** call `requireFleetWriteScope(ctx)` (admits `FLEET_WRITE_ROLES` = STAFF roles ∪ OPERATOR roles; a tenant caller missing `operatorId` fails closed). The route resolves the target tenant via `resolveWriteOperatorId(ctx, body.operatorId)` *before* the insert so a missing/ambiguous operator surfaces as 403/422, not a DB 500.
- **Per-repo operator-scoping is ADDITIVE (§6.2).** The class + vehicle repos are *already* operator-scoped (slice 1). This slice keeps them scoped; it never adds an auto-bypass for OPERATOR_* callers. Repos not yet scoped still call `rejectOperatorContextUntilScoped` — irrelevant here since both target repos are scoped.

**Validators** (`packages/shared/src/validators/`): `create<X>Schema` / `update<X>Schema = base.partial()`, cross-field via `.superRefine()`. Platform-admin create variants add `operatorId` (the class validator already extends `operatorId` optional per #401).

**Web**: `packages/web/src/modules/classes/*` (`ClassForm`, `ClassList`, `AddClassDialog`, etc.) + flat `app/[locale]/(business)/manage/classes/page.tsx` (JWT-scoped, no `[operatorSlug]`). i18n namespace `business.classes.*`; a new `acriss.*` namespace for the code→label dictionary.

---

## 3. Schema (`packages/shared/src/db/schema.ts`)

### 3.1 The one new column

```ts
// §2 "Class taxonomy" / §10 item 13: ACRISS 4-letter code is canonical on the
// CLASS, not the vehicle. Vehicles point at a class via the composite FK; the
// class carries the OTA-standard taxonomy code. Nullable in MVP so existing /
// operator-created classes without a mapped code still validate — the friendly
// i18n label is the renter-facing surface, the code is the integration anchor
// (future Trip.com sync, §2). Format: exactly 4 chars, A-Z + digit 9 ('9' = the
// ACRISS "or higher" wildcard slot used in some category/type cells).
acrissCode: text('acrissCode'),
```

Table extras add a CHECK (friendly DB seal; the validator rejects earlier):

```ts
check(
  'vehicle_classes_acriss_code_format',
  sql`${table.acrissCode} IS NULL OR ${table.acrissCode} ~ '^[A-Z9][A-Z9][A-Z9][A-Z9]$'`,
),
```

**No uniqueness constraint on `acrissCode`.** Multiple classes may legitimately share an ACRISS code (e.g. two "CCAR" compact classes with different photos/branding); ACRISS is a *category*, not an identity. §2 treats it as the grouping layer.

### 3.2 What does NOT change here

- `vehicles.classId`, the composite FK `vehicles_operatorId_classId_fk`, `licensePlate`, `shakenExpiryDate` — all already present (slice 1 + pre-pivot). Untouched.
- `vehicle_classes.dailyRateJpy`/`hourlyRateJpy` — **left in place.** Their removal is **slice 4c** (`drop_class_level_pricing`), explicitly sequenced *after* #388 (slice-4 plan §5 step 3). Dropping them here would collide with 4c and break the "at least one rate" service path still in use.

### 3.3 Migration

```bash
bun run db:generate --name add_acriss_code_to_vehicle_classes
bun run db:migrate
bun run db:verify   # 3 green checks (schema-snapshot / journal-disk / journal-DB)
```

Single additive migration (one `ALTER TABLE ADD COLUMN` + one `ADD CONSTRAINT`). **Journal-order trap (CLAUDE.md 2026-04-17):** generate this migration on top of whatever #386/#387/#401 left in `drizzle/meta/_journal.json`. If this branch rebases after another slice merges, **regenerate** rather than hand-editing `when`. CI `db-drift` enforces.

---

## 4. Validators — `packages/shared/src/validators/vehicle-class.ts`

Add `acrissCode` to the shared `vehicleClassObjectSchema` (so both create and `.partial()` update inherit it):

```ts
// ACRISS code: exactly 4 chars, uppercase A-Z or '9'. Optional in MVP. The
// regex mirrors the DB CHECK `vehicle_classes_acriss_code_format`. Uppercased
// at the boundary so 'ccar' from a form submits as 'CCAR'.
acrissCode: z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z9]{4}$/, 'ACRISS code must be 4 letters (A-Z) or 9')
  .nullish(),
```

- `createVehicleClassSchema` / `updateVehicleClassSchema` need **no `.superRefine()` change** — the field is independent of the pricing rule.
- The existing `operatorId` extend on `createVehicleClassSchema` (#401) is unchanged.
- **Structural validation is deferred.** A future `validateAcrissStructure()` helper could check each *position* against the ACRISS axis it encodes (category / type / transmission-drive / fuel-air). MVP ships the 4-char-format check only because operators may enter codes the seed dictionary does not list.

Export `ACRISS_CODES` (the seed dictionary keys) as `as const` from a new shared module (§5) so the form can offer a typeahead and tests can assert membership.

---

## 5. ACRISS taxonomy seed + i18n

### 5.1 The dictionary — `packages/shared/src/acriss.ts` (new, runtime-dep-free)

`packages/shared` has **no runtime deps on api/web** (AGENTS.md) — this is a pure const module, importable by seed, validators, api, and web.

```ts
// ACRISS code → translation KEY (not literal text). Labels live in
// messages/*.json under the `acriss` namespace so en/ja/zh render per locale
// (§4 platform item 2, §8.2). MVP subset = the 6-8 codes the demo seed needs
// (proposal §9 item 9: "6-8 ACRISS codes" is the credibility floor).
export const ACRISS_CODES = {
  MCAR: 'acriss.MCAR', // Mini, Car, manual, unspecified fuel
  ECAR: 'acriss.ECAR', // Economy
  CCAR: 'acriss.CCAR', // Compact  <-- demo target (Toyota Yaris)
  ICAR: 'acriss.ICAR', // Intermediate
  SCAR: 'acriss.SCAR', // Standard
  FCAR: 'acriss.FCAR', // Fullsize
  IVAR: 'acriss.IVAR', // Intermediate passenger van (minivan)
  SUVR: 'acriss.SUVR', // SUV  (note: not strictly ACRISS axis-pure; demo label)
} as const

export type AcrissCode = keyof typeof ACRISS_CODES
```

> ACRISS axes for reference (informational; MVP does not enforce positionally):
> pos1 category, pos2 type, pos3 transmission+drive, pos4 fuel+AC. `CCAR` = Compact / 2-4dr car / manual unspecified / unspecified-fuel-with-AC.

### 5.2 i18n labels — `packages/web/messages/{en,ja,zh}.json`

New top-level `acriss` namespace, one entry per `ACRISS_CODES` key:

```jsonc
// en.json
"acriss": { "CCAR": "Compact", "ECAR": "Economy", "IVAR": "Minivan", ... }
// ja.json
"acriss": { "CCAR": "コンパクト", "ECAR": "エコノミー", "IVAR": "ミニバン", ... }
// zh.json
"acriss": { "CCAR": "紧凑型", "ECAR": "经济型", "IVAR": "商务车", ... }
```

Plus `business.classes.form.acrissCode` (+ placeholder + hint) in all three. **Restart dev server after adding namespaces** (CLAUDE.md i18n gotcha: `rm -rf packages/web/.next && bun run dev`). **Verify locale parity** — the `lint:i18n` parity check (#375) fails CI on a missing key; conflict resolution silently drops keys (CLAUDE.md).

### 5.3 Class seed — `packages/shared/src/db/seed.ts`

Today the seed inserts only `SEED_VEHICLES` against the Best Car Rental operator; **no `vehicle_classes` rows are seeded**. Add a `SEED_CLASSES` array (operator = Best Car Rental, `operatorId = BEST_CAR_RENTAL_OPERATOR_ID`) with `acrissCode` set per class so the demo "Toyota Yaris in CCAR" works end-to-end, and so seeded vehicles can attach via the composite FK. Keep class `dailyRateJpy`/`hourlyRateJpy` for now (removed in 4c). Idempotent insert (mirror the existing `onConflictDoNothing` pattern).

---

## 6. Repo / Service / Routes / Web — threading `acrissCode`

Pure plumbing; no new interface methods.

| Layer | File | Change |
|---|---|---|
| **Type** | `packages/api/src/stores.ts` `VehicleClass` | add `acrissCode: string | null` |
| **Drizzle columns** | `repositories/drizzle/shared.ts` `vehicleClassColumns` + `toVehicleClass` | add `acrissCode: vehicleClasses.acrissCode` and map it |
| **Drizzle repo** | `repositories/drizzle/vehicle-class.ts` `create`/`update` | pass `acrissCode` through (operator scoping already present — untouched) |
| **InMemory repo** | `repositories/in-memory/vehicle-class.ts` | persist/return `acrissCode` |
| **Repo interface** | `repositories/types.ts` | no signature change (data shape via `VehicleClass`) |
| **Service** | `services/vehicle-class.ts` | no logic change — `create`/`update` already spread the data object |
| **Route** | `routes/vehicle-classes.ts` `POST`/`PATCH` | add `acrissCode: d.acrissCode ?? null` to the create object; `PATCH` uses `stripUndefined(parsed.data)` so it flows automatically |
| **Web type/api** | `modules/classes/api.ts`, `hooks.ts` | type carries through (uses `CreateVehicleClassInput`) |
| **Web form** | `modules/classes/components/ClassForm.tsx` | add an ACRISS field: a `<select>` of `ACRISS_CODES` keys rendering `t('acriss.<code>')` labels (typeahead/datalist optional), bound via `register('acrissCode')`; label from `t('form.acrissCode')` |
| **Web display** | `ClassRow.tsx` / `ClassCatalogCard.tsx` / `ClassDetailView.tsx` | render the friendly label `t('acriss.<code>')` next to class name (the renter-facing grouping label, §2) |

**Vehicle CRUD: no code change.** `routes/vehicles.ts`, `validators/vehicle.ts`, `DrizzleVehicleRepository` already handle plate, shaken, operator scope, and `classId` via composite FK. This slice only adds **tests** (§7) proving the acceptance criteria, plus surfacing the class's ACRISS label on the vehicle list (web, read-only, via the already-loaded class).

---

## 7. Tests (TDD vertical-slice, mutation-resistant)

Mirror `packages/api/tests/integration/rls-context.test.ts` (seed operator A + operator B + their `OPERATOR_STAFF` users; assert isolation both directions). One failing test → implement → repeat (no horizontal batching, per `~/.claude/rules/testing.md`).

| Layer | New ACRISS work | Vehicle-CRUD acceptance proof (regression) |
|---|---|---|
| **Validator** (`packages/shared/test/validators/`) | `'CCAR'` accepted; `'ccar'` accepted and uppercased to `'CCAR'`; `'CCA'` (3) rejected; `'CCARX'` (5) rejected; `'cc-r'` rejected; `null`/omitted accepted (nullish) | existing plate/shaken rules still pass (no change expected) |
| **InMemory repo** | `create`/`update` round-trips `acrissCode`; op-A staff cannot **read** op-B class (`findById`/`findAll` scoped via `operatorReadScope`) — `update`/`archive` take no `CallerContext`, so mutation isolation is **not** a repo-test concern (proven at the service, below); RENTER/anonymous (`PUBLIC_CONTEXT`) read across operators (catalog is public) but only ACTIVE | op-A staff cannot create/read/update/softDelete op-B vehicle; bypass roles see both |
| **Drizzle repo** (Neon `test`) | inserting `acrissCode='cc'` (lowercase, len 2) → 23514 check_violation; valid 4-char code persists | composite FK `(operatorId, classId)` rejects a vehicle whose class belongs to another operator → 23503 (already covered by #395/#400 — keep the assertion) |
| **Service** | class `create`/`update` returns `acrissCode`; **op-A `update`/`archive` of an op-B class → 404** (caller-scoped `findById(ctx,id)` runs before the unscoped `repo.update(id)`/`archive(id)` — this is the mutation-isolation seal); slug-uniqueness 409 still holds; archive-with-active-bookings 409 still holds | n/a (no vehicle service) |
| **Route** | `POST /vehicle-classes` with bad ACRISS → 400 (Zod via `parseBody`); `GET /vehicle-classes` (public) returns `acrissCode` | `POST /vehicles` cross-operator: operator caller's `operatorId` stamped from token, body `operatorId` ignored; missing/ambiguous operator for a bypass caller → 422 (`OperatorRequiredError`); 401/403/404 matrix |
| **Web** | `ClassForm` renders the ACRISS select with translated labels; submitting selects the code | `ClassRow`/catalog renders `t('acriss.CCAR')` = "Compact" |
| **i18n** | parity test: every `ACRISS_CODES` key exists in en/ja/zh `acriss` namespace | — |

**E2E:** none required for slice 3 (operator-portal only; renter-facing E2E starts slice 5 per proposal §6.1). The existing #338/#345 mock-API E2E re-seed against the marketplace shape and must stay green (§6.2(b)).

---

## 8. Merge gate (proposal §6.1)

All green before merge:
`bun run test` · `bun run lint` · `bun run --filter @kuruma/api lint:boundaries` · `bun run lint:modules` · `bun run db:verify` (3 green) · `bun run lint:i18n` parity (#375) · code-reviewer + architect agents (`memory/feedback_review-before-ship`).

---

## 9. Execution order & worktrees

```bash
# Branch from the remote pivot; local marketplace-pivot is known to lag.
git worktree add ../kuruma-acriss -b feature/388-acriss-vehicle-crud origin/marketplace-pivot
cd ../kuruma-acriss && bun install && bunx tsc --noEmit   # fresh-worktree hygiene (CLAUDE.md)
```

Within the worktree, one vertical RED→GREEN→REFACTOR cycle per row:

1. **Schema** — `acrissCode` column + CHECK; `db:generate --name add_acriss_code_to_vehicle_classes` → `db:migrate` → `db:verify`.
2. **Shared dictionary** — `acriss.ts` (`ACRISS_CODES`) + validator field (RED validator test first).
3. **Type + repos** — `VehicleClass.acrissCode`, drizzle columns/mapper, in-memory (RED repo round-trip + isolation tests first).
4. **Service + route** — thread through (RED route test first); Drizzle integration test against Neon `test`.
5. **Seed** — `SEED_CLASSES` with ACRISS codes (incl. CCAR for the Yaris).
6. **i18n** — `acriss` namespace + `business.classes.form.acrissCode` in en/ja/zh; restart dev; parity check.
7. **Web** — `ClassForm` ACRISS select; class/vehicle list label display.
8. **Vehicle-CRUD acceptance tests** — prove tenant isolation + plate/shaken (no impl expected).
9. Review (code-reviewer + architect) → rebase onto `origin/marketplace-pivot` → PR (`Closes #388`).

Conventional commits, small + focused. Never force-push; always rebase (`memory/feedback_no-force-push`).

---

## 10. Cross-slice boundary (what does NOT ship here)

| Concern | Belongs to | Citation |
|---|---|---|
| **Drop `vehicle_classes.dailyRateJpy`/`hourlyRateJpy`** + move pricing to vehicle-only | **Slice 4c** (#389c) | slice-4 plan §5; proposal §5.1 step 4. Sequenced *after* #388. Class pricing stays untouched here. |
| **Insurance options / fee schedules** | **Slice 4a/4b** | proposal §6 row 4 |
| **Renter storefront search / per-class availability summaries / "from ¥X"** | **Slice 5** (#391) | proposal §6 row 5, §10 item 21 |
| **Booking with requested/assigned vehicle, fee snapshot, exclusion constraint** | **Slice 6** (#392) | proposal §6 row 6, §10 item 14 |
| **Locations CRUD + `vehicles.pickupLocationId` operational attach** | **Slice 2** (#387) — PR #414 in review | proposal §6 row 2 (column exists on the slice-2 branch; bookings attach in slice 6) |
| **Structural/positional ACRISS validation, full ACRISS table (~hundreds of codes)** | Post-MVP refinement | §2 reversibility ("rename labels"); MVP needs only the seed subset |
| **Sha-ken expiry reminder UX** | Post-MVP | proposal §9 item 8 ("data column required now; reminder UX is post-MVP" — column already exists) |

---

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Branching off a stale local `marketplace-pivot` | Medium | High | §1 precondition: create worktrees from `origin/marketplace-pivot` or fast-forward the local tracking branch before `git worktree add`; confirm #386 + #401 are present |
| Migration journal `when` collision with concurrent slice-2/4 branches | Medium | Medium | Single additive migration; regenerate (not hand-edit) on rebase; `db:verify` + CI `db-drift` (CLAUDE.md 2026-04-17) |
| i18n keys dropped in conflict resolution → blank ACRISS labels | Medium | Low | `lint:i18n` parity test (#375) as a merge gate; explicit parity test in §7 |
| Scope creep into vehicle-CRUD reimplementation | Medium | Medium | §0 honest-scope note: vehicle CRUD + plate/shaken already merged; slice adds tests, not code |
| ACRISS CHECK regex rejects a legitimately weird code operators enter | Low | Low | MVP regex is permissive (`[A-Z9]{4}`), no positional validation; structural check deferred |
| Accidentally dropping class pricing here, colliding with 4c | Low | Medium | §3.2 + §10: class pricing explicitly untouched; 4c owns the drop |

---

## 12. Critical files

**New:** `packages/shared/src/acriss.ts`; migration `drizzle/00NN_add_acriss_code_to_vehicle_classes.sql` (+ snapshot/journal).
**Modify (shared):** `db/schema.ts` (column + CHECK), `validators/vehicle-class.ts` (field), `db/seed.ts` (`SEED_CLASSES`).
**Modify (api):** `stores.ts` (`VehicleClass.acrissCode`), `repositories/drizzle/shared.ts` (columns + `toVehicleClass`), `repositories/drizzle/vehicle-class.ts`, `repositories/in-memory/vehicle-class.ts`, `routes/vehicle-classes.ts`.
**Modify (web):** `modules/classes/components/ClassForm.tsx`, `ClassRow.tsx`, `ClassCatalogCard.tsx`, `ClassDetailView.tsx`; `messages/{en,ja,zh}.json` (`acriss.*` + `business.classes.form.acrissCode`).
**Unchanged (proof-only):** `routes/vehicles.ts`, `validators/vehicle.ts`, `repositories/{drizzle,in-memory}/vehicle.ts`, `tenancy.ts`, `middleware/auth.ts`.

---

## 13. Resolved decisions

1. **ACRISS validation depth.** Defer positional/structural validation. MVP ships 4-char-format only (`[A-Z9]{4}`) so operators can enter codes outside the seed dictionary without false rejects.
2. **`acrissCode` nullable vs required.** Nullable for operator-created classes; every demo seed class carries a code. This keeps the integration anchor without blocking manual class creation.
3. **ACRISS seed subset size.** Use the 8-code subset in §5.1. Du can refine ja/zh label wording during discovery without changing the schema/API contract.
4. **`SUVR` purity.** Keep `SUVR` as a pragmatic demo label. The field is format-validated, not dictionary-gated; a stricter OTA table can replace the subset post-MVP.
5. **`CallerContext` on class mutations (relayed review note, 2026-06-02).** Keep the repo shape — `VehicleClassRepository.update(id, data)`/`archive(id)` do **not** take `CallerContext`; do not expand the interface. Mutation isolation is proven at the **service**: `VehicleClassService.update(ctx, id)`/`archive(ctx, id)` call caller-scoped `findById(ctx, id)` first → 404 for another operator's class. §7 attributes read-isolation to repo tests and mutation-isolation to service/route tests accordingly. (Option 1 from the review note; matches the implemented shape on `marketplace-pivot`.)

---

## 14. Review log

**v1 (2026-06-02)** — initial draft. Grounded against `origin/marketplace-pivot` + PR #414 slice-2 code (tenancy.ts, vehicle/class repos, routes, validators, seed, ClassForm). Key finding surfaced: plate/shaken/vehicle-operator-scoping already merged; net-new = `acrissCode` on `vehicle_classes` + taxonomy seed + i18n. Awaiting reviewer green light.
