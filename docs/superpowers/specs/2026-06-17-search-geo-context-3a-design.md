# Search geo-context labels (Slice 3a of #885) — design spec

**Status:** Approved design (brainstorm) — 2026-06-17 · ready for implementation plan
**Author:** Jack + Claude
**Epic:** #885 (search map↔list redesign, Option B car-first). Slices 1/1b/2 + Task-0 flag shipped.
**Branch:** `feat/885-search-geo-context` (worktree `~/Dev/kuruma-map-s3`, off `develop` `22eec6e1`)
**Surface:** renter search results, car-first map+list view — `packages/web/src/vite/search/*`
**Gate:** ships **behind `VITE_SEARCH_MAP_ENABLED`** (dark launch). The whole map+list view already
renders only under `isSearchMapEnabled() && data.view === 'map'` (`search.tsx:187`), so every change
here is invisible in beta with no extra guard.

---

## 1. Goal

Give the foreign tourist instant "where in Japan is this car?" context on each result. Each list row and
each map popup card gains a one-line geo-context label:

> **`{nearest area}, {prefecture} · {N} km away`** — e.g. "Umeda, Osaka · 3.5 km away"

When no region was searched (no anchor) the distance clause drops to **"Umeda, Osaka"**.

This is the §4 "the real geo-feedback win is context, not the dot" requirement from
`docs/plans/2026-06-15-search-map-list-redesign.md`, scoped to **3a** (labels only). Mobile Map
toggle + bottom-sheet is **3b**, a separate follow-up PR.

## 2. Decision (locked)

