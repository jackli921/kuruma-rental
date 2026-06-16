# Search map↔list — Slice 1 Implementation Plan (fly-to + pin popup)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make selecting a result (via the row's "show on map" control *or* a map pin) **recenter the map on that pickup pin** and **open an info popup** on it — fixing "the pin reveals nothing" and "show on map does nothing visible," for the single-car (one card per pin) case.

**Architecture:** Reuse the existing two-way selection (`SearchMapList` owns `selectedId`, keyed by `locationId`; the row button and `PigeonMapAdapter` markers both set it). Add two behaviors driven off that same `selectedId`: (1) a pure `focusViewport()` that centers on the selected pin, fed into the existing uncontrolled-map remount; (2) a pigeon-maps `<Overlay>` popup whose *content* is supplied by the view via a new optional `renderSelected` prop, so the adapter stays library-only (the view keeps i18n/presentation). No route, schema, or data-shape changes.

**Tech Stack:** Vite SPA + TanStack Router; React 19; pigeon-maps; use-intl; vitest + @testing-library/react (happy-dom). Run web tests: `bun run --filter @kuruma/web test`.

**Branch/worktree:** implement on a fresh slice branch off `marketplace-pivot` (this plan + the brief live on `feat/search-map-redesign` / PR #886). Tracking issue: #885. Out of scope (follow-ups): co-location carousel + price-labeled pins (Slice 2, #885), geo-context labels + mobile Map toggle (Slice 3), card-as-affordance + explicit detail CTA wiring (needs `from`/`to` threaded into `SearchMapList`; deferred with the booking flow).

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/web/src/vite/search/viewport.ts` | modify | add pure `focusViewport(pins, anchor, selectedId)` |
| `packages/web/tests/vite/search/viewport.test.ts` | modify | cover `focusViewport` |
| `packages/web/src/vite/search/MapAdapter.ts` | modify | add optional `renderSelected` to `MapAdapterProps` |
| `packages/web/src/vite/search/PigeonMapAdapter.tsx` | modify | recenter on selection; render `<Overlay>` popup |
| `packages/web/tests/vite/search/PigeonMapAdapter.test.tsx` | modify | recenter + overlay tests (mock `Overlay`) |
| `packages/web/src/vite/search/result.ts` | modify | add `resultTitle(item)` + `resultPriceLabel(item, t)` |
| `packages/web/tests/vite/search/result.test.ts` | create | unit-test the two formatters |
| `packages/web/src/vite/search/SearchResultRow.tsx` | modify | reuse `resultPriceLabel` (DRY, behavior unchanged) |
| `packages/web/src/vite/search/SearchMapList.tsx` | modify | pass `renderSelected` (popup: title · store · price) |
| `packages/web/tests/vite/search/SearchMapList.test.tsx` | modify | popup shows when selected; absent otherwise |

---

## Task 1: `focusViewport` — center on the selected pin

**Files:** Modify `packages/web/src/vite/search/viewport.ts`; Test `packages/web/tests/vite/search/viewport.test.ts`.

- [ ] **Step 1: Write the failing tests** — append to `viewport.test.ts` (it already imports from `../../../src/vite/search/viewport`; add `focusViewport` to that import):

```ts
describe('focusViewport', () => {
  const pins = [
    { id: 'loc_namba', lat: 34.6627, lng: 135.5023 },
    { id: 'loc_umeda', lat: 34.7025, lng: 135.4959 },
  ]

  it('centers on the selected pin at the single-pin zoom', () => {
    expect(focusViewport(pins, null, 'loc_umeda')).toEqual({
      center: [34.7025, 135.4959],
      zoom: SINGLE_PIN_ZOOM,
    })
  })

  it('overrides the region anchor when a pin is selected (the selection wins)', () => {
    expect(focusViewport(pins, [34.99, 135.99], 'loc_namba').center).toEqual([34.6627, 135.5023])
  })

  it('falls back to computeViewport when nothing is selected', () => {
    expect(focusViewport(pins, null, null)).toEqual(computeViewport(pins, null))
  })

  it('falls back to computeViewport when the selected id matches no pin', () => {
    expect(focusViewport(pins, null, 'loc_ghost')).toEqual(computeViewport(pins, null))
  })
})
```

Add `SINGLE_PIN_ZOOM` and `computeViewport` to the test's existing import line if not present.

- [ ] **Step 2: Run, expect FAIL**

Run: `bun run --filter @kuruma/web test viewport`
Expected: FAIL — `focusViewport is not a function`.

- [ ] **Step 3: Implement** — append to `viewport.ts`:

```ts
/** Viewport when a result is selected: center on its pin at a close zoom so the
 *  renter sees exactly where that car is picked up. The selection wins over the
 *  fit-all / region-anchor viewport; with nothing selected (or an unknown id) it
 *  defers to computeViewport. Pure. */
export function focusViewport(
  pins: Pin[],
  anchor: [number, number] | null,
  selectedId: string | null,
): { center: [number, number]; zoom: number } {
  const selected = selectedId === null ? null : (pins.find((p) => p.id === selectedId) ?? null)
  if (selected) return { center: [selected.lat, selected.lng], zoom: SINGLE_PIN_ZOOM }
  return computeViewport(pins, anchor)
}
```

- [ ] **Step 4: Run, expect PASS** — `bun run --filter @kuruma/web test viewport`

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/search/viewport.ts packages/web/tests/vite/search/viewport.test.ts
git commit -m "feat(web): focusViewport centers the map on the selected pin (#885 slice 1)"
```

---

## Task 2: PigeonMapAdapter recenters on selection

**Files:** Modify `PigeonMapAdapter.tsx`; Test `PigeonMapAdapter.test.tsx`.

- [ ] **Step 1: Write the failing test** — add inside `describe('PigeonMapAdapter', ...)`:

```ts
it('recenters on the selected pin (fly-to) when one is selected', () => {
  render(
    <PigeonMapAdapter
      items={[
        carAt('loc_namba', { latitude: 34.6627, longitude: 135.5023 }),
        carAt('loc_umeda', { latitude: 34.7025, longitude: 135.4959 }),
      ]}
      selectedId="loc_umeda"
      onSelect={() => {}}
    />,
  )
  const map = screen.getByTestId('pigeon-map')
  expect(map).toHaveAttribute('data-center', '34.7025,135.4959')
  expect(map).toHaveAttribute('data-zoom', '12') // SINGLE_PIN_ZOOM
})
```

- [ ] **Step 2: Run, expect FAIL** — `bun run --filter @kuruma/web test PigeonMapAdapter`
Expected: FAIL — `data-center` is the fit-all midpoint, not the selected pin.

- [ ] **Step 3: Implement** — in `PigeonMapAdapter.tsx`, swap the viewport call and add `selectedId` to the remount key so a selection re-centers (consistent with the existing uncontrolled-map pattern):

```tsx
import { type Pin, focusViewport } from './viewport'
// ...
const viewport = focusViewport(pins, anchor, selectedId)
// ...
<PigeonMap
  key={`${selectedId ?? ''}:${anchor ? anchor.join(',') : 'fit'}:${pins.map((p) => p.id).join(',')}`}
  provider={gsiTileProvider}
  attribution={GSI_ATTRIBUTION}
  attributionPrefix={false}
  defaultCenter={viewport.center}
  defaultZoom={viewport.zoom}
>
```

(Replace the old `computeViewport(pins, anchor)` line and the old `key=` line; remove the now-unused `computeViewport` import.)

- [ ] **Step 4: Run, expect PASS** — `bun run --filter @kuruma/web test PigeonMapAdapter`
The existing "fits the pins when no anchor" test still passes (`selectedId={null}` → `focusViewport` defers to `computeViewport`).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/search/PigeonMapAdapter.tsx packages/web/tests/vite/search/PigeonMapAdapter.test.tsx
git commit -m "feat(web): map recenters on the selected pin (#885 slice 1)"
```

> Note: selection remounts the map (re-fetches tiles, resets pan) — acceptable for Slice 1's "jump to the pin." Smooth animated fly + pan-preservation (controlled `center`/`onBoundsChanged`) is a deliberate later polish.

---

## Task 3: `renderSelected` prop + Overlay popup in the adapter

**Files:** Modify `MapAdapter.ts`, `PigeonMapAdapter.tsx`; Test `PigeonMapAdapter.test.tsx`.

- [ ] **Step 1: Extend the contract** — in `MapAdapter.ts` add to `MapAdapterProps` (and `import type { ComponentType, ReactNode } from 'react'`):

```ts
  /** Renders the popup body for the selected location. The VIEW owns presentation
   *  (i18n, router links); the adapter only positions it at the pin. Absent = no
   *  popup. */
  renderSelected?: (item: SearchResultItem) => ReactNode
```

- [ ] **Step 2: Write the failing tests** — extend the `vi.mock('pigeon-maps', ...)` factory with an `Overlay`, and add a test:

```ts
// add to the mock's returned object:
Overlay: ({ children, anchor }: { children: ReactNode; anchor: [number, number] }) => (
  <div data-testid="overlay" data-anchor={anchor.join(',')}>
    {children}
  </div>
),
```

```ts
it('renders the selected popup at its pin via renderSelected, and nothing when unselected', () => {
  const renderSelected = (item: SpecificSearchResult) => (
    <div data-testid="popup">{item.location.locationId}</div>
  )
  const props = {
    items: [carAt('loc_namba', { latitude: 34.6627, longitude: 135.5023 })],
    onSelect: () => {},
    renderSelected,
  }
  const { rerender } = render(<PigeonMapAdapter {...props} selectedId={null} />)
  expect(screen.queryByTestId('popup')).toBeNull()

  rerender(<PigeonMapAdapter {...props} selectedId="loc_namba" />)
  const overlay = screen.getByTestId('overlay')
  expect(overlay).toHaveAttribute('data-anchor', '34.6627,135.5023')
  expect(screen.getByTestId('popup')).toHaveTextContent('loc_namba')
})
```

- [ ] **Step 3: Run, expect FAIL** — `bun run --filter @kuruma/web test PigeonMapAdapter`
Expected: FAIL — no overlay rendered.

- [ ] **Step 4: Implement** — in `PigeonMapAdapter.tsx`: add `Overlay` to the pigeon-maps import, destructure `renderSelected`, resolve the selected pin+item, and render the overlay:

```tsx
import { Marker, Overlay, Map as PigeonMap } from 'pigeon-maps'
// ...
export function PigeonMapAdapter({ items, selectedId, onSelect, anchor = null, renderSelected }: MapAdapterProps) {
  const pins = items
    .map((item) => ({ id: item.location.locationId, lat: item.location.latitude, lng: item.location.longitude }))
    .filter((p): p is Pin => p.lat !== null && p.lng !== null)

  const viewport = focusViewport(pins, anchor, selectedId)
  const selectedPin = selectedId === null ? null : (pins.find((p) => p.id === selectedId) ?? null)
  const selectedItem =
    selectedId === null ? null : (items.find((i) => i.location.locationId === selectedId) ?? null)

  return (
    <PigeonMap /* ...props as Task 2... */>
      {pins.map((pin) => (
        <Marker
          key={pin.id}
          anchor={[pin.lat, pin.lng]}
          color={pin.id === selectedId ? SELECTED_COLOR : MARKER_COLOR}
          onClick={() => onSelect(pin.id)}
        />
      ))}
      {selectedPin && selectedItem && renderSelected && (
        <Overlay anchor={[selectedPin.lat, selectedPin.lng]} offset={[120, 20]}>
          {renderSelected(selectedItem)}
        </Overlay>
      )}
    </PigeonMap>
  )
}
```

(The `offset` is a pixel nudge so the popup clears the marker; tune visually during review.)

- [ ] **Step 5: Run, expect PASS** — `bun run --filter @kuruma/web test PigeonMapAdapter`

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/vite/search/MapAdapter.ts packages/web/src/vite/search/PigeonMapAdapter.tsx packages/web/tests/vite/search/PigeonMapAdapter.test.tsx
git commit -m "feat(web): pin popup overlay via renderSelected seam (#885 slice 1)"
```

---

## Task 4: Shared `resultTitle` + `resultPriceLabel` (DRY the row, reuse in the popup)

**Files:** Modify `result.ts`, `SearchResultRow.tsx`; Test (create) `result.test.ts`.

- [ ] **Step 1: Write the failing tests** — create `packages/web/tests/vite/search/result.test.ts`:

```ts
import { resultPriceLabel, resultTitle } from '@/vite/search/result'
import type { SpecificSearchResult } from '@kuruma/shared/types/search-result'
import { describe, expect, it } from 'vitest'

const base: SpecificSearchResult = {
  kind: 'SPECIFIC', location: { locationId: 'l', operatorId: 'o', operatorName: 'Op', name: 'Namba', address: 'Osaka', latitude: 34.6, longitude: 135.5 },
  dailyRateJpy: 8000, hourlyRateJpy: null, classLabel: 'Compact', acrissCode: 'CCAR', seats: 5, photos: [],
  vehicleId: 'v1', name: 'Toyota Yaris', make: 'Toyota', model: 'Yaris', year: 2023, transmission: 'AUTO',
}
const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${values.price}` : key)

