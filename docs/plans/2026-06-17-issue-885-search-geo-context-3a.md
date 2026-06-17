# Search geo-context labels (Slice 3a of #885) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each renter search result a one-line geo-context label — `{nearest area}, {prefecture} · {N} km away` — on both the list row and the map popup, fully client-side and behind `VITE_SEARCH_MAP_ENABLED`.

**Architecture:** Functional Core / Imperative Shell. Two pure functions (`resolveGeoContext`, `formatGeoContext`) in `packages/web/src/vite/search/result.ts` derive the label from already-cached data (region tree + region anchor); the `SearchMapList` shell memoizes a `locationId → label` map once and passes a dumb string into the leaf row/popup. Zero schema / API / DTO / fetch change.

**Tech Stack:** React, TanStack Router, use-intl, Vitest + Testing Library, `@kuruma/shared` pure geo helpers (`nearestAssignableRegion`, `haversineKm`, `regionChain`).

**Spec (source of truth):** `docs/superpowers/specs/2026-06-17-search-geo-context-3a-design.md`

**Conventions verified on develop `1fd1e766`:**
- Tests live in `packages/web/tests/vite/search/*` (mirror layout, NOT co-located). Vitest is not typechecked.
- `RegionNode` (`@kuruma/shared/types/region`) extends `RegionCandidate` with `parentId`, `nameEn/Ja/Zh`, `type`, `slug`.
- Region name is localized inline elsewhere via `locale==='ja'?nameJa : locale==='zh'?nameZh : nameEn` (`RegionPicker.tsx:24`). We mirror that 3-line pick inside `formatGeoContext` (a shared `localizedRegionName` consolidation across the existing 2 copies is out of scope — grandfather policy).
- Run one file: `bun run --filter @kuruma/web test <substr>`. Typecheck prod call-sites: `bun run --filter @kuruma/web typecheck`.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/web/src/vite/search/result.ts` | Modify | Add pure `GeoContext`, `resolveGeoContext`, `formatGeoContext` |
| `packages/web/tests/vite/search/result.test.ts` | Modify | Pure-function tests (exact assertions) |
| `packages/web/messages/{en,ja,zh}.json` | Modify | 4 `search.map.geoContext*` keys × 3 locales |
| `packages/web/src/vite/search/SearchResultRow.tsx` | Modify | Optional `geoLabel` prop → muted line |
| `packages/web/tests/vite/search/SearchResultRow.test.tsx` | Modify | Renders/omits the geo line |
| `packages/web/src/vite/search/MapPopupCarousel.tsx` | Modify | Optional `geoLabel` prop → muted line |
| `packages/web/tests/vite/search/MapPopupCarousel.test.tsx` | Modify | Renders the geo line |
| `packages/web/src/vite/search/SearchMapList.tsx` | Modify | `regions`+`geoAnchor` props, `geoLabelById` memo, thread label down |
| `packages/web/tests/vite/search/SearchMapList.test.tsx` | Modify | Row + popup show the label |
| `packages/web/src/vite/search/SearchMap.tsx` | Modify | Forward `regions`+`geoAnchor` |
| `packages/web/tests/vite/search/SearchMap.test.tsx` | Modify | End-to-end forward shows the label |
| `packages/web/src/routes/$locale/search.tsx` | Modify | Thread `regions ?? []` + `regionAnchor` into `<SearchMap>` |
| `packages/web/tests/vite/search/StorefrontSearchRoute.test.tsx` | Modify | Captor proves the route forwards `regions`+`geoAnchor` |

---

## Task 1: i18n keys (en / ja / zh)

**Files:**
- Modify: `packages/web/messages/en.json` (the `search.map` block, after `"popupPosition"`)
- Modify: `packages/web/messages/ja.json` (same block)
- Modify: `packages/web/messages/zh.json` (same block)

No standalone test — exercised by the component tests in later tasks. Unit stays Latin "km" to match the existing `search.distance` chip (#840).

- [ ] **Step 1: Add the 4 keys to `en.json`**

In `search.map`, change the `"popupPosition": "{n} / {total}"` line to add the four keys after it:

```json
      "popupPosition": "{n} / {total}",
      "geoContext": "{area}, {prefecture} · {km} km away",
      "geoContextNoDistance": "{area}, {prefecture}",
      "geoContextAreaOnly": "{area} · {km} km away",
      "geoContextAreaOnlyNoDistance": "{area}"
```

- [ ] **Step 2: Add the 4 keys to `ja.json`** (prefecture-then-area order, Japanese interpunct)

```json
      "popupPosition": "{n} / {total}",
      "geoContext": "{prefecture}{area}・{km} km",
      "geoContextNoDistance": "{prefecture}{area}",
      "geoContextAreaOnly": "{area}・{km} km",
      "geoContextAreaOnlyNoDistance": "{area}"
```

- [ ] **Step 3: Add the 4 keys to `zh.json`**

```json
      "popupPosition": "{n} / {total}",
      "geoContext": "{prefecture}{area}・{km} km",
      "geoContextNoDistance": "{prefecture}{area}",
      "geoContextAreaOnly": "{area}・{km} km",
      "geoContextAreaOnlyNoDistance": "{area}"
