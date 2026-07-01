# Home funnel polish + search-state retention

Date: 2026-06-30
Status: In progress
Issue: #1291
Owner: web

## Problem

An audit of the home page (`$locale/index.tsx`) and the renter browse flow found two classes of defect:

1. **Dead-end entry points.** The prominent home CTAs ("View all", the CTA banner
   button, and the four "Popular vehicles" cards) all point at
   `/$locale/vehicles` — a static marketing catalog of vehicle *classes* that
   carries no dates/filters and does **not** connect to the bookable funnel.
   The real funnel is `/$locale/search` -> `/$locale/storefronts/:locationId` ->
   `/$locale/bookings/new` -> `/$locale/bookings/confirmation`. The only real
   entry into it is the hero search widget. The four popular-vehicle cards are
   hardcoded mock data and link generically, so clicking "Honda N-BOX" opens
   nothing specific. The footer has no links at all.

2. **Search/filter state dropped across navigation.** Search state is URL-param
   based (`from`, `to`, `pickupLocationId`, `region`, `class`) and
   `carryForwardFilters()` (`storefronts/params.ts`) is the canonical helper, but
   several call sites bypass it:
   - the booking CTA (`AvailableVehicleCard`) forwards only vehicleId/locationId/from/to;
   - the reservation wizard back-link and the unavailable-vehicle redirect drop
     class/region/pickupLocationId;
   - the hero widget resets `region` on every visit (only from/to persist);
   - the class chips silently drop any ACRISS code outside the 8-chip subset on re-submit;
   - there is no `sort` or price filter at all (nearest-first is client-only, not user-selectable).

## Decisions

- Route **all** home entry points into `/search` (the real funnel), not `/vehicles`.
- Fix **all four** state leaks: carry filters through booking, persist hero region,
  add sort + price filters, fix the ACRISS chip drop.
- Sort/price are done **client-side, per page** (the storefront card already carries
  `fromDailyPriceJpy`/`fromHourlyPriceJpy`), matching the existing `rank.ts` per-page
  ranking philosophy — no API change. Server-side sort/price stays the scale follow-up.
- Popular-vehicle cards become honest **category tiles** (by ACRISS class), dropping the
  fabricated rating/price.
- Footer links only to **existing** routes (Browse/Categories/Sign in); legal pages
  (Terms/Privacy/Contact) are a separate follow-up so we don't manufacture new dead links.
- Passenger/seat filter is deferred (needs an API seat-count field on the storefront card).

## Slices (each independently shippable + mergeable)

### Slice 1 — Route home entry points into `/search`
- `landing/FeaturedVehicles.tsx`: "View all" (x2) + the four cards -> `/$locale/search`;
  reframe the cards as category tiles deep-linking `/search?class=<ACRISS>`, drop fake rating/price.
- `landing/CallToAction.tsx`: button -> `/$locale/search`.
- `landing/Footer.tsx`: link row to existing routes (Browse, Categories, Sign in).
- i18n keys in `landing.featured` / `landing.footer` across en/ja/zh.
- Tests: component test asserts each home CTA resolves into `/search`.

### Slice 2 — Carry filters through the booking hop
- `_renter/bookings/new.tsx`: widen `NewBookingSearch` passthrough; unavailable redirect uses `carryForwardFilters`.
- `AvailableVehicleCard.tsx`: accept class/region/pickupLocationId props; append via `carryForwardFilters`.
- `StorefrontDetailView.tsx`: pass filters down to the card.
- `ReservationWizard.tsx`: accept filters as props; back-to-listing Link uses `carryForwardFilters`.
- Tests: booking CTA + wizard back-link + unavailable redirect preserve the three filters.

### Slice 3 — Persist hero search region
- `storefronts/storage.ts`: persist/read region alongside from/to.
- `landing/SearchWidget.tsx`: init region from persisted; persist on submit.
- Tests: storage round-trip; SearchWidget restores persisted region.

### Slice 4 — Fix ACRISS chip drop on re-submit
- `StorefrontSearchForm.tsx`: union checked chip codes with incoming out-of-subset class codes.
- Test: a `?class=<non-subset>` code survives a form re-submit.

### Slice 5 — Sort + price filters on `/search`
- `search.tsx`: add `sort` (`nearest|priceAsc|priceDesc`) + `priceMax` search params; extend `carryForwardFilters`.
- Sort dropdown + price control in the search filter bar.
- `StoreGrid.tsx`: apply client-side price filter + sort over `fromDailyPriceJpy` around `rankStorefronts`.
- Tests: pure sort/price fn over fixtures; control -> URL param.

## Verification (per slice)

`vite build` (regenerates `routeTree.gen.ts`), `tsc --noEmit` x3, biome,
i18n parity, `bun run --filter @kuruma/web test`.
