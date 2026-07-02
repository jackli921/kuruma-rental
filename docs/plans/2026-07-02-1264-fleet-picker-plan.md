# Picker-ize `/manage/fleet` (#1264) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `PLATFORM_ADMIN` operate `/manage/fleet` (list + detail) as a picked operator — narrowed reads, enabled writes carrying the operator, class + pickup-location dropdowns scoped to the operator, all-mode read-only + operator-labeled rows.

**Architecture:** Web-only (`packages/web`); the API already bypass-gates the fleet-overview read and authorizes `PLATFORM_ADMIN` vehicle writes by id. Bottom-up: scope the option fetches → register the route → thread `pickedOperatorId` through the form/sheet → badge the leaves → adopt `scope` in the view + wire the list route → wire the detail route. Design: `docs/plans/2026-07-01-1264-fleet-picker-design.md`.

**Tech Stack:** Vite, TanStack Router + Query, React Hook Form + Zod, use-intl, Vitest + Testing Library, Biome. Run web tests from `packages/web`: `bunx vitest run <path>` (NOT `bun test`).

**The one scope rule (used throughout):** the form's dropdown operator is `vehicle?.operatorId ?? pickedOperatorId` — create uses the pick, edit uses the row's own operator (composite-FK correctness). The create body carries `operatorId` only when picked.

---

### Task 1: Scope the class + pickup-location option fetches by operator

**Files:**
- Modify: `packages/web/src/vite/operator-fleet/api.ts:277-319`
- Test: `packages/web/tests/vite/operator-fleet/api.test.ts:317-330` (extend)

- [ ] **Step 1: Write failing tests** — append to the `fetchVehicleClassOptions` describe and add key + location tests in `api.test.ts`:

```typescript
  it('scopes the class read to the picked operator (#1264)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchVehicleClassOptions('op_9')
    const parsed = new URL(fetchMock.mock.calls[0]![0] as string, 'http://x')
    expect(parsed.pathname).toBe('/api/vehicle-classes/manage')
    expect(parsed.searchParams.get('operatorId')).toBe('op_9')
    expect(parsed.searchParams.has('includeAll')).toBe(false)
  })
})

describe('vehicleClassOptionsQueryOptions (#1264 key parity)', () => {
  it('keys by "all" when unpicked', () => {
    expect(vehicleClassOptionsQueryOptions().queryKey).toEqual(['operator-fleet', 'class-options', 'all'])
  })
  it('keys by the picked operator', () => {
    expect(vehicleClassOptionsQueryOptions('op_9').queryKey).toEqual(['operator-fleet', 'class-options', 'op_9'])
  })
})

describe('fetchPickupLocationOptions (#1264 scoping)', () => {
  it('keeps includeArchived and opts into includeAll when unpicked', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchPickupLocationOptions()
    const parsed = new URL(fetchMock.mock.calls[0]![0] as string, 'http://x')
    expect(parsed.pathname).toBe('/api/locations')
    expect(parsed.searchParams.get('includeArchived')).toBe('true')
    expect(parsed.searchParams.get('includeAll')).toBe('true')
  })
  it('scopes to the picked operator (keeps includeArchived, drops includeAll)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchPickupLocationOptions('op_9')
    const parsed = new URL(fetchMock.mock.calls[0]![0] as string, 'http://x')
    expect(parsed.searchParams.get('includeArchived')).toBe('true')
    expect(parsed.searchParams.get('operatorId')).toBe('op_9')
    expect(parsed.searchParams.has('includeAll')).toBe(false)
  })
})
```

Add `fetchPickupLocationOptions`, `vehicleClassOptionsQueryOptions` to the top-of-file import from `@/vite/operator-fleet/api`.

- [ ] **Step 2: Run — expect FAIL**

Run: `cd packages/web && bunx vitest run tests/vite/operator-fleet/api.test.ts`
Expected: FAIL (`fetchVehicleClassOptions` takes no arg; key is 2-element; `operatorId` absent).

- [ ] **Step 3: Implement** — in `api.ts`, add the import and rewrite the four functions:

```typescript
import { buildScopeParam } from '@/vite/operator-context'
```

