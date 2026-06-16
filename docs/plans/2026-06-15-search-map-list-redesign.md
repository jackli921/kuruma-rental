# Search results: map ↔ list interaction redesign

**Status:** DIRECTION AGREED — **Option B (car-first)**, pending final colleague sign-off · updated 2026-06-15
**Author:** (Jack + Claude)
**Decision owner:** Jack + colleague
**Supersedes the UX of:** #458 (`feat: map + flat-list search results`, closed — original build)
**Related design:** `docs/plans/2026-06-12-renter-location-search-niconico.md` (region search), shipped via #651
**Surface:** renter search results, route `packages/web/src/routes/$locale/search.tsx`

---

## 1. Why we're touching this

The search-results screen is the core of the renter funnel: it's where "I need a car in Kyoto on these dates" turns into a booking. Today it under-delivers, and the problems are structural, not cosmetic. **The renter is a foreign tourist** — they don't read store names or know Osaka-vs-Kyoto geography, so seeing *where in Japan* a car is picked up is a primary need, not a nicety.

### What exists today (two half-views behind one toggle)

The top-right **门店 / 地图** control is **not a layout toggle — it swaps to a different page with different data**:

| View (`?view=`) | Component | Card granularity | Map? |
|---|---|---|---|
| `stores` (default) | `StoreGrid` → `StorefrontCard` | one card per store (location) | **no map** |
| `map` | `SearchMap` → `SearchMapList` → `PigeonMapAdapter` | **one card per vehicle** | yes (right side) |

So a renter gets *either* a store list with no map, *or* a car list with a map — never a coherent "browse cars on the map" experience. The screenshot bugs are all in the **`map`** view.

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
5. **Clustering / carousel for co-located results** — results at one *point* collapse to a popup **carousel**; distinct results *near* each other collapse to a numbered cluster that **splits on zoom**.
6. **List drives the decision; the map answers "where / how convenient."**

The standard is not a single layout — it's *how you execute* whatever you decide a "result" is:
- **Booking.com / hotels model** = result is a **property** → one card per property, pin per property (1:1).
- **Turo / car model** = result is a **car** → one card per car, **map carousel/cluster** for co-located cars. ← **our choice**

---

## 3. Options considered

### Option A — Store-first grouping

Result = **store**. One card *and* one pin per store (1:1), expandable/linking to the storefront detail page to pick a car. *Pros:* 1:1 pin↔card dissolves the bugs by construction; short list; clean map. *Cons:* the bookable unit (a specific car) is one level down — weaker for a foreigner who wants to see *this car* on the map.

### Option B — Car-first + co-location carousel (Turo model)  ⭐ chosen

Result = **car / combo**. One card per vehicle or class-combo. Map pin per **pickup store**; co-located cars share a pin whose click opens a **swipeable carousel**. Card focus flies the map to + opens a popup on its pickup pin. *Pros:* the bookable thing is always visible and instantly placed on a map of Japan — exactly the foreigner geo-feedback goal; matches Turo. *Cons:* pin↔cards is many-to-1 (handled by the carousel, not a blocker).

### Option C — Map-driven list ("search this area")

The map is primary: panning/zooming re-filters the list, with a "Search this area" button. *Largely redundant with our region picker + chips.* **Deferred** — an enhancement on top of B, not a base choice.

---

## 4. Decision: Option B (car-first)

**Chosen 2026-06-15** for one overriding reason the store-first analysis under-weighted: **the renter is a foreign tourist who needs instant "where in Japan can I pick this up?" feedback.** Seeing the specific car they're considering pinned on a map beats a tidy store list for that user. Result granularity = **individual cars + class-combos**, each tied to its pickup-store pin.

**The co-location mechanic (the one real constraint):** a car's "where" *is* its pickup store's coordinates, so cars at the same store share one pin — there is nothing to geographically separate. "Show where *this* car is" = focus a card → the map **flies to + highlights + opens a popup** on that car's **pickup** pin. Clicking a pin that holds N cars opens an **Airbnb-style swipeable carousel** of those cars/combos (industry standard for multiple results on one point). Distinct *nearby* stores still cluster and **split on zoom**.

**How B fixes each reported bug:**

| Reported | Fix under B |
|---|---|
| Clicking a card does nothing | Card focus flies the map to its pickup pin + opens the popup |
| "在地图上显示" does nothing | Replaced: focusing the card is the affordance; the map visibly responds (fly + popup) |
| Pin highlights all cards, no info | Pin click opens a **carousel popup** of exactly the cars/combos at that store — no more silent "all highlighted" |

**The real geo-feedback win is context, not the dot:** each card + popup shows nearest **landmark/station · distance · prefecture** (e.g. "Kyoto Station · 2.1 km from downtown"). For a foreigner that conveys "where" far better than a pin alone.