```

- [ ] **Step 4: Verify all three files are valid JSON**

Run: `cd packages/web && bunx biome check messages/en.json messages/ja.json messages/zh.json`
Expected: no errors (biome parses + formats; fixes nothing if already valid).

- [ ] **Step 5: Commit**

```bash
git add packages/web/messages/en.json packages/web/messages/ja.json packages/web/messages/zh.json
git commit -m "feat(web): add search geo-context i18n keys (#885 slice 3a)"
```

---

## Task 2: `resolveGeoContext` (pure)

**Files:**
- Modify: `packages/web/src/vite/search/result.ts`
- Test: `packages/web/tests/vite/search/result.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the top of `result.test.ts` — new imports plus a region fixture helper, then a `describe`. Add `resolveGeoContext` to the existing first import line and add the new shared imports:

```ts
import {
  groupByLocation,
  pinPriceLabel,
  resolveGeoContext,
  resultPriceLabel,
  resultTitle,
} from '@/vite/search/result'
import { haversineKm } from '@kuruma/shared/lib/region-distance'
import type { RegionNode } from '@kuruma/shared/types/region'
```

Append this block at the end of the file:

```ts
// --- geo-context (3a) ---------------------------------------------------------

function area(overrides: Partial<RegionNode> & Pick<RegionNode, 'id'>): RegionNode {
  return {
    latitude: null,
    longitude: null,
    assignable: false,
    status: 'ACTIVE',
    sortOrder: 0,
    parentId: null,
    nameEn: 'X',
    nameJa: 'X',
    nameZh: 'X',
    type: null,
    slug: null,
    ...overrides,
  }
}

// Osaka: Namba & Umeda areas under Osaka City under Osaka prefecture.
const osaka = area({ id: 'reg_osaka', nameEn: 'Osaka', nameJa: '大阪府', nameZh: '大阪府', type: 'PREFECTURE', slug: 'osaka' })
const osakaCity = area({ id: 'reg_osaka_city', nameEn: 'Osaka City', type: 'CITY', parentId: 'reg_osaka' })
const namba = area({ id: 'reg_namba', nameEn: 'Namba', nameJa: '難波', nameZh: '难波', type: 'AREA', slug: 'namba', parentId: 'reg_osaka_city', assignable: true, latitude: 34.6627, longitude: 135.5023, sortOrder: 1 })
const umeda = area({ id: 'reg_umeda', nameEn: 'Umeda', nameJa: '梅田', nameZh: '梅田', type: 'AREA', slug: 'umeda', parentId: 'reg_osaka_city', assignable: true, latitude: 34.7025, longitude: 135.4959, sortOrder: 2 })
const OSAKA_REGIONS: RegionNode[] = [osaka, osakaCity, namba, umeda]

const storeAt = (latitude: number | null, longitude: number | null) => ({
  ...base.location,
  latitude,
  longitude,
})

describe('resolveGeoContext', () => {
  it('picks the nearest AREA and walks up to its prefecture', () => {
    const ctx = resolveGeoContext(storeAt(34.66, 135.5), OSAKA_REGIONS, null)
    expect(ctx?.area.id).toBe('reg_namba')
    expect(ctx?.prefecture?.id).toBe('reg_osaka')
  })

  it('measures distance from the searched anchor to the pickup store', () => {
    const anchor = { latitude: 34.7025, longitude: 135.4959 } // Umeda centre
    const store = storeAt(34.66, 135.5)
    const ctx = resolveGeoContext(store, OSAKA_REGIONS, anchor)
    expect(ctx?.distanceKm).toBeCloseTo(
      haversineKm(anchor, { latitude: 34.66, longitude: 135.5 }),
      5,
    )
  })

  it('returns a null distance when no region was searched (no anchor)', () => {
    const ctx = resolveGeoContext(storeAt(34.66, 135.5), OSAKA_REGIONS, null)
    expect(ctx?.distanceKm).toBeNull()
  })

  it('returns null when the store has no coordinates', () => {
    expect(resolveGeoContext(storeAt(null, null), OSAKA_REGIONS, null)).toBeNull()
  })

  it('returns null when the nearest area is beyond the sanity radius', () => {
    // Tokyo (~400 km away) exceeds REGION_SANITY_RADIUS_KM (100 km).
    expect(resolveGeoContext(storeAt(35.68, 139.76), OSAKA_REGIONS, null)).toBeNull()
  })

  it('terminates on a cyclic parent chain (A -> B -> A) with a null prefecture', () => {
    const a = area({ id: 'A', type: 'AREA', assignable: true, latitude: 34.66, longitude: 135.5, parentId: 'B' })
    const b = area({ id: 'B', type: 'CITY', parentId: 'A' })
    const ctx = resolveGeoContext(storeAt(34.66, 135.5), [a, b], null)
    expect(ctx?.area.id).toBe('A')
    expect(ctx?.prefecture).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/web && bun run --filter @kuruma/web test result.test`
Expected: FAIL — `resolveGeoContext is not a function` (import unresolved).

- [ ] **Step 3: Implement `resolveGeoContext` in `result.ts`**

Add imports at the top of `result.ts` (after the existing `SearchResultItem` import):