```typescript
export async function fetchVehicleClassOptions(operatorId?: string): Promise<VehicleClassOption[]> {
  // `/manage` is the session-authed class list (#528). buildScopeParam sends
  // `operatorId=X` when a bypass admin picked one (#1264 — matches the vehicle's
  // operator so the composite FK holds), else `includeAll=true` (the bypass-role
  // cross-operator read contract; OPERATOR_* callers stay scoped by the API).
  const res = await fetch(`${getApiBaseUrl()}/vehicle-classes/manage?${buildScopeParam(operatorId)}`, {
    credentials: 'include',
  })
  return unwrap(res, vehicleClassOptionsListSchema)
}

export function vehicleClassOptionsQueryOptions(operatorId?: string) {
  return queryOptions({
    queryKey: ['operator-fleet', 'class-options', operatorId ?? 'all'],
    queryFn: () => fetchVehicleClassOptions(operatorId),
  })
}
```

```typescript
export async function fetchPickupLocationOptions(operatorId?: string): Promise<PickupLocationOption[]> {
  // `includeArchived=true` keeps a since-archived assigned location resolvable for
  // the edit fallback. buildScopeParam narrows to the picked operator (#1264) or
  // opts into the cross-operator read for a bypass admin; OPERATOR_* stay scoped.
  const res = await fetch(
    `${getApiBaseUrl()}/locations?includeArchived=true&${buildScopeParam(operatorId)}`,
    { credentials: 'include' },
  )
  return unwrap(res, pickupLocationOptionsListSchema)
}

export function pickupLocationOptionsQueryOptions(operatorId?: string) {
  return queryOptions({
    queryKey: ['operator-fleet', 'location-options', operatorId ?? 'all'],
    queryFn: () => fetchPickupLocationOptions(operatorId),
  })
}
```

Leave `fetchOperatorFleet` / `operatorFleetQueryOptions` UNCHANGED (the aggregate wants no param when unpicked, not `includeAll`).

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/web && bunx vitest run tests/vite/operator-fleet/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/operator-fleet/api.ts packages/web/tests/vite/operator-fleet/api.test.ts
git commit -m "feat(#1264): scope fleet class + pickup-location option reads to the picked operator"
```

---

### Task 2: Register the fleet LIST route as a picker route

**Files:**
- Modify: `packages/web/src/vite/operator-context/operator-context.ts:97-106`
- Test: `packages/web/tests/vite/operator-context/operator-context.test.ts` (or the file holding `OPERATOR_CONTEXT_ROUTE_IDS` assertions — grep first)

- [ ] **Step 1: Write failing test** — assert the list route IS a picker route and the detail route is NOT:

```typescript
import { OPERATOR_CONTEXT_ROUTE_IDS } from '@/vite/operator-context'

it('treats the fleet list as a picker route but not the by-id detail route (#1264)', () => {
  expect(OPERATOR_CONTEXT_ROUTE_IDS.has('/$locale/_business/manage/fleet/')).toBe(true)
  expect(OPERATOR_CONTEXT_ROUTE_IDS.has('/$locale/_business/manage/fleet/$vehicleId')).toBe(false)
})
```

(First: `grep -rn "OPERATOR_CONTEXT_ROUTE_IDS" packages/web/tests` to place it next to the existing membership tests.)

- [ ] **Step 2: Run — expect FAIL** (`fleet/` not in the set).

Run: `cd packages/web && bunx vitest run tests/vite/operator-context`

- [ ] **Step 3: Implement** — add one line to the set (keep the detail route out):

```typescript
  '/$locale/_business/manage/fees',
  '/$locale/_business/manage/fleet/', // slice 4 residual (#1264) — list reads narrow; detail is by-id, intentionally NOT registered
  '/$locale/_business/manage/insurance',
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/operator-context/operator-context.ts packages/web/tests/vite/operator-context/
git commit -m "feat(#1264): register /manage/fleet list as a picker route"
```

---

### Task 3: Thread `pickedOperatorId` through EditVehicleSheet + VehicleForm (dropdown scope + create body)

**Files:**
- Modify: `packages/web/src/vite/operator-fleet/EditVehicleSheet.tsx:12-38, 48-54`
- Modify: `packages/web/src/vite/operator-fleet/VehicleForm.tsx:51-62, 128-134, 184-191`
- Test: `packages/web/tests/vite/operator-fleet/VehicleForm.test.tsx`

- [ ] **Step 1: Write failing tests** — in `VehicleForm.test.tsx`, add a picked-create and a no-pick create case (mirror the existing `createVehicle` mock at the top of that file — grep `vi.mock` / `createVehicle`):

```typescript
it('injects the picked operatorId into the create body (#1264)', async () => {
  renderForm({ vehicle: null, pickedOperatorId: 'op_9' })
  fireEvent.change(screen.getByLabelText(en.form.name), { target: { value: 'New Car' } })
  fireEvent.click(screen.getByRole('button', { name: en.form.save }))
  await waitFor(() => expect(vi.mocked(createVehicle)).toHaveBeenCalled())
  expect(vi.mocked(createVehicle).mock.calls[0]![0]).toMatchObject({ operatorId: 'op_9' })
})

