# Search results: map ↔ list interaction redesign

**Status:** PROPOSAL — for review & decision (not yet approved) · 2026-06-15
**Author:** (Jack + Claude)
**Decision owner:** Jack + colleague
**Supersedes the UX of:** #458 (`feat: map + flat-list search results`, closed — original build)
**Related design:** `docs/plans/2026-06-12-renter-location-search-niconico.md` (region search), shipped via #651
**Surface:** renter search results, route `packages/web/src/routes/$locale/search.tsx`

---

## 1. Why we're touching this

The search-results screen is the core of the renter funnel: it's where "I need a car in Kyoto on these dates" turns into a booking. Today it under-delivers, and the problems are structural, not cosmetic.

### What exists today (two half-views behind one toggle)

The top-right **门店 / 地图** control is **not a layout toggle — it swaps to a different page with different data**:

| View (`?view=`) | Component | Card granularity | Map? |
|---|---|---|---|
| `stores` (default) | `StoreGrid` → `StorefrontCard` | **one card per store** (location) | **no map** |
| `map` | `SearchMap` → `SearchMapList` → `PigeonMapAdapter` | **one card per vehicle** | yes (right side) |

So a renter gets *either* a store list with no map, *or* a car list with a map — never a coherent "browse on the map" experience. The screenshot bugs are all in the **`map`** view.

### The root mismatch

In the `map` view, **cards are per-vehicle but map pins are per-location.** When 3 cars sit at *Sakura Mobility · Kyoto Station*, they share **one pin**. Selection is keyed by `locationId` (`SearchMapList.tsx`), so:

- **Clicking the pin highlights all 3 cards** — technically correct (all 3 *are* there), but it carries no information and reads as a bug.
- **The pin reveals nothing** — `PigeonMapAdapter` has **no popup/callout component at all**.
- **"在地图上显示" feels dead** — it *is* wired (toggles a faint ring + recolors the pin) but **never moves the map or shows info**.
- **The card body does nothing** — only "在地图上显示" and the (disabled) "选择" button are interactive.

**Net:** selection has no payload and the map never responds. That's a design problem, so we're redesigning rather than patching.

---

## 2. Industry standard for list + map result views

The established pattern is the **synchronized list–map split view**, used by Airbnb, Booking.com, Zillow, Redfin, Google Hotels, and — our closest analog — **Turo** (peer-to-peer car rental). The conventions that are genuinely standard:

1. **Split layout** — scrollable list + *sticky* map (desktop); list with a **Map toggle** (full-screen map ⇄ list) or a bottom-sheet on mobile.
2. **Bidirectional sync** — hover/select a card → its pin enlarges/recolors; click a pin → its card highlights and **scrolls into view**. The link is always **1:1 and visible**.
3. **Informative pins** — show **price** ("¥8,000" pills, à la Airbnb/Zillow) or a count, not generic dots. Selected pin inverts color.
4. **Pin → mini-card popup** — clicking a pin opens a callout (photo · price · name) linking to detail. *(We have none — the biggest single gap.)*
5. **Clustering for co-located results** — several results at one spot collapse to **one marker with a count**, clicking it expands to a popup carousel/list. *(Our exact "3 cars at Kyoto Station" case.)*
6. **List drives the decision; the map answers "where / how convenient."**

The standard is not a single layout — it's *how you execute* whatever you decide a "result" is:
- **Booking.com / hotels model** = result is a **property** → one card per property, pin per property (1:1).
- **Turo / car model** = result is a **car** → one card per car, **map clusters** co-located cars.

---

## 3. Options

### Option A — Store-first grouping  ⭐ recommended

Result = **store**. Unify the two views into one synchronized map+list. Card = storefront (name · area · distance · available class chips · "from ¥X/day"), expandable or linking to the **existing** storefront detail page to pick a car. Map = **one price-labeled pin per store, 1:1 with a card.**

```
LIST (per store)            MAP
┌──────────────────────┐   ┌─────────────────┐
│ Sakura Mobility       │   │   ╭────────────╮│
│ Kyoto Station · 2.1km │◄─►│   │Sakura Mob. ││
│ Compact·Kei·SUV       │   │   │3 cars ¥6.5k+││
│ from ¥6,500/day       │   │   ╰──📍─────────╯│
│ [View cars ▾]         │   │  📍   📍         │
└──────────────────────┘   └─────────────────┘
click card → map flies + popup ·  click pin → its one card
```

- **Pros:** 1:1 pin↔card **dissolves the bugs by construction** (no clustering needed); short, scannable list (kills the repeated "Sakura Mobility · Kyoto Station ×3" noise visible today); matches the store-pickup business and the existing `门店` view + storefront detail page; clean, uncrowded map.
- **Cons:** the bookable unit (a specific car) is one level down — renter expands or opens store detail to compare cars.

### Option B — Car-first + clustering (Turo model)

Result = **car**. Keep one card per vehicle. Map clusters co-located cars into a numbered marker; clicking a cluster opens a **popup carousel** of those cars. Add fly-to-pin on card click and hover sync.

