# Plan — Operator Picker (`GET /operators` + web admin picker)

- **Issue:** #407 (P1) — hard gate before onboarding operator #2
- **Epic:** #385 (marketplace MVP) · follows #401/#400/#397
- **Branch:** `feat/operator-picker` off `origin/marketplace-pivot`
- **Date:** 2026-06-04
- **Status:** REVISED after review round 2 — AWAITING RE-REVIEW (no code written yet)

## 1. Problem / why this is a gate

`#401` removed the hardcoded Best-Car-Rental operator fallback. Write-path operator
resolution is now count-gated (`resolveOperatorIdForWrite`, `packages/api/src/tenancy.ts:61`):

1. `OPERATOR_*` callers → own tenant (from JWT `operatorId`).
2. non-operator (`PLATFORM_ADMIN` / legacy `STAFF`/`ADMIN`) → explicit body `operatorId`,
   else the sole operator if exactly one exists (`findSoleId()`), else **422**.

The web `/manage/{vehicles,classes}` create forms are STAFF/ADMIN-gated and carry **no**
`operatorId` in the JWT, so today they rely entirely on sole-operator inference. The moment a
second `operators` row exists, every admin "create vehicle / create class" returns a bare 422
with no UI to choose an operator. **That blocks operator #2 onboarding.**

## 2. Findings that shape the design (verified against code)

- `operators` table exists (`schema.ts:37`) — **no migration needed**.
- `vehicle` + `vehicle-class` create validators make `operatorId` **optional**
  (`validators/vehicle.ts:60`, `vehicle-class.ts:46`); `location` + `insurance` make it
  **required** and their web clients already send it (`web/.../locations/api.ts:9`,
  `insurance/api.ts:11`). So the inference branch is reachable **only** by vehicle/class creates.
- `findSoleId()` has a single **production** caller (`resolveOperatorIdForWrite`). The only other
  references are tests — `tests/tenancy.test.ts` (the `OperatorLookup` mocks at lines 3–11) and
  `tests/helpers/operator.ts:20` — which exercise the inference branch and the `{ findSoleId }`
  arg; both are updated alongside the removal (§5). No seed/script references it. Once the web
  always sends `operatorId`, the branch is dead in production.
- **Composite FK** `vehicles_operatorId_classId_fk` on `(operatorId, classId)` (`schema.ts:330`):
  a vehicle's class must belong to the vehicle's operator. The web `VehicleClassData` type omits
  `operatorId` (`classes/api.ts:9`) and the class dropdown lists all classes
  (`VehicleForm.tsx:89`) — so picking operator A + a class of operator B violates the FK
  (surfaces today as `422 Invalid operator`). Class options must be operator-scoped.
- `ActionResult` is `{ success, error: string }` in every action file; `withAuth` flattens
  caught errors to `e.message`, **dropping HTTP status** (`classes/actions.ts:18`,
  `lib/vehicle-actions.ts:21`). Status/code must be propagated to map 422 to a field error.
- VehicleForm has **no** pickup-location field, so the `(operatorId, pickupLocationId)` composite
  FK is not exercised by this form — out of scope.

## 3. Design

### 3a. API — `GET /operators` (list)

| Layer | File | Change |
|-------|------|--------|
| Repo iface | `repositories/types.ts:38` | add `list(): Promise<Operator[]>` |
| Drizzle | `repositories/drizzle/operator.ts` | `select().from(operators).orderBy(operators.name)` |
| In-memory | `repositories/in-memory/operator.ts` | `[...store.values()]` sorted by name |
| Service | `services/operator.ts` | `list(ctx)`: `OPERATOR_*` → only own row; platform/staff/admin → all |
| Route | `routes/operators.ts` | `GET /operators`, `FLEET_WRITE_ROLES`-gated, `ok(c, rows.map(({id,name,slug})=>…))` |

- **Response shape:** `{ id, name, slug }[]` (per issue).
- **Auth gotcha:** existing `app.use('/operators/*', requireAuth())` may not match the bare
  `/operators` path — apply `requireAuth()` to `/operators` explicitly and assert with a 401 test.

### 3b. API — retire sole-operator inference (closes the TOCTOU)

`resolveOperatorIdForWrite` (`tenancy.ts:61`) becomes a pure, no-DB function:

```
if (isOperatorRole(ctx.role)) return ctx.operatorId (or ForbiddenError)
if (inputOperatorId) return inputOperatorId
throw new OperatorRequiredError(...)
```

- **Delete** the `findSoleId()` branch, the `operators: OperatorLookup` parameter, and the
  `OperatorLookup` interface (`tenancy.ts:13`). Simplify the `index.ts:340` binding to drop the
  `operatorRepo` arg.
- **Delete** `findSoleId()` from `OperatorRepository` + both impls (now dead code).
- Non-operator writes now **require** an explicit `operatorId` (fail-closed, no read-then-write
  race). The web supplies it in every regime (see 3c), so the single-operator one-click UX is
  preserved by a hidden/default value, not by server inference.

### 3c. Web — operator picker (always submits `operatorId`)