```ts
import {
  type GeoPoint,
  haversineKm,
  nearestAssignableRegion,
} from '@kuruma/shared/lib/region-distance'
import type { ResultLocation, SearchResultItem } from '@kuruma/shared/types/search-result'
import type { RegionNode } from '@kuruma/shared/types/region'
import { regionChain } from '@/vite/regions/region-lookup'
```

(Replace the existing `import type { SearchResultItem } from '@kuruma/shared/types/search-result'` line with the combined `ResultLocation, SearchResultItem` import above.)

Append the type + function at the end of `result.ts`:

```ts
/** Derived "where in Japan" context for a result row, before localization. */
export interface GeoContext {
  /** Nearest AREA region to the pickup store (always present when non-null). */
  area: RegionNode
  /** The AREA's prefecture ancestor, or null when the chain is broken. */
  prefecture: RegionNode | null
  /** Anchor -> pickup distance in km, or null with no anchor / no store coords. */
  distanceKm: number | null
}

/**
 * Locate a pickup store in the region taxonomy (#885 slice 3a). Pure: finds the
 * nearest assignable AREA by coords, derives its prefecture by reusing the already
 * cycle-guarded `regionChain` (do NOT hand-roll a second parent walk — it runs on
 * the public region list and would freeze the tab on a malformed self-FK row), and
 * measures the searched anchor -> store distance. Returns null when the store has no
 * coordinates or sits beyond the area sanity radius (graceful degrade: no label).
 */
export function resolveGeoContext(
  location: ResultLocation,
  regions: readonly RegionNode[],
  anchor: GeoPoint | null,
): GeoContext | null {
  if (location.latitude === null || location.longitude === null) return null
  const point: GeoPoint = { latitude: location.latitude, longitude: location.longitude }
  const area = nearestAssignableRegion(regions, point)
  if (area === null) return null
  return {
    area,
    prefecture: regionChain(regions, area.id).prefecture,
    distanceKm: anchor === null ? null : haversineKm(anchor, point),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/web && bun run --filter @kuruma/web test result.test`
Expected: PASS (all `resolveGeoContext` cases green; existing `result.ts` tests stay green).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/search/result.ts packages/web/tests/vite/search/result.test.ts
git commit -m "feat(web): resolveGeoContext — nearest area, prefecture, anchor distance (#885 slice 3a)"
```

---

## Task 3: `formatGeoContext` (pure)

**Files:**
- Modify: `packages/web/src/vite/search/result.ts`
- Test: `packages/web/tests/vite/search/result.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `formatGeoContext` to the first import line in `result.test.ts`. Append this `describe` (reuses the `area`/region fixtures from Task 2; the existing `t` fake echoes `key` and, for single-value calls, `key:value`, so here we assert with a richer fake that echoes all values):