it('omits operatorId from the create body when no operator is picked (#1264)', async () => {
  renderForm({ vehicle: null })
  fireEvent.change(screen.getByLabelText(en.form.name), { target: { value: 'New Car' } })
  fireEvent.click(screen.getByRole('button', { name: en.form.save }))
  await waitFor(() => expect(vi.mocked(createVehicle)).toHaveBeenCalled())
  expect(vi.mocked(createVehicle).mock.calls[0]![0]).not.toHaveProperty('operatorId')
})
```

Update the `renderForm` helper to accept `{ vehicle, pickedOperatorId }` and pass `pickedOperatorId` to `<VehicleForm>`. (If create requires more fields to pass validation, fill them exactly as the existing "creates a vehicle" test in this file does — reuse its field-fill block; do not invent new required fields.)

- [ ] **Step 2: Run — expect FAIL** (`VehicleForm` has no `pickedOperatorId` prop; body has no `operatorId`).

Run: `cd packages/web && bunx vitest run tests/vite/operator-fleet/VehicleForm.test.tsx`

- [ ] **Step 3a: Implement `VehicleForm.tsx`** — add the prop (3rd generic already `CreateVehicleInput`, which includes optional `operatorId`, so NO `WithOperatorId` wrapper) and inject on the create branch:

Props interface (after `vehicle`):
```typescript
  /** When a bypass admin has picked an operator, the create body carries it (#1264). */
  readonly pickedOperatorId?: string | undefined
```
Destructure it in the component signature. Then the mutation:
```typescript
  const mutation = useMutation({
    mutationFn: (data: CreateVehicleInput) =>
      isEditMode
        ? updateVehicle(vehicle.id, data, csrfToken)
        : createVehicle(
            pickedOperatorId ? { ...data, operatorId: pickedOperatorId } : data,
            csrfToken,
          ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: FLEET_QUERY_KEY })
      onSaved()
    },
  })
```

- [ ] **Step 3b: Implement `EditVehicleSheet.tsx`** — add `pickedOperatorId` prop, compute the scope rule, scope both option queries, forward to the form:

Props interface (after `vehicle`):
```typescript
  /** The picked operator (create scope + create body); undefined for operator sessions. */
  readonly pickedOperatorId?: string | undefined