describe('resultTitle', () => {
  it('uses the car name for a SPECIFIC result', () => {
    expect(resultTitle(base)).toBe('Toyota Yaris')
  })
})

describe('resultPriceLabel', () => {
  it('formats a daily rate with thousands separators', () => {
    expect(resultPriceLabel(base, t)).toBe('fromDaily:8,000')
  })
  it('falls back to hourly, then to no-price', () => {
    expect(resultPriceLabel({ ...base, dailyRateJpy: null, hourlyRateJpy: 500 }, t)).toBe('fromHourly:500')
    expect(resultPriceLabel({ ...base, dailyRateJpy: null, hourlyRateJpy: null }, t)).toBe('noPrice')
  })
})
```

- [ ] **Step 2: Run, expect FAIL** — `bun run --filter @kuruma/web test result`
Expected: FAIL — exports don't exist.

- [ ] **Step 3: Implement** — append to `result.ts` (`searchResultKey` stays):

```ts
type Translate = (key: string, values?: Record<string, unknown>) => string

/** Human title of a result row: the car name (SPECIFIC) or class label (CLASS_COMBO). */
export function resultTitle(item: SearchResultItem): string {
  return item.kind === 'SPECIFIC' ? item.name : item.classLabel
}

/** "From ¥X / day" (or hourly, or price-on-request) — shared by the list row and
 *  the map popup so they never drift. `t` is the use-intl translator. */
