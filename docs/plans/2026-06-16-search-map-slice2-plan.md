# Search map↔list redesign — Slice 2 (#885)

## Context

The search-results map is the renter funnel's core. Slice 1 (#895) added fly-to + a single-car
pin popup; Slice 1b (#898) added an explicit "View cars" detail CTA. But the **fly-to remounts
`<PigeonMap>`** (`selectedId` is in the remount `key`), so any per-row map interaction re-fetches
all tiles — which is exactly why card-as-affordance hover/focus was built then **reverted** out of
1b (code-review HIGH). Slice 2 (brief §7 + handoff) makes the map genuinely interactive:

1. **Non-remount recenter** (controlled fly-to) — fly without remounting (kills the tile-thrash). *Foundation.*
2. **Re-add card hover/focus** — now safe; reuse the reverted tests at reflog `17f9a8f6`.
3. **Price-labeled pins** — Airbnb/Zillow "¥8,000" pills, selected inverts (replaces grey dots).
4. **Co-location carousel popup** — N cars at one store-pin → a swipeable popup (Turo model).

Signed-off design: `docs/plans/2026-06-15-search-map-list-redesign.md` §4–5 (Option B, car-first).

## The crux: pigeon-maps non-remount fly-to (verified against v0.22.1 source)

`<Map>` supports **controlled `center`/`zoom`** props. On a prop change its `componentDidUpdate`
(`index.esm.js:1154`) calls `setCenterZoomTarget` → an **animated tween** (no remount). `onBoundsChanged`
reports the post-move viewport — and `syncToProps` (which fires it) is **debounced 60ms** (`:1095`,
`DEBOUNCE_DELAY:111`), while `componentDidUpdate` compares against the *animation target* mid-flight
(`:1185`) and prop-equality-guards (`:1181`). So syncing `onBoundsChanged → state` does **not** truncate
a programmatic fly-to (the debounce lets the tween settle before the prop re-syncs). Mechanism: hold
`{center, zoom}` in state, sync from `onBoundsChanged`, push the selected pin's viewport on selection
change → animated fly-to, no remount.

**Drop the remount `key` entirely.** Re-fit on a new result set / region is handled by a controlled
reset effect (below), which *animates* to the new fit (pigeon caps far jumps via `animateMaxScreens`,
so a cross-country new search snaps instead of crawling). No `key` → the map never remounts → zero
tile-thrash on any interaction.

## Approach — 4 TDD tasks (dependency order), branch off `feat/search-map-s1b-card-cta`

### Task 1 — Controlled-mode recenter (the no-remount foundation)
- `PigeonMapAdapter.tsx`: replace `defaultCenter`/`defaultZoom` + `key` with controlled `center`/`zoom`
  from `useState(() => focusViewport(pins, anchor, selectedId))`; wire `onBoundsChanged → setView`;
  **remove the `key` prop entirely.** A **single** viewport-sync effect (one state → one precedence
  function — this is the fix for the two-effect race): on a `targetSignature` of `selectedId` + `anchor`
  + each pin's `id:lat:lng` → `setView(focusViewport(pins, anchor, selectedId))`. `focusViewport` already
  encodes the precedence (**selected pin wins → else region anchor → else fit-all**), so a result-set
  change with a *still-valid* selection stays flown-to that pin, while a *stale* selection (gone from the
  new set) falls through to the new region/fit — no two effects can disagree. The signature includes
  `lat:lng` (**P2**) so a coordinate change for the same location id still recenters. `onBoundsChanged`
  preserves user pan/zoom — the effect only fires when selection/anchor/pins change, never clobbering a
  manual pan. Deps = `[targetSignature]` (one `// eslint-disable-next-line`: the string encodes the inputs).
- `viewport.ts`: unchanged — `focusViewport(pins, anchor, selectedId)` is reused as the **single** precedence
  fn for both the initial state and the sync effect.
- Tests (`PigeonMapAdapter.test.tsx`): extend the pigeon mock to (a) read `center`/`zoom`, (b) stamp a
  **mount-instance id** (module counter in a mount effect) → `data-instance`, (c) expose `onBoundsChanged`.
  Mutation-resistant tests:
  1. **No remount:** select a pin → center moves AND `data-instance` unchanged (the tile-thrash guard).
  2. **Reset / no drift:** region A → pan via `onBoundsChanged` → rerender region B (anchor B, selection
     stale/cleared) → `center`==B anchor @ `REGION_ZOOM`, `data-instance` same.
  3. **Selection wins on result change:** select loc1 → rerender a set that STILL has loc1 + a *new* anchor
     → `center`==loc1 coords @ `SINGLE_PIN_ZOOM` (selection beats the new anchor; popup stays coherent).
  4. **Stale selection falls to fit:** select loc1 → rerender a set WITHOUT loc1 + anchor B →
     `center`==anchor B @ `REGION_ZOOM`.
  5. **Coord change recenters (P2):** same location id, new lat/lng → `center` updates.
  Update the existing recenter / center-from-default tests to controlled `center`/`zoom`.

### Task 2 — Add card hover/focus (card-as-affordance, *additive*)
- `SearchMapList.tsx`: add `onMouseEnter`/`onFocus` on each geocoded `<li>` → `setSelectedId(locationId)`
  (idempotent — sets, never clears). List-only (null-coord) rows stay inert. **Keep the "Show on map"
  button** (P3 — touch affordance; hover doesn't exist on touch and the mobile Map toggle is Slice 3) but
  make it an **idempotent select, not a toggle**: `onClick={() => setSelectedId(locationId)}` and **drop
  `aria-pressed`** (it's an action button now — selection state lives on the row's `aria-current` + ring).
  This kills the focus/click race the reviewer flagged: with a toggle, focusing the button selects the row
  via the `<li>` `onFocus`, then the ensuing click toggles it back *off*; idempotent-select makes
  focus-then-click consistently *select*. Deselect isn't needed — selection follows hover/focus/tap forward.
  `onFocus` on the `<li>` catches focus on the inner CTA via React's bubbling (focusin-based) → keyboard
  parity.
- Tests (`SearchMapList.test.tsx`): use **`userEvent.click`** (real focus→click order, not `fireEvent`) on
  the button → row selected; click it **again → still selected** (proves idempotent, no toggle-off). Focus
  the *real* `View cars` link (`within(row).getByRole('link')`), not the `<li>` → row `onFocus` selects the
  map (**P2** keyboard path). Hover a geocoded row → selected; null-coord row hover inert. Replace the
  slice-1 toggle-off / `aria-pressed` assertions (behavior intentionally changed).

### Task 3 — Price-labeled pins
- `MapAdapter.ts`: add `renderPin?: (item, { selected }) => ReactNode` (mirrors the `renderSelected`
  seam — the **view** owns the whole interactive pill: i18n, min-price, `onClick`, `aria-label`, styling;
  the adapter only positions it).
- `PigeonMapAdapter.tsx`: when `renderPin` is given, position each pin's returned node in an `<Overlay>`
  centered on the pin; fall back to the `<Marker>` dot (wired to `onSelect`) when absent — keeps the bare
  adapter + its existing dot tests intact.
- `result.ts`: add `groupByLocation(items)` and `pinPriceLabel(group, t)` (min `dailyRateJpy`, else min
  `hourlyRateJpy`, else `noPrice`; "From ¥X" when group>1 else "¥X"). Pure → unit-tested in `result.test.ts`.
- `SearchMapList.tsx`: pass `renderPin` rendering the styled pill `<button>` (selected inverts colors,
  `onClick={()=>setSelectedId(locationId)}`) from the group. **P2 — accessible name:** the price text
  alone ("¥8,000") is indistinguishable across pins, so set `aria-label` = store + price, e.g.
  "Select Sakura Mobility · Namba, From ¥8,000", with a **no-price fallback** ("…, price on request") so a
  price-less pin is never an unlabeled button.
- i18n: `map.pinPrice` "¥{price}", `map.pinPriceFrom` "From ¥{price}", `map.pinSelect`
  "Select {store}, {price}" in en/ja/zh.

### Task 4 — Co-location carousel popup
- New `MapPopupCarousel.tsx` (mirror `PhotoGallery.tsx`: index state, prev/next, dot jumps, wrap-around
  modulo, `role="group"`). Each slide = car mini-card: photo · name · class · price · "View cars" Link
  (same `carryForwardFilters` target as `SearchResultRow`). N=1 → no arrows. Threads locale/from/to/filters.
- `SearchMapList.tsx`: `renderSelected(item)` now derives the group via `groupByLocation(items)` and renders
  `<MapPopupCarousel>`. The only `MapAdapterProps` change this slice is the additive `renderPin` (Task 3);
  the carousel needs none — the view's closure already holds full `items`, and the adapter keeps passing the
  representative selected item for the anchor.
- i18n: `map.popupPrev`, `map.popupNext`, `map.popupPosition` "{n} / {total}" in en/ja/zh.
- Tests (`MapPopupCarousel.test.tsx` new + `SearchMapList.test.tsx`): single car → no arrows; N cars →
  next/prev cycle + position label; each slide's CTA carries from/to + filters.

### One-way (#882) guardrail — explicitly deferred (P3)
The signed-off design §6 guardrail #2 ("adapter takes a list of points / optional route per selection")
is **intentionally not built this slice.** Rationale (YAGNI): one-way rentals are a separate deferred epic
(#882) with no consumer today, and the current contract does not *block* it — the adapter already takes a
list (`items` = points) and a `selectedId`; a future dropoff pin / route line is an **additive** prop
(`route?` / `secondaryPins?`) when #882 lands. Adding the seam now would be a speculative API with no caller.
This is a conscious defer, not an oversight.

## Files
- Edit: `PigeonMapAdapter.tsx`, `MapAdapter.ts`, `SearchMapList.tsx`, `result.ts`, `messages/{en,ja,zh}.json`
- New: `MapPopupCarousel.tsx` (+ `.test.tsx`)
- Tests: `PigeonMapAdapter.test.tsx`, `SearchMapList.test.tsx`, `result.test.ts`
- Reuse: `PhotoGallery.tsx` (carousel pattern), `viewport.ts`, `carryForwardFilters` (`storefronts/params`),
  `resultTitle`/`resultPriceLabel`/`searchResultKey` (`result.ts`)

## Verification
- `bun run --filter @kuruma/web test` (vitest; per-task + full suite green — was 922/922 on s1b).
- `bun run --filter @kuruma/web typecheck` (tests aren't typechecked; prod call-sites are).
- `bunx biome check --write` before commit (pre-commit biome is read-only).
- Don't regress the region anchor (#840) or `e2e/real-db/region-search.auth.spec.ts`.
- code-reviewer agent before PR. Manual: `bun run dev`, search a region with co-located cars → hover a
  row flies (map does NOT flash/reload tiles), pin pills show prices, click a multi-car pin → carousel.

## PR strategy
- Worktree `~/Dev/kuruma-map-s2` + `bun install`; branch `feat/search-map-s2-carousel-pins` off
  `feat/search-map-s1b-card-cta` (s1b tip) while #895/#898 are open; rebase onto `marketplace-pivot` if
  the owner merges the stack first. One Slice 2 PR, `refs #885`. **Owner-gated — do NOT `--admin`.**
  Optional split if smaller reviews are wanted: 2a = Tasks 1–2 (recenter + hover), 2b = Tasks 3–4
  (price pins + carousel).