```ts
describe('formatGeoContext', () => {
  // Fake translator that renders the template key with its interpolated values so
  // we assert template selection + value wiring without depending on en.json here.
  const tt = (key: string, values?: Record<string, string | number>) =>
    `${key}(${Object.entries(values ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(',')})`

  it('returns null for a null context', () => {
    expect(formatGeoContext(null, 'en', tt)).toBeNull()
  })

  it('formats area + prefecture + distance', () => {
    const ctx = { area: namba, prefecture: osaka, distanceKm: 3.48 }
    expect(formatGeoContext(ctx, 'en', tt)).toBe('map.geoContext(area=Namba,prefecture=Osaka,km=3.5)')
  })

  it('drops the distance clause when there is no anchor (null distance)', () => {
    const ctx = { area: namba, prefecture: osaka, distanceKm: null }
    expect(formatGeoContext(ctx, 'en', tt)).toBe('map.geoContextNoDistance(area=Namba,prefecture=Osaka)')
  })

  it('drops the distance clause when distance rounds to 0.0 km', () => {
    const ctx = { area: namba, prefecture: osaka, distanceKm: 0.04 }
    expect(formatGeoContext(ctx, 'en', tt)).toBe('map.geoContextNoDistance(area=Namba,prefecture=Osaka)')
  })

  it('uses the area-only template when the prefecture is null', () => {
    const ctx = { area: namba, prefecture: null, distanceKm: 3.48 }
    expect(formatGeoContext(ctx, 'en', tt)).toBe('map.geoContextAreaOnly(area=Namba,km=3.5)')
  })

  it('uses the area-only template when area and prefecture share a name (Nara/Nara)', () => {
    const naraPref = area({ id: 'reg_nara_p', nameEn: 'Nara', type: 'PREFECTURE' })
    const naraArea = area({ id: 'reg_nara_a', nameEn: 'Nara', type: 'AREA' })
    const ctx = { area: naraArea, prefecture: naraPref, distanceKm: null }
    expect(formatGeoContext(ctx, 'en', tt)).toBe('map.geoContextAreaOnlyNoDistance(area=Nara)')
  })

  it('picks localized names by locale', () => {
    const ctx = { area: namba, prefecture: osaka, distanceKm: null }
    expect(formatGeoContext(ctx, 'ja', tt)).toBe('map.geoContextNoDistance(area=難波,prefecture=大阪府)')
    expect(formatGeoContext(ctx, 'zh', tt)).toBe('map.geoContextNoDistance(area=难波,prefecture=大阪府)')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/web && bun run --filter @kuruma/web test result.test`
Expected: FAIL — `formatGeoContext is not a function`.

- [ ] **Step 3: Implement `formatGeoContext` in `result.ts`**

Append after `resolveGeoContext`:

```ts
function localizedRegionName(region: RegionNode, locale: string): string {
  if (locale === 'ja') return region.nameJa
  if (locale === 'zh') return region.nameZh
  return region.nameEn
}

/**
 * Localize + format a `GeoContext` into the one-line label (#885 slice 3a). Pure
 * given `t`. Picks the area-only template when there is no prefecture or it equals
 * the area name (Nara/Nara), and drops the distance clause when there is no anchor
 * or the distance rounds to 0.0 km. `km` is `.toFixed(1)` (mirrors `StorefrontCard`).
 */
export function formatGeoContext(
  ctx: GeoContext | null,
  locale: string,
  t: Translate,
): string | null {
  if (ctx === null) return null
  const areaName = localizedRegionName(ctx.area, locale)
  const prefectureName = ctx.prefecture ? localizedRegionName(ctx.prefecture, locale) : null
  const hasDistance = ctx.distanceKm !== null && Number(ctx.distanceKm.toFixed(1)) !== 0
  const km = ctx.distanceKm !== null ? ctx.distanceKm.toFixed(1) : ''
  if (prefectureName === null || prefectureName === areaName) {
    return hasDistance
      ? t('map.geoContextAreaOnly', { area: areaName, km })
      : t('map.geoContextAreaOnlyNoDistance', { area: areaName })
  }
  return hasDistance
    ? t('map.geoContext', { area: areaName, prefecture: prefectureName, km })
    : t('map.geoContextNoDistance', { area: areaName, prefecture: prefectureName })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/web && bun run --filter @kuruma/web test result.test`
Expected: PASS.

- [ ] **Step 5: Run typecheck on prod call-sites**

Run: `cd packages/web && bun run --filter @kuruma/web typecheck`
Expected: PASS (no new errors in `src/`).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/vite/search/result.ts packages/web/tests/vite/search/result.test.ts
git commit -m "feat(web): formatGeoContext — localized one-line geo label (#885 slice 3a)"
```

---

## Task 4: `SearchResultRow` geo line

**Files:**
- Modify: `packages/web/src/vite/search/SearchResultRow.tsx`
- Test: `packages/web/tests/vite/search/SearchResultRow.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `SearchResultRow.test.tsx`, add `geoLabel` to the `renderRow` ctx param + the rendered element:

```ts
function renderRow(
  item: SpecificSearchResult,
  ctx: {
    locale?: string
    from?: string
    to?: string
    classFilter?: string | string[] | undefined
    pickupLocationId?: string | undefined
    region?: string | undefined
    geoLabel?: string | null
  } = {},
) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <SearchResultRow
        item={item}
        locale={ctx.locale ?? 'en'}
        from={ctx.from ?? '2026-07-01T10:00'}
        to={ctx.to ?? '2026-07-04T10:00'}
        classFilter={ctx.classFilter}
        pickupLocationId={ctx.pickupLocationId}
        region={ctx.region}
        geoLabel={ctx.geoLabel}
      />
    </IntlProvider>,
  )
}
```

Add two tests inside the `describe('SearchResultRow', ...)`:

```ts
  it('renders the geo-context line when a label is provided', () => {
    renderRow(makeSpecific(), { geoLabel: 'Umeda, Osaka · 3.5 km away' })
    expect(screen.getByText('Umeda, Osaka · 3.5 km away')).toBeInTheDocument()
  })

  it('omits the geo-context line when no label is provided', () => {
    renderRow(makeSpecific(), { geoLabel: null })
    expect(screen.queryByText(/km away/)).toBeNull()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/web && bun run --filter @kuruma/web test SearchResultRow`
Expected: FAIL — the geo text is not in the document (prop ignored).

- [ ] **Step 3: Implement the prop + line**

In `SearchResultRow.tsx`, add `Navigation` to the lucide import:

```ts
import { Car, MapPin, Navigation, Settings2, Users } from 'lucide-react'
```

Add `geoLabel` to `SearchResultRowProps`:

```ts
interface SearchResultRowProps {
  readonly item: SearchResultItem
  /** Search context carried into the detail CTA so dates + filters survive the drill-down (#885 1b). */
  readonly locale: string
  readonly from: string
  readonly to: string
  readonly classFilter?: string | string[] | undefined
  readonly pickupLocationId?: string | undefined
  readonly region?: string | undefined
  /** One-line "{area}, {prefecture} · {km} km away" geo context (#885 slice 3a). */
  readonly geoLabel?: string | null
}
```

In `SpecificRow`, add `geoLabel` to the destructured props and render it under the operator/store `<p>` (after the line ending `<span>{item.location.name}</span></p>`):

```tsx
function SpecificRow({
  item,
  locale,
  from,
  to,
  classFilter,
  pickupLocationId,
  region,
  geoLabel,
}: { readonly item: SpecificSearchResult } & Omit<SearchResultRowProps, 'item'>) {
```

```tsx
        {geoLabel && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Navigation className="size-4 shrink-0" aria-hidden />
            <span>{geoLabel}</span>
          </p>
        )}
```

(`SearchResultRow` already forwards `...ctx` to `SpecificRow`, so `geoLabel` flows through with no change to the switch.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/web && bun run --filter @kuruma/web test SearchResultRow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/search/SearchResultRow.tsx packages/web/tests/vite/search/SearchResultRow.test.tsx
git commit -m "feat(web): render geo-context line on the search result row (#885 slice 3a)"
```

---

## Task 5: `MapPopupCarousel` geo line

**Files:**
- Modify: `packages/web/src/vite/search/MapPopupCarousel.tsx`
- Test: `packages/web/tests/vite/search/MapPopupCarousel.test.tsx`

- [ ] **Step 1: Write the failing test**

In `MapPopupCarousel.test.tsx`, add `geoLabel` to `renderCarousel`:

```ts
function renderCarousel(
  items: SpecificSearchResult[],
  ctx?: { classFilter?: string | string[]; region?: string; geoLabel?: string | null },
) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <MapPopupCarousel
        items={items}
        locale="en"
        from="2026-07-01T10:00"
        to="2026-07-04T10:00"
        classFilter={ctx?.classFilter}
        region={ctx?.region}
        geoLabel={ctx?.geoLabel}
      />
    </IntlProvider>,
  )
}
```

Add a test inside `describe('MapPopupCarousel', ...)`:

```ts
  it('renders the geo-context line when a label is provided', () => {
    renderCarousel([carAt('v1', 'Toyota Yaris')], { geoLabel: 'Namba, Osaka · 1.2 km away' })
    expect(screen.getByText('Namba, Osaka · 1.2 km away')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web && bun run --filter @kuruma/web test MapPopupCarousel`
Expected: FAIL — geo text not present.

- [ ] **Step 3: Implement the prop + line**

In `MapPopupCarousel.tsx`, add `Navigation` to the lucide import:

```ts
import { Car, ChevronLeft, ChevronRight, Navigation } from 'lucide-react'
```

Add `geoLabel` to `MapPopupCarouselProps`:

```ts
  /** One-line geo context for this store, shared across its co-located cars (#885 slice 3a). */
  readonly geoLabel?: string | null
```

Add `geoLabel` to the destructured props of `MapPopupCarousel`, then render it inside the `aria-live` text block, after the price `<p>`:

```tsx
        <p className="font-medium text-foreground">{resultPriceLabel(current, t)}</p>
        {geoLabel && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Navigation className="size-3.5 shrink-0" aria-hidden />
            <span>{geoLabel}</span>
          </p>
        )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/web && bun run --filter @kuruma/web test MapPopupCarousel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/search/MapPopupCarousel.tsx packages/web/tests/vite/search/MapPopupCarousel.test.tsx
git commit -m "feat(web): render geo-context line in the map popup carousel (#885 slice 3a)"
```

---

## Task 6: `SearchMapList` — memo + threading

**Files:**
- Modify: `packages/web/src/vite/search/SearchMapList.tsx`
- Test: `packages/web/tests/vite/search/SearchMapList.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `SearchMapList.test.tsx`, add `RegionNode` import and an Osaka region fixture near the top:

```ts
import type { RegionNode } from '@kuruma/shared/types/region'
```

```ts
function areaNode(o: Partial<RegionNode> & Pick<RegionNode, 'id'>): RegionNode {
  return {
    latitude: null, longitude: null, assignable: false, status: 'ACTIVE', sortOrder: 0,
    parentId: null, nameEn: 'X', nameJa: 'X', nameZh: 'X', type: null, slug: null, ...o,
  }
}
const OSAKA_REGIONS: RegionNode[] = [
  areaNode({ id: 'reg_osaka', nameEn: 'Osaka', type: 'PREFECTURE', slug: 'osaka' }),
  areaNode({ id: 'reg_osaka_city', nameEn: 'Osaka City', type: 'CITY', parentId: 'reg_osaka' }),
  areaNode({ id: 'reg_umeda', nameEn: 'Umeda', type: 'AREA', slug: 'umeda', parentId: 'reg_osaka_city', assignable: true, latitude: 34.7025, longitude: 135.4959, sortOrder: 1 }),
]
```

Extend `renderMapList` to accept and pass `regions` + `geoAnchor`:

```ts
function renderMapList(
  items: SpecificSearchResult[],
  opts: {
    anchor?: [number, number] | null
    regions?: RegionNode[]
    geoAnchor?: { latitude: number; longitude: number } | null
  } = {},
) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <SearchMapList
        items={items}
        adapter={FakeMapAdapter}
        anchor={opts.anchor}
        regions={opts.regions}
        geoAnchor={opts.geoAnchor ?? null}
        locale="en"
        from="2026-07-01T10:00"
        to="2026-07-04T10:00"
      />
    </IntlProvider>,
  )
}
```

> Existing `renderMapList(items, anchor)` call-sites pass a 2nd positional `anchor`. Update them to the options form: `renderMapList([...], { anchor })`. There is one anchor-passing call (the centering test in this file, if present) and several no-arg calls; the no-arg calls are unaffected since `opts` defaults to `{}`.

Add a test inside `describe('SearchMapList', ...)`:

```ts
  it('labels a geocoded row with its area, prefecture, and distance from the anchor', () => {
    renderMapList([carAt('v1', 'Toyota Yaris', 'loc_umeda', { latitude: 34.7025, longitude: 135.4959 })], {
      regions: OSAKA_REGIONS,
      geoAnchor: { latitude: 34.6627, longitude: 135.5023 }, // Namba centre
    })
    // Umeda store, Namba anchor ~ a few km apart -> "Umeda, Osaka · X.X km away".
    expect(screen.getByText(/Umeda, Osaka · \d+\.\d+ km away/)).toBeInTheDocument()
  })

  it('carries the geo label into the selected map popup', () => {
    renderMapList([carAt('v1', 'Toyota Yaris', 'loc_umeda', { latitude: 34.7025, longitude: 135.4959 })], {
      regions: OSAKA_REGIONS,
      geoAnchor: null,
    })
    fireEvent.click(within(screen.getByTestId('pin-loc_umeda')).getByRole('button'))
    // No anchor -> place-only label, present in both the row and the popup.
    expect(screen.getAllByText('Umeda, Osaka').length).toBeGreaterThanOrEqual(2)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/web && bun run --filter @kuruma/web test SearchMapList`
Expected: FAIL — geo label text absent (props not yet consumed). Existing pin/selection tests still pass.

- [ ] **Step 3: Implement the props, memo, and threading**

In `SearchMapList.tsx`:

Add imports:

```ts
import type { GeoPoint } from '@kuruma/shared/lib/region-distance'
import type { RegionNode } from '@kuruma/shared/types/region'
import { formatGeoContext, groupByLocation, pinPriceLabel, resolveGeoContext, searchResultKey } from './result'
```

Add the two props to `SearchMapListProps`:

```ts
  /** Region taxonomy (cached `GET /regions`) for deriving geo-context labels (#885 slice 3a). */
  readonly regions?: readonly RegionNode[]
  /** Searched region centre; the distance reference for each label, null when none (#885 slice 3a). */
  readonly geoAnchor?: GeoPoint | null
```

Add them to the destructured params with defaults:

```ts
export function SearchMapList({
  items,
  adapter: Adapter,
  anchor = null,
  regions = [],
  geoAnchor = null,
  locale,
  from,
  to,
  classFilter,
  pickupLocationId,
  region,
}: SearchMapListProps) {
```

After the existing `groupItemsById` memo, add the label memo:

```ts
  // Derive each location's geo-context label once (the shell), so the leaf row and
  // popup take a dumb string and `regions` stays out of them. Co-located cars share
  // one label (keyed by locationId). Absent until the region query resolves.
  const geoLabelById = useMemo(() => {
    const byId = new Map<string, string>()
    for (const item of items) {
      const label = formatGeoContext(resolveGeoContext(item.location, regions, geoAnchor), locale, t)
      if (label) byId.set(item.location.locationId, label)
    }
    return byId
  }, [items, regions, geoAnchor, locale, t])
```

Pass `geoLabel` to the row (in the list `.map`):

```tsx
              <SearchResultRow
                item={item}
                locale={locale}
                from={from}
                to={to}
                classFilter={classFilter}
                pickupLocationId={pickupLocationId}
                region={region}
                geoLabel={geoLabelById.get(locationId) ?? null}
              />
```

Pass `geoLabel` to the popup (in `renderSelected`):

```tsx
              <MapPopupCarousel
                key={item.location.locationId}
                items={groupItemsById.get(item.location.locationId) ?? [item]}
                locale={locale}
                from={from}
                to={to}
                classFilter={classFilter}
                pickupLocationId={pickupLocationId}
                region={region}
                geoLabel={geoLabelById.get(item.location.locationId) ?? null}
              />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/web && bun run --filter @kuruma/web test SearchMapList`
Expected: PASS (new geo tests green; all existing pin/dedupe/selection tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/search/SearchMapList.tsx packages/web/tests/vite/search/SearchMapList.test.tsx
git commit -m "feat(web): SearchMapList derives + threads geo labels (#885 slice 3a)"
```

---

## Task 7: `SearchMap` — forward `regions` + `geoAnchor`

**Files:**
- Modify: `packages/web/src/vite/search/SearchMap.tsx`
- Test: `packages/web/tests/vite/search/SearchMap.test.tsx`

- [ ] **Step 1: Write the failing test**

In `SearchMap.test.tsx`, extend `renderMap` to accept `regions` + `geoAnchor`, and import `RegionNode`:

```ts
import type { RegionNode } from '@kuruma/shared/types/region'
```

```ts
function renderMap(
  result: SearchResultsData | null,
  opts: {
    anchor?: [number, number] | null
    regions?: RegionNode[]
    geoAnchor?: { latitude: number; longitude: number } | null
  } = {},
) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <SearchMap
        result={result}
        anchor={opts.anchor}
        regions={opts.regions}
        geoAnchor={opts.geoAnchor ?? null}
        locale="en"
        from="2026-07-01T10:00"
        to="2026-07-04T10:00"
      />
    </IntlProvider>,
  )
}
```

> Update the existing `renderMap(result, anchor)` call in the "centers the map" test to `renderMap(result, { anchor: [34.6655, 135.5023] })`. The other `renderMap(...)` calls take no anchor and are unaffected.

Add region fixtures + a forwarding test:

```ts
function areaNode(o: Partial<RegionNode> & Pick<RegionNode, 'id'>): RegionNode {
  return {
    latitude: null, longitude: null, assignable: false, status: 'ACTIVE', sortOrder: 0,
    parentId: null, nameEn: 'X', nameJa: 'X', nameZh: 'X', type: null, slug: null, ...o,
  }
}
const OSAKA_REGIONS: RegionNode[] = [
  areaNode({ id: 'reg_osaka', nameEn: 'Osaka', type: 'PREFECTURE', slug: 'osaka' }),
  areaNode({ id: 'reg_osaka_city', nameEn: 'Osaka City', type: 'CITY', parentId: 'reg_osaka' }),
  areaNode({ id: 'reg_namba', nameEn: 'Namba', type: 'AREA', slug: 'namba', parentId: 'reg_osaka_city', assignable: true, latitude: 34.6627, longitude: 135.5023, sortOrder: 1 }),
]
```

```ts
  it('forwards regions + geoAnchor down so rows show geo context (#885 slice 3a)', () => {
    // The result pin is loc_namba (34.66,135.5); the anchor at Umeda is a few km off,
    // so the label rendering proves SearchMap forwarded regions + geoAnchor to the list.
    renderMap({ items: [specific('v1', 'Toyota Yaris')], nextCursor: null }, {
      regions: OSAKA_REGIONS,
      geoAnchor: { latitude: 34.7025, longitude: 135.4959 },
    })
    expect(screen.getByText(/Namba, Osaka · \d+\.\d+ km away/)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web && bun run --filter @kuruma/web test SearchMap.test`
Expected: FAIL — geo label not rendered (props not forwarded).

- [ ] **Step 3: Implement the forward**

In `SearchMap.tsx`, add imports:

```ts
import type { GeoPoint } from '@kuruma/shared/lib/region-distance'
import type { RegionNode } from '@kuruma/shared/types/region'
```

Add the two props to `SearchMapProps`:

```ts
  /** Region taxonomy for geo-context labels, forwarded to the list (#885 slice 3a). */
  readonly regions?: readonly RegionNode[]
  /** Searched region centre — the distance reference for each geo label (#885 slice 3a). */
  readonly geoAnchor?: GeoPoint | null
```

Add to the destructured params (with default), and forward to `<SearchMapList>`:

```ts
export function SearchMap({
  result,
  anchor = null,
  regions = [],
  geoAnchor = null,
  locale,
  from,
  to,
  classFilter,
  pickupLocationId,
  region,
}: SearchMapProps) {
```

```tsx
    <SearchMapList
      items={result.items}
      adapter={PigeonMapAdapter}
      anchor={anchor}
      regions={regions}
      geoAnchor={geoAnchor}
      locale={locale}
      from={from}
      to={to}
      classFilter={classFilter}
      pickupLocationId={pickupLocationId}
      region={region}
    />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/web && bun run --filter @kuruma/web test SearchMap.test`
Expected: PASS (new forward test + existing date-prompt/empty/centering tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/search/SearchMap.tsx packages/web/tests/vite/search/SearchMap.test.tsx
git commit -m "feat(web): SearchMap forwards regions + geoAnchor to the list (#885 slice 3a)"
```

---

## Task 8: Route wiring + seam captor

**Files:**
- Modify: `packages/web/src/routes/$locale/search.tsx`
- Test: `packages/web/tests/vite/search/StorefrontSearchRoute.test.tsx`

- [ ] **Step 1: Write the failing test**

In `StorefrontSearchRoute.test.tsx`:

Extend the hoisted `state` with a `region` slug, and make `useSearch` expose it:

```ts
const state = vi.hoisted(() => ({
  mapEnabled: false,
  view: 'stores' as 'stores' | 'map',
  region: undefined as string | undefined,
}))
```

Add a hoisted captor and upgrade the `SearchMap` mock to record its props:

```ts
const captured = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))
vi.mock('@/vite/search/SearchMap', () => ({
  SearchMap: (props: Record<string, unknown>) => {
    captured.props = props
    return <div data-testid="search-map" />
  },
}))
```

In the `@tanstack/react-router` mock, thread `region` from state into `useSearch`:

```ts
    useSearch: () => ({ from: '2026-07-01T10:00', to: '2026-07-03T10:00', region: state.region }),
```

Parametrize `renderRoute` to seed the region list, and reset state in `afterEach`:

```ts
function renderRoute(regions: unknown[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  queryClient.setQueryData(regionsQueryOptions().queryKey, regions)
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <StorefrontSearchRoute />
      </IntlProvider>
    </QueryClientProvider>,
  )
}
```

```ts
  afterEach(() => {
    state.mapEnabled = false
    state.view = 'stores'
    state.region = undefined
    captured.props = null
  })
```

Add a new test in the describe:

```ts
  it('forwards the region list and resolved anchor into the map (#885 slice 3a seam)', () => {
    const namba = {
      id: 'reg_namba', nameEn: 'Namba', nameJa: '難波', nameZh: '难波', type: 'AREA',
      slug: 'namba', parentId: null, assignable: true, status: 'ACTIVE', sortOrder: 1,
      latitude: 34.6627, longitude: 135.5023,
    }
    state.mapEnabled = true
    state.view = 'map'
    state.region = 'namba'
    renderRoute([namba])

    expect(Array.isArray(captured.props?.regions)).toBe(true)
    expect((captured.props?.regions as unknown[]).length).toBe(1)
    expect(captured.props?.geoAnchor).toEqual({ latitude: 34.6627, longitude: 135.5023 })
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web && bun run --filter @kuruma/web test StorefrontSearchRoute`
Expected: FAIL — `captured.props.regions`/`geoAnchor` undefined (route does not pass them yet).

- [ ] **Step 3: Implement the route wiring**

In `search.tsx`, the `StorefrontSearchRoute` component already computes `regions` (line ~146) and `regionAnchor` (line ~147). Add `regions` + `geoAnchor` to the `<SearchMap>` render:

```tsx
        {isSearchMapEnabled() && data.view === 'map' ? (
          <SearchMap
            result={data.flat}
            anchor={mapAnchor}
            regions={regions ?? []}
            geoAnchor={regionAnchor}
            locale={locale}
            from={from ?? ''}
            to={to ?? ''}
            classFilter={classFilter}
            pickupLocationId={pickupLocationId}
            region={region}
          />
        ) : (
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/web && bun run --filter @kuruma/web test StorefrontSearchRoute`
Expected: PASS (new seam test + all four gating tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/routes/$locale/search.tsx packages/web/tests/vite/search/StorefrontSearchRoute.test.tsx
git commit -m "feat(web): thread region list + anchor into the search map (#885 slice 3a)"
```

---

## Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full web unit suite**

Run: `cd packages/web && bun run --filter @kuruma/web test`
Expected: PASS — all suites green, no regressions in `viewport.test`, `PigeonMapAdapter.test`, `SearchViewToggle.test`.

- [ ] **Step 2: Typecheck prod call-sites**

Run: `cd packages/web && bun run --filter @kuruma/web typecheck`
Expected: PASS — no new errors in `src/`.

- [ ] **Step 3: Lint / format check**

Run: `cd ~/Dev/kuruma-map-s3 && bun run lint`
Expected: PASS (biome clean; pre-commit hook is read-only).

- [ ] **Step 4: Confirm the #840 e2e spec is untouched and the beta gate holds**

Run: `git diff --stat origin/develop...HEAD -- e2e/ packages/web/src/vite/search/flags.ts`
Expected: empty — no change to `e2e/real-db/region-search.auth.spec.ts` or the flag helper. All new UI sits inside the `isSearchMapEnabled() && view==='map'` render path, invisible in beta.

- [ ] **Step 5: Push the branch and open the PR (owner-gated)**

```bash
git push -u origin feat/885-search-geo-context
gh pr create --base develop --title "feat(web): search geo-context labels (#885 slice 3a)" \
  --body "Part of #885. Adds a one-line geo-context label (\`{area}, {prefecture} · {km} km away\`) to each search result row + map popup, fully client-side, behind \`VITE_SEARCH_MAP_ENABLED\`. No schema/API/DTO/fetch change."
```

> No `--admin`, no force-push. If the branch falls behind `develop`, merge `develop` IN (do not rebase a pushed branch). Mobile Map toggle + bottom-sheet is **3b**, a separate follow-up PR.

---

## Self-Review

**Spec coverage:**
- §1/§2 label format + anchor→pickup distance → Tasks 2, 3, 1.
- §3 zero schema/API change → confirmed; `ResultLocation` untouched (Task 9 Step 4).
- §4 two pure FC functions, reuse `regionChain` guard → Tasks 2, 3 (no second parent walk).
- §5 flat-prop threading route→SearchMap→SearchMapList→row/popup → Tasks 6, 7, 8.
- §6 4 i18n keys × 3 locales → Task 1.
- §7 edge cases (no coords, no anchor, beyond radius, area==prefecture, 0.0 km, cyclic parent) → covered in Tasks 2 + 3 tests.
- §8 tests incl. seam captor + #840 untouched → Tasks 2-8 + Task 9.
- §9 scope: no pin-label/API/schema change → none made. 3b out.

**Placeholder scan:** none — every step carries real code/commands.

**Type consistency:** `resolveGeoContext(location, regions, anchor) → GeoContext | null`; `formatGeoContext(ctx, locale, t) → string | null`; `geoLabel?: string | null` on `SearchResultRowProps` + `MapPopupCarouselProps`; `regions?: readonly RegionNode[]` + `geoAnchor?: GeoPoint | null` on `SearchMapListProps` + `SearchMapProps`; route passes `regions ?? []` + `regionAnchor`. Names consistent across Tasks 2-8.
</content>
</invoke>