export function resultPriceLabel(item: SearchResultItem, t: Translate): string {
  if (item.dailyRateJpy != null) return t('fromDaily', { price: item.dailyRateJpy.toLocaleString('en-US') })
  if (item.hourlyRateJpy != null) return t('fromHourly', { price: item.hourlyRateJpy.toLocaleString('en-US') })
  return t('noPrice')
}
```

- [ ] **Step 4: Run, expect PASS** — `bun run --filter @kuruma/web test result`

- [ ] **Step 5: Refactor `SearchResultRow.tsx` to reuse it (behavior unchanged)** — replace the inline `priceLabel` block with `const priceLabel = resultPriceLabel(item, t)` and import `resultPriceLabel` from `./result`. Run the existing row test to confirm green: `bun run --filter @kuruma/web test SearchResult`.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/vite/search/result.ts packages/web/src/vite/search/SearchResultRow.tsx packages/web/tests/vite/search/result.test.ts
git commit -m "refactor(web): share resultTitle/resultPriceLabel between row and popup (#885 slice 1)"
```

---

## Task 5: SearchMapList supplies the popup content

**Files:** Modify `SearchMapList.tsx`; Test `SearchMapList.test.tsx`.

- [ ] **Step 1: Update the fake adapter to exercise the seam, then write the failing test** — in `SearchMapList.test.tsx`, make `FakeMapAdapter` invoke `renderSelected` for the selected item so the view's popup content is observable:

```tsx
const FakeMapAdapter: MapAdapter = ({ items, selectedId, onSelect, anchor, renderSelected }) => {
  const selected = items.find((i) => i.location.locationId === selectedId) ?? null
  return (
    <div data-testid="fake-map" data-selected={selectedId ?? ''} data-anchor={anchor?.join(',') ?? ''}>
      {items.map((item) => (
        <button key={item.location.locationId} type="button" data-testid={`marker-${item.location.locationId}`} onClick={() => onSelect(item.location.locationId)}>
          marker
        </button>
      ))}
      {selected && renderSelected && <div data-testid="map-popup">{renderSelected(selected)}</div>}
    </div>
  )
}
```

Add the test:

```ts
it('renders a map popup (title · store · price) for the selected location', () => {
  renderMapList([carAt('v1', 'Toyota Yaris', 'loc_namba', GEOCODED)])
  expect(screen.queryByTestId('map-popup')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: /show on map/i }))

  const popup = screen.getByTestId('map-popup')
  expect(popup).toHaveTextContent('Toyota Yaris')
  expect(popup).toHaveTextContent('Best Car Rental')
  expect(popup).toHaveTextContent(/8,000/)
})
```

- [ ] **Step 2: Run, expect FAIL** — `bun run --filter @kuruma/web test SearchMapList`
Expected: FAIL — `SearchMapList` passes no `renderSelected`, so no popup.