The distance number = **searched region anchor → pickup store** (`haversineKm`), the industry-standard
metric (Booking.com "X km from centre", Turo "X away"). Chosen over store→nearest-landmark (≈constant
~0.3–0.5 km here, uninformative) and name-only. Rationale:
- **List ↔ map agree.** Same metric `storefronts/rank.ts` already computes for the StoreGrid distance
  chip (the `~X.X km` the #840 e2e asserts) — so the two views speak one language.
- **Graceful degrade.** No anchor (no region searched) → no reference point → label cleanly falls back
  to "Area, Prefecture" only.

## 3. Data sources — all already present (zero schema / API / DTO change)

Verified on `develop`:
- **Nearest area (the landmark/station label):** AREA-level region nodes *are* landmarks/stations
  (Namba, Umeda, Tennoji, Osaka Castle, Shin-Osaka, KIX, Kyoto Station, Sannomiya, Nara) seeded with
  WGS84 coords + trilingual names (`packages/shared/src/db/seed-data/regions.ts`). Only AREA nodes are
  `assignable` and carry coords, so `nearestAssignableRegion(regions, point)`
  (`packages/shared/src/lib/region-distance.ts`) returns the nearest AREA directly.
- **Prefecture:** reuse `regionChain(regions, area.id).prefecture` (`vite/regions/region-lookup.ts`),
  which walks `parentId` up, filling slots by `type` — AREA → CITY → PREFECTURE (Namba → Osaka City →
  Osaka; KIX → Izumisano → Osaka). It is depth-agnostic **and already cycle-guarded** (a `seen` set
  bounds a malformed self-FK like `A → B → A`; `regions.parentId` has no DB cycle constraint), so we do
  **not** hand-roll a second parent walk.
- **Distance:** `haversineKm(anchor, { latitude, longitude })` — anchor is the searched region centre,
  already resolved client-side (`resolveRegionAnchor`, `packages/web/src/vite/regions/region-lookup.ts`);
  store coords are already on `ResultLocation`.
- **Region tree client-side:** `search.tsx:146` already does `useQuery(regionsQueryOptions())` → full
  `RegionNode[]` (cached 1 h). No new fetch.

`ResultLocation` (`packages/shared/src/types/search-result.ts`) is unchanged — `regionId` is **not**
added; the area is derived from coords, matching the architect's "geo-context is presentation inside the
existing closures, no contract change" note.

> **Scope honesty (reconciles an interim "landmark = no data" note):** there is **no** dedicated
> nearest-rail-station dataset, and we do **not** build one. The "landmark/station" in the design doc's
> illustrative "Namba Station · 1.2 km" is satisfied here by the **nearest AREA region name** (Namba,
> Umeda, KIX, Kyoto Station …) + the **anchor→pickup** distance — the owner-approved Option 1. This is a
> deliberate simplification using existing data; precise rail-station geocoding is a future enhancement,
> not a blocker for 3a.

## 4. Architecture (Functional Core / Imperative Shell)

Two pure functions in `packages/web/src/vite/search/result.ts` (alongside `resultTitle`/`pinPriceLabel`,
same `Translate` pattern):

```ts
export interface GeoContext {
  area: RegionNode          // the nearest AREA node (always present when this is non-null)
  prefecture: RegionNode | null  // PREFECTURE ancestor, or null if the chain breaks
  distanceKm: number | null      // null when no anchor, or store has no coords
}

// Pure, no i18n. Returns null when the store has no coords (→ no label; same graceful
// degrade as the map's null-coord list-only rows).
export function resolveGeoContext(
  location: ResultLocation,
  regions: readonly RegionNode[],
  anchor: GeoPoint | null,
): GeoContext | null

// Pure given t. Picks name{En,Ja,Zh} by locale; formats via the i18n template.
// Returns null when ctx is null.
export function formatGeoContext(
  ctx: GeoContext | null,
  locale: string,
  t: Translate,
): string | null
```

`resolveGeoContext` finds the area via `nearestAssignableRegion(regions, point)` then derives the
prefecture by reusing `regionChain(regions, area.id).prefecture` — **one** already cycle-guarded upward
walk (its `seen` set bounds a malformed `A → B → A`). This runs over the public, unauthenticated region
list, so an unguarded walk would freeze the renter's tab; do **not** write a second `while (parentId)` loop.

Formatting rules in `formatGeoContext`:
- area name == prefecture name (e.g. "Nara"/"Nara") → use the **area-only** template (no dup).
- prefecture null → area-only template.
- `distanceKm` rounds (`.toFixed(1)`, mirroring `StorefrontCard`) to **0.0 km**
  (`Number(distanceKm.toFixed(1)) === 0`) → drop the distance clause (a store essentially at the
  searched area reads "Namba, Osaka", not "0.0 km away").

**Shell — `SearchMapList.tsx`** computes once and passes a dumb string down (keeps `regions` out of the
leaf components, avoids per-row recompute):

```ts
const geoLabelById = useMemo(() => {
  const m = new Map<string, string>()
  for (const item of items) {
    const label = formatGeoContext(resolveGeoContext(item.location, regions, geoAnchor), locale, t)
    if (label) m.set(item.location.locationId, label)
  }
  return m
}, [items, regions, geoAnchor, locale, t])
```

`SearchResultRow` and `MapPopupCarousel` each gain an optional `geoLabel?: string | null` prop and render
a muted line (lucide `Navigation`/`MapPin` icon + text) when present — co-located cars share one label.

## 5. Wiring (flat props, mirrors the `from/to` threading from Slice 1b)

`search.tsx` already has `regions` and `regionAnchor`. Thread both:

```
search.tsx (regions, regionAnchor:GeoPoint|null)
  → <SearchMap regions geoAnchor>
    → <SearchMapList regions geoAnchor>   // builds geoLabelById, has locale + t already
      → <SearchResultRow geoLabel>
      → <MapPopupCarousel geoLabel>
```

`SearchMap` and `SearchMapList` gain `regions: readonly RegionNode[]` and `geoAnchor: GeoPoint | null`.
Pass `regions ?? []` while the query is still loading (label simply absent until cached). `geoAnchor` is
the existing `regionAnchor` GeoPoint — distinct from the map's `mapAnchor` `[lat,lng]` tuple, which is
unchanged. Pin price label (Slice 2) is untouched.

## 6. i18n (namespace `search`, existing — no dev-server restart)

Add to `messages/{en,ja,zh}.json` under `search.map.*` (siblings of `map.pinPrice`):

| key | en default |
|---|---|
| `map.geoContext` | `{area}, {prefecture} · {km} km away` |
| `map.geoContextNoDistance` | `{area}, {prefecture}` |
| `map.geoContextAreaOnly` | `{area} · {km} km away` |
| `map.geoContextAreaOnlyNoDistance` | `{area}` |

`{area}`/`{prefecture}` values are the locale-picked region names; `{km}` is `.toFixed(1)`. ja/zh
translations own word order + separators (e.g. ja `{prefecture}{area}・{km} km`). Unit stays Latin "km"
to match the existing `search.distance` chip (#840). Translators may refine.

## 7. Edge cases

- Store has no coords → `resolveGeoContext` returns null → no label (row still renders).
- No region searched → `anchor` null → "Area, Prefecture" (no distance).
- Nearest area beyond `REGION_SANITY_RADIUS_KM` (100 km) → `nearestAssignableRegion` returns null →
  `resolveGeoContext` returns null (don't mislabel a far-flung store).
- area name == prefecture name → area-only template.
- distance rounds to 0.0 km (`Number(distanceKm.toFixed(1)) === 0`) → drop distance clause.
- cyclic / self-referential `parentId` (malformed public region row) → `regionChain`'s `seen` set
  terminates the walk; prefecture resolves or stays null, the render never hangs.

## 8. Tests (TDD, vertical slices)

- `result.test.ts` (pure, exact assertions):
  - `resolveGeoContext`: nearest-area pick among several; prefecture via parent-walk
    (Namba→Osaka City→Osaka); `distanceKm` within 0.05 of expected `haversineKm`; null coords → null;
    null anchor → area+prefecture, `distanceKm` null; beyond sanity radius → null; **cyclic parent rows
    (`A → B → A`) terminate** with prefecture null (proves the reused `regionChain` guard holds).
  - `formatGeoContext`: en with/without distance; ja + zh exact strings; area==prefecture → area-only;
    distance rounds to 0.0 km → place-only; null ctx → null.
- `SearchResultRow.test.tsx`: renders the geo line when `geoLabel` set, absent when null.
- `SearchMapList.test.tsx`: a row at Umeda shows "Umeda, Osaka · …"; popup carries the label; existing
  pin/price/carousel/selection tests stay green.
- `MapPopupCarousel.test.tsx`: renders `geoLabel`.
- **Wiring seam (so a missed forward can't leave labels permanently absent while pure tests stay green):**
  `StorefrontSearchRoute.test.tsx` already mocks `SearchMap` as a propless stub (`:28`) — upgrade that
  mock to capture props via a hoisted captor, and in the map-enabled case assert the route forwarded
  `regions` (non-empty) + a `geoAnchor`. Add `SearchMap.test.tsx` asserting `SearchMap` forwards
  `regions` + `geoAnchor` to a faked `SearchMapList`. Together these cover
  `search.tsx → SearchMap → SearchMapList`, the seam neither the pure helpers nor the leaf renders see.
- No regression: `viewport.test`, `PigeonMapAdapter.test`, and `e2e/real-db/region-search.auth.spec.ts`
  (#840) unchanged and green.

Run: `bun run --filter @kuruma/web test` (vitest; tests are **not** typechecked — run
`bun run --filter @kuruma/web typecheck` separately for prod call-sites).

## 9. Scope

**In (3a):** the two pure helpers, the `SearchMapList` memo + threading, the row + popup line, 4 i18n
keys × 3 locales, tests.

**Out:** mobile Map toggle + bottom-sheet (**3b**, follow-up); any pin-label change; any API / schema /
DTO change; any new fetch; a region breadcrumb on the StoreGrid card (separate, beta-visible — not here).

**Forward-compat (#882 one-way):** the label treats `location` as the **pickup** explicitly; a future
dropoff label is additive. No change needed now.

## 10. Risks / mitigations

- **Nearest-by-coords ≠ a store's assigned `regionId`.** Accepted: Kansai areas are sparse, the nearest
  AREA is the right neighbourhood; the sanity radius prevents gross mislabels. If precision ever matters,
  add `regionId` to `ResultLocation` later (cheap — `regionId` is already in `locationColumns`).
- **Label clutter on the row.** Mitigate with muted styling; it's one short line under the store name.
- **`regions` undefined on first paint.** Label is simply absent until the cached query resolves; no error.