| File | Change |
|------|--------|
| `web/src/modules/operators/api.ts` (new) | `listOperators(token)` → `client.operators.$get` (server-only; needs a token) |
| `web/src/modules/operators/actions.ts` (new) | `'use server'` `fetchOperatorsAction()` wrapping `listOperators` — **client-callable**, mirrors `fetchClassesAction` |
| vehicle + class page/dialog parents (server) | initial fetch via `listOperators` (RSC has the token), pass `operators` prop |
| `components/vehicles/VehicleForm.tsx` | operator `<select>` (label + `aria-label`) |
| `modules/classes/components/ClassForm.tsx` | same picker |

- **Always send `operatorId`.** When `operators.length === 1`: render no visible control, default
  the field to `operators[0].id` (hidden) → one-click preserved, but the body still carries an
  explicit `operatorId`. When `> 1`: render the `<select>` with an empty first option forcing an
  explicit choice.

### 3d. Web — class options scoped to operator (vehicle form)

- Add `operatorId` to web `VehicleClassData` (`classes/api.ts:9`) and ensure the API
  `GET /vehicle-classes` response includes `operatorId` (verify serializer; add if missing).
- In `VehicleForm`, filter the class `<select>` to classes whose `operatorId === selectedOperatorId`.
  Until an operator is chosen (multi-operator case), disable the class select and clear `classId`.
  With one operator, the auto-default operator means classes filter to it immediately.

### 3e. Web — map 422 → inline picker error (+ stale-list reveal)

Status must survive the server-action boundary:
- `unwrap` (web api modules): on failure, throw an `Error` carrying `status` (`res.status`).
- `withAuth` (`classes/actions.ts`, `lib/vehicle-actions.ts`): return
  `{ success: false, error, code }` where `code = 'OPERATOR_REQUIRED'` when `status === 422` and
  the message matches; **add optional `code?: string`** to these two `ActionResult` types only
  (leave the other 6 untouched — YAGNI).
- mutation hooks (`useVehicleMutation`, `classes/hooks.ts`): preserve `code` on the thrown error.
- forms: when `code === 'OPERATOR_REQUIRED'`, refetch operators via the `fetchOperatorsAction()`
  **server action** — client components carry no token, so they cannot hit the protected API
  directly — ideally behind a React Query key (`operatorKeys.all`, mirroring `classes/hooks.ts`)
  so the list and picker stay in sync, then **reveal/highlight the picker** with an inline message
  ("Select an operator to continue") instead of a raw toast. Covers the stale race (client
  believed 1 operator, server now has ≥2).

## 4. Scope item 5 (observability) — deferred

Optional in the issue. Recommend a one-line resolver log when `operatorId` is missing on a
non-operator write, so the single→multi regime change shows in telemetry. **Out of scope for this
PR → follow-up issue.**

## 5. TDD order (RED → GREEN, vertical)

API (InMemory repos):
1. `InMemoryOperatorRepository.list()` returns all seeded operators.
2. `OperatorService.list(ctx)`: platform/STAFF/ADMIN → all; `OPERATOR_OWNER` → only own row.
3. `GET /operators`: `200`→`[{id,name,slug}]` for STAFF; `OPERATOR_*` sees only own; `401`
   unauthenticated; `403` for `RENTER`.
4. `resolveOperatorIdForWrite`: non-operator + no `operatorId` → `OperatorRequiredError` (even
   with exactly one operator — inference retired); operator role → own tenant; explicit id honored.
5. Test/helper cleanup for the removal: rewrite `tests/tenancy.test.ts` (the `OperatorLookup` /
   `findSoleId` mocks) to assert the new no-DB signature + `OperatorRequiredError` when a
   non-operator caller omits `operatorId`; drop the `{ findSoleId }` arg in
   `tests/helpers/operator.ts:20`. Update any route tests that POST vehicle/class without
   `operatorId` to send it.

Web:
6. picker hidden when `operators.length === 1` **but** submit body still includes
   `operatorId === operators[0].id` (hidden single-operator submit).
7. picker shown when `> 1`; class select disabled/filtered until operator chosen; submit includes
   chosen `operatorId` + only an in-operator `classId`.
8. `422 OPERATOR_REQUIRED` → operators refetched, picker revealed, inline error shown.

## 6. Out of scope / non-goals

- No DB migration (operators table + validators already exist).
- No observability log (item 5 → follow-up).
- No operator create/edit UI (picker-only).
- No change to `location`/`insurance` resolution (already require explicit `operatorId`).
- Pickup-location scoping (no location field on the vehicle create form).

## 7. Verification (before PR)

- `bun run test` (api + web) green; `bun run lint` (whole repo) clean; `tsc --noEmit` clean.
- No `db:generate` / `db:verify` (no schema change).
- Manual: 2 operators → picker appears, class list filters per operator, write succeeds;
  1 operator → no picker, one-click still works, body carries the operatorId.

## 8. PR

- Title: `feat(marketplace): GET /operators + admin operator picker`
- Body: `Closes #407`, link epic #385, note follow-up for item 5 observability.
- Rebase on `origin/marketplace-pivot` before opening (absorb slice-4 4b/4c if merged).