- **Pros:** the thing they book is always visible; matches Turo; good when comparing specific models/prices across stores is the main job.
- **Cons:** pin↔cards stays **many-to-1** (needs real clustering + a carousel popup — more to build); long, repetitive list with many cars per store; busier map.

### Option C — Map-driven list ("search this area")

The map is the primary control: panning/zooming re-filters the list to what's in view, with a "Search this area" button (Airbnb's move-map-to-search).

- **Pros:** powerful for area browsing.
- **Cons:** biggest behavior change; re-query plumbing; **largely redundant with our region picker + chips**, which already scope the search. **Recommend deferring** — it's an enhancement layered on A or B, not a base choice.

---

## 4. Recommendation: Option A (Store-first)

**Reasoning, in priority order:**

1. **Store-pickup is the real-world unit.** The renter physically collects the car at a 门店; the store is where the transaction happens. Our platform is operators-with-storefronts.
2. **It reuses the architecture we already have.** The default `门店` view is already store-grouped, and the storefront detail page (`/$locale/storefronts/$locationId`) already exists to list/select cars. Store-first *unifies* these; car-first fights them.
3. **Few stores, many cars per store.** With ~40–50 vehicles across a handful of stores, car-first means a long, repetitive list and a crowded/clustered map. Store-first keeps the list to a few cards and the map clean.
4. **1:1 pin↔card fixes the bugs structurally** — no clustering machinery. Pin = card = store; the "selects all" condition literally cannot arise; the popup carries real info; card-click moves the map.
5. **One coherent screen** replaces two confusing half-views and the data-swapping toggle.

**How A fixes each reported bug:**

| Reported | Fix under A |
|---|---|
| Clicking a card does nothing | Card click flies the map to its pin + opens the popup (and "View cars" → store detail) |
| "在地图上显示" does nothing | Replaced: the whole card is the affordance; the map visibly responds |
| Pin highlights all cards, no info | Pin is now 1:1 with one store card; click opens an informative popup; highlights exactly that card |

**Concretely, A is:** store cards with class chips + "from ¥X" + distance; a **sticky** map with price-labeled pins (selected inverts); a **pin popup** (store · N cars · from ¥X · "View cars"); **bidirectional hover/selection sync** + **fly-to on select**; on mobile, a **Map toggle** with a bottom-sheet card on pin tap. Car comparison happens on the existing storefront detail page (or an optional inline expand of the top 2–3 classes).

---

## 5. The decision for you + colleague

**The one fork that changes everything:** *Is the renter's result a STORE (pick a place, then a car) or a CAR (compare cars; location is an attribute)?*

- **Store → Option A** (recommended).
- **Car → Option B** (Turo-style + clustering). Pick this if comparing specific models/prices across stores is the primary job, **or** if you expect many single-car stores (then grouping adds nothing).

**Secondary questions to settle in review:**

1. **Card depth:** store card links straight to the detail page, or inline-expands the top 2–3 classes with a Select button (Booking.com "rooms from" pattern)?
2. **Pin label:** price ("¥6,500+", scannable, our standard recommendation) vs a count ("3") vs plain selected/unselected dots?
3. **Mobile:** Map toggle + bottom sheet (recommended) vs a shrunk split.
4. **Keep the 门店/地图 toggle**, or replace with one unified view + a "hide map" option?
5. **"Search this area" (Option C):** in scope now, or a later enhancement? (Recommend later.)

---

## 6. Scope & impact (rough — for cost sense, not a plan)

**Mostly web** (`packages/web/src/vite/search/*`, `…/storefronts/*`, the search route). Likely **no schema change**.

- **New:** a real **pin popup/callout** in `PigeonMapAdapter` (pigeon-maps `<Overlay>`); **fly-to / recenter on selection** (`viewport.ts` already centers on a region anchor — extend to per-selection); **store-grouped cards in the map view** (reuse the `StorefrontCard` / `StoreGrid` model); **bidirectional sync** (`SearchMapList` already tracks a `locationId` selection — extend to fly + popup + scroll-into-view).
- **Verify (API):** the storefront-grouped search payload (`StorefrontSearchResultData`) carries **lat/lng + min price + class counts per store** (the stores view already renders min price + class counts, so likely present — confirm lat/lng).
- **Tests:** extend `SearchMapList.test`, `viewport.test`, `StoreGrid.test`; add popup, fly-to, and sync tests. Don't regress the region anchor (#840) or `e2e/real-db/region-search.auth.spec.ts`.
- **Suggested slicing:** (1) unify to a store-grouped synchronized map+list with 1:1 sync + pin popup + fly-to; (2) price-labeled pins + mobile Map toggle; (3) optional inline car expand. Each is an independent vertical slice / PR.

**Risks:** storefront search must carry coordinates + min price (verify); pigeon-maps overlay ergonomics; preserving region-centering and the existing e2e.

---

## 7. Next steps

1. Review this with the colleague; settle §5 (mainly: store-result vs car-result).
2. On decision, file a tracking issue (the redesign of closed #458) with the chosen option.
3. Finalize the approved design → implementation plan (vertical slices above) → TDD build.