```
Body:
```typescript
export function EditVehicleSheet({ open, vehicle, onOpenChange, onSaved, pickedOperatorId }: EditVehicleSheetProps) {
  const t = useTranslations('business.vehicles')
  // Scope rule: edit → the vehicle's own operator (composite-FK correctness);
  // create → the picked operator. Never the ambient pick while editing (#1264).
  const dropdownOperatorId = vehicle?.operatorId ?? pickedOperatorId
  const { data: classOptions } = useQuery({
    ...vehicleClassOptionsQueryOptions(dropdownOperatorId),
    enabled: open,
  })
  const { data: locationOptions } = useQuery({
    ...pickupLocationOptionsQueryOptions(dropdownOperatorId),
    enabled: open,
  })
  const isEdit = vehicle != null
```
And in the render, pass to the form:
```typescript
          <VehicleForm
            vehicle={vehicle}
            classOptions={classOptions ?? []}
            locationOptions={locationOptions ?? []}
            pickedOperatorId={pickedOperatorId}
            onSaved={onSaved}
            onCancel={() => onOpenChange(false)}
          />
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/operator-fleet/EditVehicleSheet.tsx packages/web/src/vite/operator-fleet/VehicleForm.tsx packages/web/tests/vite/operator-fleet/VehicleForm.test.tsx
git commit -m "feat(#1264): scope vehicle-form dropdowns by vehicle operator + carry picked operatorId in create body"
```

---

### Task 4: Badge the fleet leaves (all-mode operator label)

**Files:**
- Modify: `packages/web/src/vite/operator-fleet/FleetTable.tsx:9-24, 91-105`
- Modify: `packages/web/src/vite/operator-fleet/FleetVehicleCard.tsx:10-20, 69-76`
- Modify: `packages/web/src/vite/operator-fleet/FleetGrid.tsx:8-26, 34-47, 127-138`
- Test: `packages/web/tests/vite/operator-fleet/FleetVehicleCard.test.tsx` (grep the existing render helper)

Each leaf takes an OPTIONAL `operatorNameFor` resolver (optional = existing tests/callers keep compiling; only the container in Task 5 supplies it).

- [ ] **Step 1: Write failing test** — in `FleetVehicleCard.test.tsx`, add:

```typescript
import { OperatorBadge } from '@/vite/operator-context' // (only if needed for label text)

it('renders the operator badge when a resolver returns a name (#1264 all-mode)', () => {
  renderCard(vehicle({ id: 'v1', operatorId: 'op-1' }), { operatorNameFor: () => 'Sakura Mobility' })
  expect(screen.getByText('Operator: Sakura Mobility')).toBeInTheDocument()
})

it('renders no operator badge when the resolver is absent (operator session)', () => {
  renderCard(vehicle({ id: 'v1' }))
  expect(screen.queryByText(/^Operator:/)).toBeNull()
})
```

Update `renderCard` to accept an optional 2nd arg `{ operatorNameFor }` and spread it onto `<FleetVehicleCard>`. (`OperatorBadge` renders `aria-label` `Operator: {name}` and the name as text — assert the visible name text `Sakura Mobility` if the `Operator:` prefix is aria-only; grep `messages/en.json` `business.operatorContext.badge` — it is `"Operator: {name}"`, used as `aria-label`, and the child text is just `{name}`. So assert `getByText('Sakura Mobility')` and, for absence, `queryByText('Sakura Mobility')` is null.)

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd packages/web && bunx vitest run tests/vite/operator-fleet/FleetVehicleCard.test.tsx`

- [ ] **Step 3a: `FleetVehicleCard.tsx`** — import + prop + render beside the name Link:

```typescript
import { OperatorBadge } from '@/vite/operator-context'
```
Prop (after `locale`):
```typescript
  /** All-mode only: resolves the per-vehicle operator label; undefined ⇒ no badge (#1264). */
  readonly operatorNameFor?: ((vehicle: OperatorFleetVehicle) => string | undefined) | undefined
```
Render (replace the name Link block at 70-76):
```typescript
          <div className="flex items-center gap-2">
            <Link
              to="/$locale/manage/fleet/$vehicleId"
              params={{ locale, vehicleId: vehicle.id }}
              className="min-w-0 flex-1 truncate font-medium hover:underline"
            >
              {vehicle.name}
            </Link>
            <OperatorBadge name={operatorNameFor?.(vehicle)} />
          </div>
```

- [ ] **Step 3b: `FleetTable.tsx`** — same import + prop; render beside the name Link (wrap the Link at 92-98):

```typescript
                <div className="flex items-center gap-2">
                  <Link
                    to="/$locale/manage/fleet/$vehicleId"
                    params={{ locale, vehicleId: v.id }}
                    className="font-medium hover:underline"
                  >
                    {v.name}
                  </Link>
                  <OperatorBadge name={operatorNameFor?.(v)} />
                </div>
```
Prop:
```typescript
  readonly operatorNameFor?: ((vehicle: OperatorFleetVehicle) => string | undefined) | undefined
```

- [ ] **Step 3c: `FleetGrid.tsx`** — add the optional prop and forward it to each `<FleetVehicleCard>`:

```typescript
  readonly operatorNameFor?: ((vehicle: OperatorFleetVehicle) => string | undefined) | undefined
```
Destructure it, then in the card render (127-138) add `operatorNameFor={operatorNameFor}`.

- [ ] **Step 4: Run — expect PASS** (and the full leaf suites still green):

Run: `cd packages/web && bunx vitest run tests/vite/operator-fleet/FleetVehicleCard.test.tsx tests/vite/operator-fleet/FleetTable.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/operator-fleet/FleetTable.tsx packages/web/src/vite/operator-fleet/FleetVehicleCard.tsx packages/web/src/vite/operator-fleet/FleetGrid.tsx packages/web/tests/vite/operator-fleet/FleetVehicleCard.test.tsx
git commit -m "feat(#1264): render operator badge on fleet rows/cards via optional resolver"
```

---

### Task 5: Adopt `scope` in OperatorFleetView + wire the list route

Landed together so the build stays green (the view's prop change and the route's call site change in one commit).

**Files:**
- Modify: `packages/web/src/vite/operator-fleet/OperatorFleetView.tsx:1-45, 99-148`
- Modify: `packages/web/src/routes/$locale/_business/manage/fleet/index.tsx:1-85`
- Test: `packages/web/tests/vite/operator-fleet/OperatorFleetView.test.tsx:94-113` (renderView helper), `packages/web/tests/vite/operator-fleet/OperatorFleetRoute.test.tsx`

- [ ] **Step 1a: Update `OperatorFleetView.test.tsx`** — change `renderView` to pass a `scope` object instead of `canWrite`, and add an all-mode badge test:

```typescript
import type { OperatorScope } from '@/vite/operator-context'

const writableScope: OperatorScope = {
  pickedOperatorId: undefined,
  canWrite: true,
  showOperator: false,
  operatorNameById: new Map(),
}

function renderView(
  vehicles: OperatorFleetVehicle[],
  scope: OperatorScope = writableScope,
  classOptions: VehicleClassOption[] = [],
) {
  return render(
    <IntlProvider locale="en" messages={enMessages}>
      <OperatorFleetView vehicles={vehicles} classOptions={classOptions} scope={scope} locale="en" />
    </IntlProvider>,
  )
}
```
Existing calls that passed `canWrite={false}` become `renderView(list, { ...writableScope, canWrite: false })`. Add:
```typescript
it('labels each row with its operator in all-mode (#1264)', () => {
  const scope: OperatorScope = {
    pickedOperatorId: undefined,
    canWrite: false,
    showOperator: true,
    operatorNameById: new Map([['op-1', 'Sakura Mobility']]),
  }
  renderView([vehicle({ id: 'a', name: 'Car A', operatorId: 'op-1' })], scope)
  expect(screen.getByText('Sakura Mobility')).toBeInTheDocument()
})
```
(Check `vehicle()` factory includes `operatorId`; if not, add it to the factory default.)

- [ ] **Step 1b: Run — expect FAIL** (`OperatorFleetView` still takes `canWrite`, not `scope`).

Run: `cd packages/web && bunx vitest run tests/vite/operator-fleet/OperatorFleetView.test.tsx`

- [ ] **Step 2a: Implement `OperatorFleetView.tsx`** — replace the `canWrite` prop with `scope`, derive the resolver, thread it + `pickedOperatorId`:

Imports:
```typescript
import type { OperatorFleetVehicle, VehicleClassOption } from '@/vite/operator-fleet/api'
import type { OperatorScope } from '@/vite/operator-context'
```
Props: replace the `canWrite` field with:
```typescript
  // The operator-context scope (picked id, write gate, all-mode labeling). The
  // route derives it from the session + picker; the view is presentational (#1264).
  readonly scope: OperatorScope
```
Signature + derivations (top of the component):
```typescript
export function OperatorFleetView({ vehicles, classOptions, scope, locale, initialFilters }: OperatorFleetViewProps) {
  const t = useTranslations('business.vehicles.fleet')
  const { canWrite, pickedOperatorId, showOperator, operatorNameById } = scope
  const operatorNameFor = (v: OperatorFleetVehicle) =>
    showOperator ? operatorNameById.get(v.operatorId) : undefined
  // ...existing state hooks unchanged...
```
Pass `operatorNameFor={operatorNameFor}` to both `<FleetGrid>` and `<FleetTable>`. Pass `pickedOperatorId={pickedOperatorId}` to `<EditVehicleSheet>`. `canWrite` references elsewhere in the file already resolve to the destructured const.

- [ ] **Step 2b: Implement `fleet/index.tsx`** — loaderDeps (widened type), scoped reads, `useOperatorScope`, pass `scope`:

```typescript
import { PageSkeleton } from '@/vite/PageSkeleton'
import { OperatorFleetView } from '@/vite/operator-fleet/OperatorFleetView'
import { operatorFleetQueryOptions, vehicleClassOptionsQueryOptions } from '@/vite/operator-fleet/api'
import { useOperatorScope } from '@/vite/operator-context'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'
```
(Drop the now-unused `isOperatorSession` + `sessionQueryOptions` imports.) Route:
```typescript
export const Route = createFileRoute('/$locale/_business/manage/fleet/')({
  validateSearch,
  // `operator` is validated/retained on the parent `_business` route and merges
  // into this route's search at runtime; widen the type so tsc sees it (#1264).
  loaderDeps: ({ search }: { search: FleetSearch & { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(operatorFleetQueryOptions(deps.operator)),
      context.queryClient.ensureQueryData(vehicleClassOptionsQueryOptions(deps.operator)),
    ]),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorFleetError,
  component: OperatorFleetRoute,
})

export function OperatorFleetRoute() {
  const t = useTranslations('business.vehicles.fleet')
  const { locale } = Route.useParams()
  const scope = useOperatorScope()
  const { data: vehicles } = useSuspenseQuery(operatorFleetQueryOptions(scope.pickedOperatorId))
  const { data: classOptions } = useSuspenseQuery(vehicleClassOptionsQueryOptions(scope.pickedOperatorId))
  const { expiringSoon } = Route.useSearch()
  const initialFilters: FleetFilterState = expiringSoon ? { expiringSoon: true } : {}

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorFleetView
          vehicles={vehicles}
          classOptions={classOptions}
          scope={scope}
          locale={locale}
          initialFilters={initialFilters}
        />
      </div>
    </main>
  )
}
```

- [ ] **Step 2c: Add the loader key-parity test** — new `describe` in `OperatorFleetRoute.test.tsx` (mirror `OperatorClassesRoute.test.tsx:38-53`; a bare `vi.mock('@/vite/operator-context', () => ({ useOperatorScope: vi.fn() }))` is fine for a loader-only test since nothing renders):

```typescript
const loader = Route.options.loader as (args: {
  context: { queryClient: { ensureQueryData: ReturnType<typeof vi.fn> } }
  deps: { operator?: string | undefined }
}) => Promise<unknown>

it('prefetches fleet + class options scoped to the picked operator (#1264 key parity)', async () => {
  const ensureQueryData = vi.fn().mockResolvedValue([])
  await loader({ context: { queryClient: { ensureQueryData } }, deps: { operator: 'op_9' } })
  const keys = ensureQueryData.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)
  expect(keys).toContainEqual(['operator-fleet', 'op_9'])
  expect(keys).toContainEqual(['operator-fleet', 'class-options', 'op_9'])
})
```

- [ ] **Step 2d: Update `OperatorFleetRoute.test.tsx` render tests** — the component now calls `useOperatorScope()`. Add the importOriginal-spread mock (mirror `OperatorFeesRoute.test.tsx:16-22` — a bare mock makes `OperatorBadge` undefined and crashes rows):

```typescript
const useOperatorScopeMock = vi.fn<() => OperatorScope>()
vi.mock('@/vite/operator-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-context')>()
  return { ...actual, useOperatorScope: () => useOperatorScopeMock() }
})
```
Drive the existing bypass read-only test with an all-mode scope and add a picked-writable case:
```typescript
beforeEach(() => {
  useOperatorScopeMock.mockReturnValue({
    pickedOperatorId: undefined, canWrite: false, showOperator: true,
    operatorNameById: new Map([['op-1', 'Sakura Mobility']]),
  })
})
it('read-only + operator-labeled in all-mode (#1264)', () => {
  renderRoute(bypassSession)
  expect(screen.queryByRole('button', { name: en.fleet.addVehicle })).toBeNull()
  expect(screen.getByText('Sakura Mobility')).toBeInTheDocument()
})
it('enables Add when an operator is picked (#1264)', () => {
  useOperatorScopeMock.mockReturnValue({
    pickedOperatorId: 'op-1', canWrite: true, showOperator: false, operatorNameById: new Map(),
  })
  renderRoute(bypassSession)
  expect(screen.getByRole('button', { name: en.fleet.addVehicle })).toBeInTheDocument()
})
```
(Seed the two `useSuspenseQuery` reads so `renderRoute` still resolves; ensure the seeded fleet rows carry `operatorId: 'op-1'` so the badge resolves. Keep or delete the old session-driven read-only test — it is superseded by the all-mode case.)

- [ ] **Step 3: Run — expect PASS** (view + route suites):

Run: `cd packages/web && bunx vitest run tests/vite/operator-fleet/OperatorFleetView.test.tsx tests/vite/operator-fleet/OperatorFleetRoute.test.tsx`

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/vite/operator-fleet/OperatorFleetView.tsx packages/web/src/routes/$locale/_business/manage/fleet/index.tsx packages/web/tests/vite/operator-fleet/OperatorFleetView.test.tsx packages/web/tests/vite/operator-fleet/OperatorFleetRoute.test.tsx
git commit -m "feat(#1264): narrow the fleet list + writes to the picked operator, label rows in all-mode"
```

---

### Task 6: Wire the detail route (edit as picked operator, dropdowns by vehicle operator)

**Files:**
- Modify: `packages/web/src/routes/$locale/_business/manage/fleet/$vehicleId.tsx:1-40, 53-54`
- Modify: `packages/web/src/vite/operator-fleet/VehicleDetail.tsx:11-17, 27, 156-162`
- Test: `packages/web/tests/vite/operator-fleet/VehicleDetail.test.tsx`

- [ ] **Step 1: Write failing tests** — in `VehicleDetail.test.tsx`, assert the picked operatorId reaches the edit sheet's dropdown fetch as the VEHICLE's operator, and (route-level, if that test file drives the route) the gating. Add to `VehicleDetail.test.tsx`:

```typescript
it('forwards pickedOperatorId to the edit sheet (#1264)', async () => {
  const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
  vi.stubGlobal('fetch', fetchMock)
  renderDetail(detailRaw({ operatorId: 'op-veh' }), { canWrite: true, pickedOperatorId: 'op-pick' })
  fireEvent.click(screen.getByRole('button', { name: en.detail.editVehicle }))
  // Edit mode ⇒ dropdowns scope to the VEHICLE's operator, not the pick.
  await waitFor(() => {
    const classCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/vehicle-classes/manage'))
    expect(classCall).toBeDefined()
    expect(new URL(String(classCall![0]), 'http://x').searchParams.get('operatorId')).toBe('op-veh')
  })
})
```
Update `renderDetail` to accept `{ canWrite, pickedOperatorId }` and pass both to `<VehicleDetail>`. (Reuse `jsonResponse`/`detailRaw` from `api.test.ts` conventions; if `VehicleDetail.test.tsx` lacks them, define a local `jsonResponse` mirroring `api.test.ts:25-30`.)

- [ ] **Step 2: Run — expect FAIL** (`VehicleDetail` has no `pickedOperatorId` prop).

Run: `cd packages/web && bunx vitest run tests/vite/operator-fleet/VehicleDetail.test.tsx`

- [ ] **Step 3a: Implement `VehicleDetail.tsx`** — add the prop, forward it to `EditVehicleSheet`:

Prop (after `canWrite`):
```typescript
  /** Picked operator (create scope); edit scopes to the vehicle's own operator (#1264). */
  readonly pickedOperatorId?: string | undefined
```
Destructure `pickedOperatorId` in the signature, then the sheet (156-162):
```typescript
        <EditVehicleSheet
          open={editOpen}
          vehicle={row}
          onOpenChange={setEditOpen}
          onSaved={() => setEditOpen(false)}
          pickedOperatorId={pickedOperatorId}
        />
```

- [ ] **Step 3b: Implement `$vehicleId.tsx`** — swap the write gate to `canWriteAsOperator` and thread the pick:

```typescript
import { canWriteAsOperator } from '@/vite/guards'
import { useOperatorContext } from '@/vite/operator-context'
```
(Drop `isOperatorSession`.) In `VehicleDetailRoute`:
```typescript
  const { data: detail } = useSuspenseQuery(vehicleDetailQueryOptions(vehicleId))
  const { data: session } = useSuspenseQuery(sessionQueryOptions())
  const { pickedOperatorId } = useOperatorContext()
  // The detail read is by-id (any operator's vehicle under bypass scope), so the
  // pick carried from the list only gates WRITES; dropdowns scope to the vehicle's
  // own operator inside the sheet. Not a picker route — no chip here (#1264).
  const canWrite = canWriteAsOperator(session, pickedOperatorId)
```
Pass to the detail:
```typescript
          <VehicleDetail detail={detail} locale={locale} canWrite={canWrite} pickedOperatorId={pickedOperatorId} />
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cd packages/web && bunx vitest run tests/vite/operator-fleet/VehicleDetail.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/routes/$locale/_business/manage/fleet/\$vehicleId.tsx packages/web/src/vite/operator-fleet/VehicleDetail.tsx packages/web/tests/vite/operator-fleet/VehicleDetail.test.tsx
git commit -m "feat(#1264): enable picker-admin edit on the vehicle detail route (dropdowns scoped to the vehicle's operator)"
```

---

### Task 7: Full verification + PR

- [ ] **Step 1: Full web suite**

Run: `cd packages/web && bunx vitest run`
Expected: all green (watch for any residual test that asserted the old 2-element `class-options` key or the removed `canWrite` prop — fix by mirroring the patterns above).

- [ ] **Step 2: Types + lint + build**

```bash
cd packages/web && bunx tsc --noEmit
cd /Users/jack/Dev/kuruma-1264-fleet-picker && bun run lint && bun run lint:i18n-parity && bun run lint:fetch-binding && bun run lint:csrf-writes && bun run lint:deps
cd packages/web && bunx vite build   # regenerates routeTree.gen.ts
```
Expected: clean. (`lint:deps`/knip must not flag an unused `WithOperatorId` import — we never added one.)

- [ ] **Step 3: `code-reviewer` agent** on the diff vs `origin/develop`; fold any CRITICAL/HIGH.

- [ ] **Step 4: Rebase onto latest `origin/develop`**

```bash
git fetch origin && git rebase origin/develop
```
Re-run Step 1-2 after rebase. Resolve any collision in `operator-fleet/*` / `operator-context.ts` by composing, not clobbering.

- [ ] **Step 5: Push + PR**

```bash
git push -u origin feat/1264-fleet-picker
```
PR body: `Closes #1264`, `Refs #1230` (do NOT close the epic — Slice 6 Team + #1324 remain). Summarize: web-only; scoped reads + create-body operator + dropdown scoping (class & pickup-location) + all-mode badges; detail route write-enabled but not chip-registered. Note: no API/migration change.

---

## Self-Review

**Spec coverage:** §3.1 → T2; §3.2 → T5 (list) + T6 (detail); §3.3 → T1 + T3; §3.4 writes → T3 (create) + T5 (canWrite via scope) + T6 (detail canWrite); §3.5 labeling → T4 + T5; §5 tests → each task's tests + T7; §7 verification → T7. All covered.

**Placeholders:** none — every code step shows the code; test field-fills defer to the existing "creates a vehicle"/`renderX` helpers in each file (explicit reuse, not a TODO).

**Type consistency:** `operatorNameFor?: ((vehicle: OperatorFleetVehicle) => string | undefined) | undefined` identical across FleetTable/FleetGrid/FleetVehicleCard; `pickedOperatorId?: string | undefined` identical across VehicleForm/EditVehicleSheet/VehicleDetail; `scope: OperatorScope` in OperatorFleetView matches `useOperatorScope()`'s return; query keys `['operator-fleet','class-options',id]` / `['operator-fleet','location-options',id]` consistent between api.ts and the tests.