**Concretely, B is:** per-car / per-combo cards (name · class · price · pickup store + geo-context); a **sticky** map with price-labeled pins (selected inverts); a **pin popup carousel** for co-located results; **bidirectional hover/selection sync** + **fly-to on focus**; on mobile, a **Map toggle** + bottom-sheet card on pin tap.

*Revisit Option A only if* the catalog grows to many stores with one car each (grouping then adds nothing anyway) **or** store-pickup convenience eclipses model choice in user testing.

---

## 5. Decisions & remaining open questions

**Resolved:**
- **Result granularity → individual cars + combos** (Option B). *[decided]*
- **Store-vs-car result → car**, for the foreigner geo-feedback goal. *[decided]*
- **Pin click with N co-located cars → Airbnb-style swipeable carousel popup.** *[decided — industry standard]*
- **Pin label → price** ("¥8,000" / "from ¥6,500"), the scannable Airbnb/Zillow standard. *[leaning — industry standard]*
- **Mobile → Map toggle + bottom sheet.** *[leaning — industry standard]*

**Still open:**
1. **Card / popup target:** link to the vehicle/combo detail page, or an inline quick-view? *(Lean: link to existing detail.)*
2. **Keep the 门店/地图 toggle**, or make one unified map+list the default with a "hide map" option? *(Lean: unified default.)*
3. **Later enhancements, designed-for not built-now:** "Search this area" (Option C) and **one-way rentals** (§6).

---

## 6. Future consideration: one-way rentals (pickup ≠ dropoff)

A renter picks up at store A and drops off at store B (a.k.a. one-way / relocation rental). **Not in scope now**, but the redesign should not preclude it.

**Industry-standard UX** (Hertz/Avis/Kayak/Turo): the search form gains a **"Return to a different location"** toggle that reveals a **dropoff** field (default off = same location); results show cars valid for that pickup→dropoff route; a **one-way / drop fee** is added; the card shows a "One-way OK · drop fee ¥X" badge.

**Forward-compat guardrails to bake into THIS build (cheap now, expensive to retrofit):**
1. **Label the pin/popup as the _pickup_ pin explicitly**; treat `result.location` as pickup-specific, not "the location."
2. **Map adapter takes a _list of points / an optional route_ per selection**, even though today it's always one pin — so a future dropoff pin or a pickup→dropoff route line is additive (pigeon-maps supports multiple markers + overlays).
3. **Result DTO leaves room for an optional dropoff dimension**; don't bake a "one location per car" assumption into the card/popup types.
4. **Pricing is already extensible** — a drop/relocation fee is just another fee term (`feeSnapshot` + the shared `composeBookingTotal`), no architectural change.

**Honest cost split:** the map UX above is the easy part. One-way's real cost is the **inventory/fleet model** — a vehicle now *ends* at a different location, so availability becomes per-location-over-time and the Postgres exclusion constraint (double-booking prevention) must account for relocation and rebalancing. That's a backend epic, largely orthogonal to this redesign. **So: design the UI to not block it; defer the inventory work to its own project.**

---

## 7. Scope & impact (rough — for cost sense, not a plan)

**Mostly web** (`packages/web/src/vite/search/*`, the search route). Likely **no schema change** for the core redesign.

- **New:** a real **pin popup / carousel** in/around `PigeonMapAdapter` (pigeon-maps `<Overlay>`); **fly-to / recenter on focus** (`viewport.ts` already centers on a region anchor — extend to per-selection); **bidirectional sync** (`SearchMapList` already tracks a `locationId` selection — extend to fly + popup + scroll-into-view); **price-labeled pins**; **geo-context labels** (landmark/station · distance · prefecture) on card + popup.
- **Verify (API):** the flat search payload (`SearchResultsData`) carries **lat/lng per pickup location** (it does — pins render today) and that a **min/representative price** is available for pin labels. Geo-context (nearest landmark/region name) may reuse the region data from #651.
- **Build with the §6 guardrails** so one-way is additive later (pickup-labeled pins; multi-point-capable adapter; dropoff-open DTO).
- **Tests:** extend `SearchMapList.test`, `viewport.test`, `PigeonMapAdapter.test`; add carousel, fly-to, and sync tests. Don't regress the region anchor (#840) or `e2e/real-db/region-search.auth.spec.ts`.
- **Suggested slicing (independent vertical PRs):** (1) card↔pin sync + fly-to + pin popup (single-car case); (2) co-location **carousel** + price pins; (3) **geo-context** labels + mobile Map toggle.

**Risks:** pigeon-maps overlay/carousel ergonomics; preserving region-centering + the existing e2e; sourcing a clean "nearest landmark" label for geo-context.

---

## 8. Next steps

1. Final colleague sign-off on §5 (mostly the two "leaning" calls + the two still-open questions).
2. File a tracking issue (UX redesign of closed #458) referencing this brief and the chosen Option B.
3. Finalize the approved design → implementation plan (the vertical slices in §7) → TDD build.