- [ ] **Step 3: Implement** — in `SearchMapList.tsx`, import the formatters and pass `renderSelected` to the adapter:

```tsx
import { resultPriceLabel, resultTitle, searchResultKey } from './result'
// ...inside the component, the adapter call becomes:
<Adapter
  items={mapItems}
  selectedId={selectedId}
  onSelect={setSelectedId}
  anchor={anchor}
  renderSelected={(item) => (
    <div className="min-w-44 rounded-lg border border-border bg-card p-3 text-sm shadow-md">
      <p className="font-semibold leading-tight">{resultTitle(item)}</p>
      <p className="mt-0.5 text-muted-foreground">
        {item.location.operatorName} · {item.location.name}
      </p>
      <p className="mt-1 font-medium text-foreground">{resultPriceLabel(item, t)}</p>
    </div>
  )}
/>
```

- [ ] **Step 4: Run, expect PASS** — `bun run --filter @kuruma/web test SearchMapList`

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/search/SearchMapList.tsx packages/web/tests/vite/search/SearchMapList.test.tsx
git commit -m "feat(web): map popup shows the selected car (title, store, price) (#885 slice 1)"
```

---

## Task 6: Green gate + PR

- [ ] **Step 1: Full web suite** — `bun run --filter @kuruma/web test` → all pass.
- [ ] **Step 2: Types** — `bun run --filter @kuruma/web typecheck` → exit 0.
- [ ] **Step 3: Format/lint** — `bunx biome check --write packages/web/src/vite/search packages/web/tests/vite/search` then re-run typecheck if it reorders imports.
- [ ] **Step 4: Manual check** (optional) — `bun run dev`, open `/en/search?...&view=map`, click a pin → map recenters + popup shows; click "Show on map" on a row → same.
- [ ] **Step 5: PR** — push the slice branch; open a PR "feat(web): search map fly-to + pin popup (#885 slice 1)" base `marketplace-pivot`, body references #885 and this plan. Do NOT close #885 (slices 2–3 remain).

---

## Follow-ups (NOT this slice)

- **Slice 2 (#885):** co-located cars → carousel popup; price-labeled pins.
- **Slice 3 (#885):** geo-context labels (landmark · distance · prefecture); mobile list-default + sticky "Map" toggle + bottom sheet.
- **Slice 1b:** card *body* as the map affordance (replacing the "show on map" button) + explicit detail CTA in card+popup → storefront detail; requires threading `from`/`to` into `SearchMapList` (route change in `routes/$locale/search.tsx`). Honors the brief's interaction-precision rule (no whole-card `<Link>`).
- **Polish:** animated fly + pan-preservation via controlled `center`/`onBoundsChanged` instead of remount.

---

## Self-review

- **Spec coverage:** brief §4/§7 Slice 1 = "card↔pin sync + fly-to + pin popup (single-car)." Sync pre-exists; fly-to = Tasks 1–2; popup = Tasks 3–5. ✓ Card-as-affordance + CTA explicitly deferred to Slice 1b with rationale (avoids `from`/`to` route churn) — noted, not dropped.
- **Type consistency:** `renderSelected?: (item: SearchResultItem) => ReactNode` defined in `MapAdapter.ts` (Task 3), consumed in `SearchMapList` (Task 5) and the fake adapter (test); `focusViewport(pins, anchor, selectedId)` signature identical in Tasks 1–2; `resultTitle`/`resultPriceLabel` signatures identical in Tasks 4–5.
- **Placeholders:** none — every code step is concrete.
- **Risk:** `Overlay` must be added to the pigeon-maps mock (Task 3 Step 2) or the adapter test throws "Overlay is not a function." Remount-on-select is intentional (noted).
