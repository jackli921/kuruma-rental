# Implementation Plan — Map + Flat-List Search Results (SPECIFIC vehicles)

**Issue:** #458 — `feat(marketplace): map + flat-list search results (specific vehicles)`
**Branch / worktree:** `feat/458-search-map-list` @ `/Users/jack/Dev/kuruma-search-mapview` (based on `marketplace-pivot`)
**Date:** 2026-06-06
**Status:** MERGED 2026-06-10 (#458, PR #513, `8509103`) — cross-operator map + flat-list search landed on `marketplace-pivot`. Plan retained for history; the §0 "Re-grounding" section reflects the live Vite shell.
**Source of truth:** `docs/plans/2026-06-05-scope-update-du-kaku.md` §1.1, §5; context in `docs/plans/2026-05-25-marketplace-mvp-proposal.md` §2 / §10 items 12 & 21.
**Epic:** #385. **Refs:** #463 (`fulfillment_mode` affordance), #464 (class-combo, fast-follow), #457 (luggage), #439 (DB-seek paging follow-up), #392 (slice 6 — **MERGED**; held the migration lock, now released — see §3.3 Migration coordination).

---

## §0 — Re-grounding (2026-06-10): Vite migration merged + migration renumber

> **This section supersedes the stale web references in §2.3, §3.5, §4 (web table), and §5 Slices D/E below.** Between this doc's authoring (2026-06-06) and pickup (2026-06-10), **#497 + #505 merged**: the web shell is now **Vite + TanStack Router on CF Pages**, not Next.js. The **API design (§3.2, §3.3 schema, Slices 0/B/C) is unchanged** — the migration did not touch the API; only the migration *number* changes.

**A. Migration number: `0039` → `0041`.** Trunk now ends at `0040_vehicle_luggage` (#457 merged; `when`=1780966943984). The lat/lng migration is **`0041_add_location_coordinates`** with a `when` later than `0040`'s. Every "0039" below is superseded by "0041".

**B. Web = Vite + TanStack Router (corrected mapping):**
- **Route:** extend the **existing** `packages/web/src/routes/$locale/search.tsx` (TanStack `createFileRoute`), not a Next `app/[locale]/search/page.tsx`. The `?view` toggle is a `view?: 'map' | 'stores' | undefined` field in the route's `validateSearch` (optional `?: T | undefined` — exactOptionalPropertyTypes gotcha) + `loaderDeps`; the loader fetches `/search/vehicles` **only** when `view==='map'` AND the JST range is valid (else `{ result: null }`, mirroring the current storefront loader).
- **Module dir:** `packages/web/src/vite/search/` — **flat**, mirroring `src/vite/storefronts/` (NO nested `components/`, NO `index.ts` barrel; the Vite shell uses neither). `lint:modules` only restricts `@/modules/*`, so cross-`@/vite/` imports are allowed — reuse `@/vite/storefronts/StorefrontSearchForm` + `@/vite/storefronts/params` (`parseSearchRange`/`normalizeClassFilter`) directly. **This resolves D6** (no boundary concern in the Vite tree).
- **Data fetch:** raw `fetch(\`${getApiBaseUrl()}/search/vehicles?…\`, { credentials: 'include' })` + `unwrap<SearchResultsData>(res)` from `@/lib/api-error`. The Vite shell **owns its DTOs** in `src/vite/search/api.ts` (mirror the JSON shape; do NOT import a shared/Next DTO copy). Same pattern as `src/vite/storefronts/api.ts`. The shared **type** module (Slice A) is still the API/server contract; the web mirrors it as a local interface.
- **i18n:** `use-intl` `useTranslations('search')` (NOT next-intl). Keys still go in all 3 `packages/web/messages/{en,ja,zh}.json` (i18n-parity CI gate).
- **Links/toggle:** TanStack `Link` (`to`/`params`/`search`) from `@tanstack/react-router`, not `@/i18n/routing`; `aria-current="page"` for the active toggle (hydration-trap gotcha still applies). No `buttonVariants asChild`.
- **Map host:** Vite is a pure client SPA (no SSR) → **no `dynamic(…, {ssr:false})`**; pigeon-maps renders client-side directly. It still can't run in jsdom, so tests inject the **fake `MapAdapter`** (D1 seam unchanged). Omit `'use client'` (no-op in Vite).
- **Route regen:** extending the existing search route adds **no** new route file, so likely **no** `routeTree.gen.ts` regen — but if any new route file is added, run `vite build` to regen and **stage** `routeTree.gen.ts` before typecheck.
- **Tests:** vitest + RTL under `src/vite/search/*.test.tsx`; mock `@tanstack/react-router` `Link`/`useNavigate` and wrap in `IntlProvider` (en), per the slice-5d test pattern already in `src/vite/`.
- **Gate (Vite):** web `vitest run`, `typecheck` (`tsc --noEmit && tsc -p tsconfig.app.json`), `vite build`, `lint:dist-size` — not the old `.next` build.

---

## 1. Goal + Non-goals

### Goal
Add a NicoNico-style **map pane + left-side scrollable flat list** as a *first-class, alternative* renter search-result view. After a renter submits search params (date range, optional pickup location, optional class filter), the flat view lists **specific vehicles** (one row per physical car, identified by plate) **across all operators and locations** that match the params, with each row pinned to its pickup location on the map.

This is a **new presentation layer over the slice-5 availability data** — it does not introduce a new availability model.

### Non-goals (explicit)
- **SPECIFIC vehicles only.** No class-combo / class-level "deals". Class-combo (#464) needs a per-(operator, location, class, time) inventory-count availability model and lands post-demo. The result DTO in §3 is *shaped* so a `CLASS_COMBO` row drops in without a rewrite, but we do **not** build it.
- **One additive schema change (D2 — APPROVED).** A single additive migration adds `latitude`/`longitude` to `locations` so markers carry real coordinates; seed/backfill populate them. Everything else still reads through the existing public availability path — no new availability model, no new tables. **This migration (Slice 0) is the first step for any schema-backed projection work:** the read service builds `ResultLocation` with `latitude/longitude`, so it can only be coded after the column exists (see §5 sequencing rule). Coord-free scaffolding (the shared type, the flat-list row UI) may precede it; the coordinate-carrying projection and markers may not.
- **Both flows coexist.** The slice-5 storefront-first flow (`/search` → `StorefrontCard` → `/storefronts/[locationId]`) stays exactly as-is and remains first-class. The map/list view is reachable alongside it ("room to switch"), never a replacement.
- **No booking.** The "select" control stays a disabled placeholder, same as slice-5 `AvailableVehicleCard` (booking is slice 6 / #392).
- **No luggage attributes** (that is #457 — the DTO leaves room but the column doesn't exist yet).

---

## 2. Current State (exact, verified)

### 2.1 API — public availability read (slice 5, #391, merged on this branch)

| File | What exists |
|---|---|
| `packages/api/src/routes/storefronts.ts` | Two public (anonymous) GET routes mounted via `createStorefrontRoutes(searchService, detailService, publicCatalogLimiter)`. Per-IP rate limit on `/storefronts/*`. 10s edge cache (`CACHE_SECONDS`). |
| `packages/api/src/services/storefront-search.ts` | `StorefrontSearchService.search(ctx, params)` → storefront **cards** (one per location, with `classSummaries`, from-prices, representative photos). |
| `packages/api/src/services/storefront-detail.ts` | `StorefrontDetailService.getDetail(ctx, params)` → individual **`AvailableVehicle[]`** for ONE location. |
| `packages/api/src/repositories/types.ts` | `AvailabilityRepository.findAvailableVehicles(from, to, filters?)` (`AvailabilityFilters = { locationId?, operatorId?, classId? }`, L269-289); `StorefrontRepository.findActiveStorefronts(ctx, { pickupLocationId? })` → `Storefront = Location & { operatorName }` (L297, L312-314). |
| `packages/api/src/index.ts` | Composition root. `storefrontSearchService` + `storefrontDetailService` wired L367-376; routes mounted in the chained `.route('/', ...)` builder (L380+). Drizzle vs InMemory repo swap L187-253. |

**Existing endpoints + params:**

```
GET /storefronts/search
  query: from(ISO, req), to(ISO, req), pickupLocationId?, class?(repeatable ACRISS), limit?(1..50,def 25), cursor?
  200 { success:true, data: { storefronts: StorefrontCard[], nextCursor: string|null } }
  400 invalid range / invalid cursor

GET /storefronts/:locationId/vehicles
  query: from, to, class?, limit?, cursor?
  200 { success:true, data: { storefront: StorefrontSummary, vehicles: AvailableVehicle[], nextCursor } }
  404 unknown/archived location
```

**Existing DTOs** (`storefront-detail.ts` L28-47) — the one we extend:

```ts
interface AvailableVehicle {          // renter-safe projection — NO licensePlate, NO operator internals
  id; name; make; model; year; seats; transmission;
  acrissCode: string|null; classLabel: string;
  dailyRateJpy: number|null; hourlyRateJpy: number|null; photos: string[]
}
```

> Note: `AvailableVehicle` intentionally **omits `licensePlate`** (renter-safe column projection, detail service L23-27). The issue says "identified by plate" — see §6 decision D3 (the *plate* is the operator-side identity; the renter view needs a stable `id` and a per-vehicle row, not necessarily the plate string displayed).

### 2.2 Location data — NO geo coordinates today (D2 adds them)

`packages/shared/src/db/schema.ts` L163-203 (`locations`) and `packages/api/src/stores.ts` L109-121 (`Location` type): columns are `id, operatorId, name, address, operatingHours, timezone, defaultTurnaroundMinutes, status`. **There is no `latitude`/`longitude`** today. A map needs real coordinates → D2 (APPROVED) adds the two columns in this slice; see §3.3 for the schema + drizzle workflow + migration-coordination rules, and §6 D2 for the rationale.

`packages/shared/src/db/seed.ts` L398-414 seeds **3 real Osaka storefronts** (Namba Store, Umeda Store, Kansai Airport Counter) with full street addresses → backfill coords are known-good and can be hard-coded in the seed (see §3.3). The location-CRUD path (slice 2, #387) is operator-owned; the form must learn to capture/edit lat/lng for new locations (flagged in §4).

### 2.3 Web — slice-5 storefront module

| File | What exists |
|---|---|
| `packages/web/src/app/[locale]/search/page.tsx` | Server component. Parses `from/to/pickupLocationId/class`, calls `fetchStorefronts`, renders `StorefrontSearchForm` + a grid of `StorefrontCard`. |
| `packages/web/src/app/[locale]/storefronts/[locationId]/page.tsx` | Storefront drill-down (vehicles at one store). |
| `packages/web/src/modules/storefronts/api.ts` | Typed `hono/client` calls: `fetchStorefronts(params)`, `fetchStorefrontDetail(locationId, params)` via `createApiClient()` + `client.storefronts.search.$url()`. JSON DTO mirrors (`StorefrontCardData`, `AvailableVehicleData`, etc.). |
| `packages/web/src/modules/storefronts/params.ts` | `parseSearchRange(from,to)` (JST wall-clock), `normalizeClassFilter(value)`. |
| `packages/web/src/modules/storefronts/components/` | `StorefrontSearchForm`, `StorefrontCard`, `AvailableVehicleCard`, `ClassSummaryBadges`, `StorefrontDetailView`, `index.ts`. |
| `packages/web/src/modules/storefronts/index.ts` | Public barrel (R2). |
| `packages/web/src/components/nav/Navbar.tsx` | L30: already links `/search` (label `t('search')`). |
| `packages/web/src/lib/route-helpers.ts` | `classifyRoute`: `/search` and `/storefronts/*` fall through to `{ type: 'public' }` (not in `RENTER_PATHS`/`BUSINESS_PATHS`). No middleware change needed for a new public route. |

**i18n** — `packages/web/messages/{en,ja,zh}.json`, namespace `search` (and `search.detail`). Existing keys: `title, subtitle, fromLabel, toLabel, submit, needDates, empty, fromDaily, fromHourly, noPrice, classCount, seats, auto, manual, viewStore, detail.*`. **No map/list keys yet.**

**Test infra (web):** `packages/web/vitest.config.ts`, `@testing-library/react` + `jest-dom` + `user-event` + `vitest` (jsdom). **No web storefront tests exist** today — slice 5 was tested at the API/service layer (`storefront-search.test.ts`, `storefront-detail.test.ts` use InMemory repos).

### 2.4 Architecture rules (must obey)
- Feature code under `src/modules/<feature>/`; single public barrel `index.ts` (R2); no cross-module internal imports (R3). Enforced by `bun run lint:modules` + `bun run lint:size` (R8: warn 400 / fail 800 LOC; R7: `page.tsx` ≤ 80 lines; R4: `routes.ts` ≤ 150).
- API import direction: routes → services → repositories. Routes never import repositories; services import repo *interfaces* (`types.ts`) only; concretes only in `index.ts`. Enforced by `bun run --filter @kuruma/api lint:boundaries`.
- Web has **NO direct DB access** — all reads go through the Hono API via the typed `hono/client`.
- No map library is a dependency anywhere (verified: grep of all `package.json` + `src/`). D1 (APPROVED) wires the map behind a `MapAdapter` **component contract** so the view never imports the library directly — see §3.4.

### 2.5 No existing flat-list path
Proposal §10 item 12 / §2 explicitly **rejected** a flat cross-operator vehicle list as the primary result. The scope-update §1.1 **reverses** that — both are now first-class. So there is no existing endpoint that returns a flat cross-operator *vehicle* list; today the only cross-operator read returns *storefront cards* (`/storefronts/search`).

---

## 3. Proposed Design

### 3.1 The result DTO — `SearchResultItem` (discriminated union, future-proof for CLASS_COMBO)

The whole point of #458's "shaped for both shapes" requirement. New shared type, additive only:

```ts
// packages/shared/src/types/search-result.ts  (NEW — pure type module, no runtime deps)
// Exposed via an EXPLICIT subpath export "./types/search-result" registered in
// packages/shared/package.json (matches the project convention: @kuruma/shared/types/stats,
// @kuruma/shared/types/location, etc.). Import it as `@kuruma/shared/types/search-result`,
// NOT from the `@kuruma/shared` root barrel (src/index.ts does not re-export type modules).

export type SearchResultKind = 'SPECIFIC' | 'CLASS_COMBO'   // mirrors #463 fulfillment_mode

/** Location identity + (eventually) map coordinates, embedded on every result row. */
export interface ResultLocation {
  locationId: string
  operatorId: string
  operatorName: string
  name: string
  address: string
  latitude: number | null   // real coords from locations.latitude (D2); nullable for not-yet-geocoded rows — map degrades gracefully
  longitude: number | null
}

interface SearchResultBase {
  kind: SearchResultKind
  location: ResultLocation
  dailyRateJpy: number | null
  hourlyRateJpy: number | null
  classLabel: string
  acrissCode: string | null
  seats: number
  photos: string[]
}

/** MVP-LITE: one physical car. Built now. */
export interface SpecificSearchResult extends SearchResultBase {
  kind: 'SPECIFIC'
  vehicleId: string          // stable per-car identity (renter-safe; not the plate string)
  name: string               // e.g. "Toyota Alphard"
  make: string | null
  model: string | null
  year: number | null
  transmission: 'AUTO' | 'MANUAL'
}

/** FAST-FOLLOW (#464): a class with inventory count, exact car assigned on pickup day.
 *  Declared now so the union is closed; NO producer is written for it in this slice. */
export interface ClassComboSearchResult extends SearchResultBase {
  kind: 'CLASS_COMBO'
  classId: string
  availableCount: number     // from the future inventory-count model
}

export type SearchResultItem = SpecificSearchResult | ClassComboSearchResult

export interface SearchResultsData {
  items: SearchResultItem[]
  nextCursor: string | null
}
```

**Why a discriminated union (not optional flag-bag):** the web renders rows by `switch (item.kind)`. When #464 lands, it adds a `case 'CLASS_COMBO'` and an API producer; existing `SPECIFIC` rendering and the DTO are untouched. (TS rule: discriminated unions for variants, not optional fields.)

### 3.2 API — extend the existing public read (prefer reuse; pure read)

**Decision: add a new endpoint, NOT a new availability model.** A new thin service reuses the *exact same* `AvailabilityRepository.findAvailableVehicles(from, to, filters)` scan that slice-5 already uses — no new DB query shape, no migration. The new service flattens the scan into `SpecificSearchResult[]` instead of grouping into store cards.

```
GET /search/vehicles              (NEW route, public, same rate-limit + 10s cache)
  query: from, to, pickupLocationId?, operatorId?, class?(repeatable), limit?, cursor?
  200 { success:true, data: { items: SearchResultItem[], nextCursor } }   // items all kind:'SPECIFIC' for now
  400 invalid range / invalid cursor
```

New service `FlatSearchService` (`packages/api/src/services/flat-search.ts`):
1. `availabilityRepo.findAvailableVehicles(from, to, { ...locationId?, ...operatorId? })` — same call slice 5 makes.
2. `storefrontRepo.findActiveStorefronts(ctx, ...)` → build `Map<locationId, ResultLocation>` (joins operator name; carries the real `latitude/longitude` columns added in D2 — `null` only for any not-yet-geocoded row). The `Storefront`/`Location` repo projection must add the two coordinate fields. **This step is schema-backed and therefore gated on Slice 0** — it reads `locations.latitude/longitude`, so it must be built *after* the `0039` migration exists (§5 sequencing rule). The availability *scan* in step 1 is coord-free; this projection step is not.
3. `classRepo.findAll(ctx, { includeArchived:true })` → `Map<classId, VehicleClass>` for `acrissCode`/`classLabel` (same enrichment as slice 5).
4. Drop vehicles with no `pickupLocationId` (no storefront → not mappable; same rule as `storefront-search.ts` L123-124).
5. Apply class filter (ACRISS), map each vehicle → `SpecificSearchResult`, sort by a **stable total order** (operatorName → locationName → vehicleId) so cursor paging is deterministic (mirrors `compareCards` L191-198).
6. Opaque base64 cursor over `vehicleId` (same `btoa`/`atob` pattern, malformed → 400, L200-211).

**Why a separate endpoint rather than reshaping `/storefronts/search`:** the two endpoints answer different questions (cards-per-store vs rows-per-car) and slice-5's flow depends on the card shape. Reusing the *repository* (not the *endpoint*) keeps DRY where it matters (one availability scan implementation) without breaking the coexisting flow. The new endpoint is a **pure read** — no writes, no new tables.

**Renter-safe projection preserved:** `FlatSearchService` whitelists the same columns as `AvailableVehicle` (no `licensePlate`, no operator internals). It builds the DTO from `Vehicle` + `VehicleClass` + `Storefront`, never the raw row.

### 3.3 Schema — add `latitude`/`longitude` to `locations` (D2, APPROVED)

Markers need real coordinates, so this slice adds two columns to `locations` (`packages/shared/src/db/schema.ts`, the `locations` table at L163-203):

```ts
// added to the locations pgTable column block:
latitude:  doublePrecision('latitude'),    // WGS84 decimal degrees, NULLABLE
longitude: doublePrecision('longitude'),   // WGS84 decimal degrees, NULLABLE
```

**Type + precision decision: `double precision` (Postgres `float8`), nullable, no default.**
- *Why `double precision` over `numeric(9,6)`:* lat/lng are consumed as JS `number` for map math (distance, fit-bounds) — a float column round-trips to `number` with no decimal-string parsing, and `double` gives ~15 significant digits (sub-millimetre), far beyond what storefront pin accuracy needs. `numeric` would force string handling in the DTO and buys precision we never use. (YAGNI: don't model money-grade exactness for a map pin.)
- *Why nullable, no default:* a location may exist before it is geocoded (operator just typed an address). `null` is the honest "not located yet" state the DTO and map already handle (`latitude === null` → list-only marker). A `0,0` default would put a pin in the Gulf of Guinea — worse than null. No backfill-default needed because the seed (below) sets real values and the column is additive/nullable, so the migration is safe on a populated table.
- *No CHECK constraint for MVP* (e.g. lat ∈ [-90,90]); validate at the API/form boundary with Zod instead (consistent with the rest of the schema, which leans on app-layer validation). Can add a CHECK in a later migration if bad data appears.

**Seed / backfill (required — markers need coords):** `packages/shared/src/db/seed.ts` `SEED_LOCATIONS` (L398-414) gains a `latitude`/`longitude` per row. The 3 seed storefronts have known Osaka addresses, so hard-code their coordinates:

| Store | Address | lat | lng |
|---|---|---|---|
| Namba Store | 2-10-70 Namba, Chuo, Osaka | `34.6627` | `135.5012` |
| Umeda Store | 3-1-1 Umeda, Kita, Osaka | `34.7025` | `135.4959` |
| Kansai Airport Counter | Senshu-kuko Naka, Tajiri | `34.4347` | `135.2441` |

(Values are storefront-block accurate — fine for pins; refine later if needed.) For any pre-existing non-seed location on the staging branch, leave `null` (degrades to list-only).

**Drizzle workflow (per project CLAUDE.md — run in this worktree, targeting the marketplace-pivot Neon STAGING branch, NEVER production):**
```bash
# 1. After editing schema.ts AND rebasing onto current origin/marketplace-pivot (see migration coordination below):
bun run db:generate --name add_location_coordinates       # emits the next migration (expected 0039_*)
# 2. Point a THROWAWAY worktree .env DATABASE_URL at the marketplace-pivot branch endpoint
#    (br-cool-shape-an5ksrvx) — NEVER copy root .env (that points at PRODUCTION). See the Neon-branches gotcha.
bun run db:migrate
bun run db:verify                                          # MUST show all green checks (schema-snapshot / journal-disk / journal-DB sync)
bun run db:seed                                            # repopulate coords on the staging branch
```
> Reminder (Neon-branches gotcha): `~/Dev/kuruma-rental/.env` → **production**. Marketplace work must use the marketplace-pivot branch endpoint written into a throwaway worktree `.env`. CI `db-drift` uses an ephemeral DB, so the PR does not depend on any persistent branch being migrated — but `db:verify` must be green locally before commit, and the staging branch should be migrated so manual demos work.

#### Migration coordination (FIRST blocking item — read before generating)

> **Migration-first.** Slice 0 is the FIRST step for anything schema-backed. The *availability scan itself* (`findAvailableVehicles`) is coord-free, but the read service builds `ResultLocation` with `latitude/longitude` from the `Storefront`/`Location` projection — so the service, the projection, the seed coords, and the markers all wait on this column and must come AFTER Slice 0. Only genuinely coord-free scaffolding (the shared type in Slice A; the `SearchResultRow`/toggle/i18n parts of Slice D) may precede it. See the §5 sequencing rule.

**Current state (verified 2026-06-06 on this worktree):**
- This branch (`feat/458-search-map-list`) is based on an **older `marketplace-pivot` tip** — its `drizzle/meta/_journal.json` ends at **`0035_locations_active_only_unique_name`** and the branch is **2 commits behind** `origin/marketplace-pivot`.
- **Slice 6 (#392) is now MERGED.** `origin/marketplace-pivot` already carries `0036_slice6_booking_events_additive`, `0037_booking_exclusion_assigned_vehicle`, `0038_slice6_drop_legacy_vehicle_buffer`. **Slice 6 has released the migration lock** it held while in flight (the situation in earlier drafts of this plan).

**The out-of-order `_journal.json` skip-bug (project gotcha — must avoid):** if a migration's `when` timestamp in `_journal.json` is older than the last-applied migration, `drizzle-kit migrate` treats it as already-applied and **silently skips it** while still printing "migrations applied successfully" — producing column drift that crashes the API. Generating #458's migration **now**, against the stale `0035` tip, would create a `0036_*` that collides with slice 6's merged `0036/0037/0038` and/or carries an out-of-order `when`.

**Ordering rules for #458 (do, in this order):**
1. **Rebase first.** `git fetch origin && git rebase origin/marketplace-pivot` so this branch's journal includes `0036/0037/0038`. Verify `bun run db:verify` is green on a staging-synced DB before touching the schema.
2. **Generate after rebase.** Only then run `db:generate --name add_location_coordinates`; it will produce **`0039_*`** with a `when` later than `0038`. Do not generate before the rebase.
3. **If you already generated before rebasing** (or a parallel migration lands first), reconcile per the gotcha: **renumber the file to the next free index and bump its `when` in `_journal.json` to `max(previous_when) + 1`**, or regenerate. Never edit an already-merged migration's SQL (it changes its applied hash).
4. **Do not merge until `db:verify` passes** locally against a DB in the same migration state as the staging branch (journal-count == applied-count is the real signal — never trust the `migrate` success line alone).
5. **Recovery if a skip occurs:** apply the skipped SQL manually (`ALTER TABLE locations ADD COLUMN IF NOT EXISTS latitude double precision; …`), then insert a matching row into `drizzle.__drizzle_migrations` with the file's SHA256 hash and a post-predecessor timestamp.

### 3.4 Map via a swappable adapter component (D1, APPROVED — DIP / ports-and-adapters, React-declarative)

The view depends on a **`MapAdapter` component contract** (a typed React component, defined by its props), never on a map library. pigeon-maps is **declarative** — you render `<Map>` with `<Marker>` children, there is no imperative mount/`renderMarkers()` surface — so the boundary is a *component type*, not an imperative interface. One concrete adapter component implements the contract; injection passes the concrete component; tests render a **fake `MapAdapter` component** and assert props-in → selection-out. Swapping libraries later means providing a different component implementing the same props — zero changes to `SearchMapList`/`SearchMap`.

**The contract (the props the view passes in, the one callback it gets back — KISS):**
```ts
// packages/web/src/modules/search/map/MapAdapter.ts  (NEW — no library import here; the contract type only)
import type { ComponentType } from 'react'
import type { SearchResultItem } from '@kuruma/shared/types/search-result'   // type-only, explicit subpath

export interface MapAdapterProps {
  /** Rows to plot. The adapter dedups by locationId and SKIPS items whose
   *  location.latitude===null (those render list-only — graceful degrade). */
  items: SearchResultItem[]
  /** Currently selected result (locationId), to highlight its marker; null = none. */
  selectedId: string | null
  /** Fired when a marker is clicked, with the selected location's id. */
  onSelect: (selectedId: string) => void
}

/** Everything the map view needs from a map library, expressed as a React component
 *  type. Any library = a component implementing exactly these props. */
export type MapAdapter = ComponentType<MapAdapterProps>
```

**The concrete adapter component (start from the lightest declarative library that covers this):**
```tsx
// packages/web/src/modules/search/map/PigeonMapAdapter.tsx  (NEW — the ONLY file that imports the lib)
// Starting concrete: pigeon-maps (zero-dep, tiny, SSR-safe raster tiles).
// 'use client'. Renders <Map> with one <Marker> child per geocoded location and
// wires each marker's onClick → props.onSelect. Implements MapAdapter; the rest
// of the module imports ONLY the MapAdapter contract type.
```
- **Starting concrete = `pigeon-maps`** (suggested): zero-dependency, tiny, React component API (`<Map>`/`<Marker>`), works as a client-only `dynamic(..., {ssr:false})` import on CF Pages. It covers the whole contract (plot markers from `SearchResultItem[]`, marker-click → `onSelect`, fit/center via `<Map>`'s `center`/`zoom`/`bounds` props). Added to `packages/web` only and imported in **exactly one file** (`PigeonMapAdapter.tsx`). If pigeon-maps proves limiting (e.g. vector styling), write a `MapLibreAdapter.tsx` component implementing the same `MapAdapterProps` and re-point injection — the view doesn't change.
- **Injection:** `SearchMapList` receives the `MapAdapter` component (or a factory `() => MapAdapter`) as a prop / via a small provider; the app composition passes `PigeonMapAdapter`. Tests pass a **fake `MapAdapter` component** that renders one test-id'd button per `items` row and calls `onSelect(id)` on click — asserting the seam without any library (see Slice E).

**Why DIP here:** the high-level map view (policy: "show markers for results, select on click") must not depend on a low-level library detail (pigeon-maps' `<Marker>` API). Both depend on the `MapAdapter` component abstraction; the library is an implementation detail behind that component. This is the **Dependency Inversion Principle**, expressed the React-idiomatic way — a *component-type* contract rather than an imperative interface — which is what makes the library swappable and the view testable with a fake component, no real tiles in jsdom.

### 3.5 Web — map + list layout, coexisting via a view toggle

**Route:** keep `/search` as the entry. Add a **view toggle** (segmented control) with two modes:
- **Stores** (default — the slice-5 `StorefrontCard` grid, unchanged).
- **Map** (new — map pane + flat list).

Toggle state lives in the URL (`?view=map|stores`) so it is shareable/bookmarkable and survives a server round-trip (the search page is a server component). This is the "room to switch" the issue asks for; default stays storefront-first so slice 5 remains the primary flow.

**Layout (Map view):**
```
┌──────────────────────────────────────────────┐
│  StorefrontSearchForm (shared)   [Stores|Map] │  ← view toggle
├───────────────┬──────────────────────────────┤
│  flat list     │                              │
│  (scrollable)  │            map pane          │
│  SearchResult  │    (markers per location,    │
│  Row × N       │     click marker ↔ highlight │
│  ↕ scroll      │     list row)                │
└───────────────┴──────────────────────────────┘
  mobile: list on top, map collapses to a toggle/sheet
```

**New web module** `packages/web/src/modules/search/` (separate from `storefronts` to respect R3 — but it MAY import the storefront barrel `@/modules/storefronts` for the shared `StorefrontSearchForm`/`parseSearchRange`, which is an allowed public-surface import):
- `api.ts` — `fetchSearchResults(params)` typed `hono/client` call to `/search/vehicles`; JSON DTO mirror of `SearchResultsData`.
- `components/SearchViewToggle.tsx` — segmented `Stores | Map` control (Link-based, `aria-current` per the hydration-trap gotcha — no client active-class).
- `components/SearchResultRow.tsx` — one flat-list row; `switch(item.kind)` renders `SPECIFIC` now (card with name, class badge, seats, transmission, price, disabled "select").
- `components/SearchMapList.tsx` — client component: two-pane layout, holds `selectedId` state, syncs marker ↔ row. **Depends on the `MapAdapter` component contract only (D1)** — receives the adapter component via prop/provider, never imports a map library.
- `components/SearchMap.tsx` — client-only map host (dynamic import, `ssr:false`) that renders the injected `MapAdapter` component, passing `items`/`selectedId`/`onSelect`. Dedup rows by `locationId`; rows with `latitude == null` are list-only (the adapter skips them — graceful degrade).
- `map/MapAdapter.ts` — the `MapAdapter` component-type contract + `MapAdapterProps` (D1, no library import).
- `map/PigeonMapAdapter.tsx` — the ONE concrete adapter component implementing `MapAdapter` (the only file importing the map library; D1).
- `index.ts` — barrel.

**Page wiring:** `search/page.tsx` reads `?view`; when `view==='map'` it calls `fetchSearchResults` and renders `<SearchMapList>`, else the existing card grid. Keep `page.tsx` ≤ 80 lines (R7) — push branching into a small server helper or two thin sub-renders.

**i18n:** add `search.view.stores`, `search.view.map`, `search.list.heading`, `search.map.noCoordinates` (and reuse `seats/auto/manual/fromDaily/...`). Add to all three locale files (en/ja/zh) — i18n-parity CI gate requires identical key sets. Restart dev server after adding a namespace key (gotcha).

**Constraints honored:** no `asChild` (use `buttonVariants()` on `<Link>` for the toggle); `Link`/`useRouter` from `@/i18n/routing`; `aria-current="page"` + Tailwind `aria-[current=page]:*` for the active toggle (hydration-trap gotcha); the concrete map adapter component is `'use client'` + loaded via `dynamic(..., {ssr:false})` (the library touches `window`) — and it's behind the `MapAdapter` component contract (D1) so the view component itself stays library-agnostic and unit-testable.

---

## 4. Files to create / modify

### shared (`packages/shared`)
| File | Create/Modify | Purpose |
|---|---|---|
| `src/types/search-result.ts` | **create** | `SearchResultItem` discriminated union (`SPECIFIC` now, `CLASS_COMBO` declared), `ResultLocation`, `SearchResultsData`. Pure types, no runtime deps. |
| `package.json` (shared) | modify | **Register the export.** Add `"./types/search-result": "./src/types/search-result.ts"` to the `exports` map (no `types/index.ts` barrel exists — the package uses explicit per-module subpaths, e.g. `./types/stats`, `./types/location`). Consumers import via `@kuruma/shared/types/search-result`. |
| `src/db/schema.ts` | modify (**D2**) | add `latitude`/`longitude` (`doublePrecision`, nullable) to the `locations` table. |
| `drizzle/0039_add_location_coordinates.sql` (+ `meta/_journal.json`) | **generated** (**D2**) | `db:generate --name add_location_coordinates` **after rebasing onto current `origin/marketplace-pivot`** (expected index `0039`, `when` > 0038). Never hand-write; see §3.3 coordination rules. |
| `src/db/seed.ts` | modify (**D2**) | add lat/lng to the 3 `SEED_LOCATIONS` rows (coords in §3.3). |

### api (`packages/api`)
| File | Create/Modify | Purpose |
|---|---|---|
| `src/services/flat-search.ts` | **create** | `FlatSearchService.search(ctx, params)` → `SearchResultsData` (all `SPECIFIC`); reuses `findAvailableVehicles`. |
| `src/services/flat-search.test.ts` | **create** | Service unit tests (InMemory repos), mirroring `storefront-search.test.ts`. |
| `src/routes/search.ts` | **create** | `createFlatSearchRoutes(flatSearchService, publicCatalogLimiter)` → `GET /search/vehicles`; reuse `parseDateRange/parseLimit/ok/fail/cachePublic` helpers. ≤150 lines (R4). |
| `src/index.ts` | modify | construct `FlatSearchService` + mount `createFlatSearchRoutes` in the `.route('/', ...)` chain (concretes only here). |
| `src/stores.ts` + `src/repositories/*` (Drizzle + InMemory storefront/location projection) | modify (**D2**) | add `latitude`/`longitude` to the `Location`/`Storefront` projection so `ResultLocation` carries real coords. |
| `tests/routes/flat-search.*.test.ts` (match existing route-test convention) | **create** | Integration test of the endpoint contract (params, 400s, projection). |

### web (`packages/web`)
| File | Create/Modify | Purpose |
|---|---|---|
| `src/modules/search/api.ts` | **create** | `fetchSearchResults(params)` typed client call; JSON DTO mirror. |
| `src/modules/search/components/SearchViewToggle.tsx` | **create** | `Stores | Map` URL-driven segmented control. |
| `src/modules/search/components/SearchResultRow.tsx` | **create** | Flat-list row, `switch(kind)` (SPECIFIC now). |
| `src/modules/search/components/SearchMapList.tsx` | **create** | Two-pane map+list client component + selection sync; depends on the `MapAdapter` **component contract** only (D1). |
| `src/modules/search/components/SearchMap.tsx` | **create** | Client-only map host (dynamic, `ssr:false`) that renders the injected `MapAdapter` component. |
| `src/modules/search/map/MapAdapter.ts` | **create** (**D1**) | `MapAdapter` component-type contract + `MapAdapterProps`. No library import. |
| `src/modules/search/map/PigeonMapAdapter.tsx` | **create** (**D1**) | The ONE concrete adapter component implementing `MapAdapter` (only file importing the map lib). |
| `src/modules/search/components/index.ts` | **create** | components barrel. |
| `src/modules/search/index.ts` | **create** | module public barrel (R2). |
| `src/app/[locale]/search/page.tsx` | modify | read `?view`; branch to map view vs existing card grid (keep ≤80 lines); inject the concrete renderer. |
| `src/modules/search/__tests__/*.test.tsx` | **create** | RTL tests for toggle + row + map-list; map tests render a **fake `MapAdapter` component** (assert props-in → `onSelect`-out, not library internals). |
| `messages/en.json`, `ja.json`, `zh.json` | modify | add `search.view.*`, `search.list.*`, `search.map.*` keys (parity across all three). |
| `package.json` (web) | modify (**D1 — APPROVED**) | add `pigeon-maps` (starting concrete). Imported only in `PigeonMapAdapter.tsx`. |

---

## 5. TDD Vertical-Slice Breakdown (RED → GREEN, each shippable)

Each slice ends with something demoable. Strict one-test-then-impl. Run API tests with `bun run --filter @kuruma/api test` (vitest, deterministic); web with `bun run --filter @kuruma/web test`.

> **Sequencing rule — migration-first (do not violate):** **Slice 0 is the TRUE first step for anything that touches a schema-backed projection.** The mandatory order is **0 → A → B → C → D → E → F**, sequential. The reason: `ResultLocation` carries `latitude/longitude` (§3.1), and Slice B's service + the `Storefront`/`Location` projection it reads (§3.2 step 2, §4 api `stores.ts`/repos row) populate those fields — that work is **coord-dependent and must come after Slice 0** (rebase onto `origin/marketplace-pivot`, which carries `0036–0038`, then generate the lat/lng migration as **`0039`**; see §3.3). Building the projection before the column exists would mean coding against a field that isn't in the schema and would fail Slice 0's own RED test (which asserts the projection carries numeric `latitude`/`longitude`).
>
> **The only genuinely coord-free work that may precede Slice 0** (purely additive scaffolding that never reads/writes a coordinate field):
> - **Slice A** — the shared `SearchResultItem`/`ResultLocation` *type* declaration + its subpath export. (Declaring the `latitude/longitude` *fields on the type* is fine; it is a contract, not a schema-backed projection.)
> - **Web rendering that ignores coords:** `SearchResultRow`, `SearchViewToggle`, i18n keys (parts of Slice D) — none of these read a coordinate.
>
> Everything that reads/writes `latitude/longitude` against the DB — the Slice B service, the `Storefront`/`Location` projection, the seed coords, and the Slice E markers — is **forbidden from preceding Slice 0** and must not touch the schema-backed projection until `0039` is generated and `db:verify` is green.

### Slice 0 — locations lat/lng migration (D2; FIRST blocking item)
- **Pre-req:** `git fetch origin && git rebase origin/marketplace-pivot` so the journal includes slice 6's `0036/0037/0038` (§3.3 coordination). Confirm `bun run db:verify` green on a staging-synced DB **before** editing schema.
- **RED:** add a shared schema/type test (or extend `flat-search.test.ts`) asserting a `Location`/`ResultLocation` literal carries numeric `latitude`/`longitude` (and accepts `null`). Fails until the columns + projection exist.
- **GREEN:** add `latitude`/`longitude` (`doublePrecision`, nullable) to `locations`; `db:generate --name add_location_coordinates` (→ `0039`); `db:migrate` + `db:verify` (all green) against the **marketplace-pivot staging branch** (throwaway worktree `.env`, NEVER root `.env`/production); add coords to the 3 `SEED_LOCATIONS` rows; `db:seed`.
- **Ship:** the schema + seed that make real markers possible. `db:verify` green is the gate — never trust the `migrate` success line alone (skip-bug gotcha).

### Slice A — shared DTO (type-only, compile-checked)
- **RED:** add `src/types/search-result.ts`; write a `flat-search.test.ts` (or a tiny type test) asserting a `SpecificSearchResult` literal is assignable to `SearchResultItem` and that a `kind:'CLASS_COMBO'` literal also type-checks (proves the union is closed/extensible). Fails to compile until the type exists.
- **GREEN:** define the union **and register the subpath export** `"./types/search-result"` in `packages/shared/package.json` so api/web can import it as `@kuruma/shared/types/search-result`. `bun run --filter @kuruma/shared typecheck` passes; a throwaway `import type { SearchResultItem } from '@kuruma/shared/types/search-result'` resolves from both api and web.
- **Ship:** the contract both layers build against, reachable via its explicit subpath.

### Slice B — API service flattens availability → SPECIFIC items
- **Pre-req:** Slice 0 landed. This service builds `ResultLocation` with `latitude/longitude` from the `Storefront`/`Location` projection (§3.2 step 2), which is schema-backed — do not start it until the `0039` column exists (§5 sequencing rule).
- **RED:** `flat-search.test.ts`: seed InMemory repos (2 operators, 2 locations **with `latitude/longitude` set**, 3 available vehicles, 1 in MAINTENANCE, 1 with `pickupLocationId=null`). Assert each item's `location` carries the seeded coords. Assert `search()` returns **exactly** the 3 mappable available vehicles as `items`, each `kind:'SPECIFIC'`, with `location.operatorName` joined, `acrissCode`/`classLabel` from the class map, and the MAINTENANCE + null-location cars **absent**. Assert sort order is `[operatorName, locationName, vehicleId]`. Assert **no `licensePlate`** field is present on any item.
- **GREEN:** implement `FlatSearchService`.
- **RED:** class-filter test — passing `classes:['ECMR']` returns only matching-ACRISS items.
- **GREEN:** filter.
- **RED:** cursor test — `limit:2` returns 2 items + a `nextCursor`; passing it returns the rest with `nextCursor:null`; a malformed cursor → `{ ok:false, status:400 }`.
- **GREEN:** paging + cursor decode guard.
- **Ship:** working service behind DI.

### Slice C — API route contract
- **RED:** route test (InMemory app build): `GET /search/vehicles?from=&to=` returns `200 { success:true, data:{ items, nextCursor } }`; missing/invalid range → 400 with the standard error envelope; assert the response items carry `kind:'SPECIFIC'` and **no operator-internal fields**. Assert `Cache-Control` header set (cachePublic) and the route is reachable **without auth**.
- **GREEN:** add `createFlatSearchRoutes`, wire in `index.ts`. `lint:boundaries` passes.
- **Ship:** a curlable public endpoint.

### Slice D — Web flat list (no map yet)
- **RED:** RTL test for `SearchResultRow`: given a `SpecificSearchResult`, renders name, class label, `seats` (`{count} seats`), transmission label, price (`fromDaily`/`fromHourly`/`noPrice` branch), and a **disabled** select button. Mutation-resistant: assert exact text + `toBeDisabled()`, not truthiness.
- **GREEN:** `SearchResultRow`.
- **RED:** RTL test for `SearchViewToggle`: renders two links; `view=map` marks the Map link `aria-current="page"` and Stores not. Assert via `getByRole('link', {current:'page'})`.
- **GREEN:** `SearchViewToggle`.
- **RED:** page-level test (or integration): with `?view=map`, the page renders the flat list of rows from a mocked `fetchSearchResults`; with no `view`/`view=stores`, it renders the existing `StorefrontCard` grid (slice-5 path untouched).
- **GREEN:** branch in `search/page.tsx`; add i18n keys (all 3 locales).
- **Ship:** working flat-list view, toggle works, slice-5 flow intact. **Demoable even before the map renders.**

### Slice E — Web map pane (via the `MapAdapter` component contract, D1)
- **RED (component seam, not the library):** RTL test for `SearchMapList` injected with a **fake `MapAdapter` component** (a test double that renders one `data-testid` button per `items` row and calls `props.onSelect(id)` on click — NOT pigeon-maps). Given items across 2 locations (one with coords, one with `latitude:null`): assert the fake adapter received `items` containing exactly the **1** geocoded location (the `null`-coord one is excluded — list-only), and 2 list rows render. Then click the fake adapter's marker button and assert the matching list row gets the selected state (`aria-selected`/highlight class), and that `selectedId` flows back into the fake adapter's props. Assertions target the `MapAdapterProps` contract, **never** pigeon-maps internals.
- **GREEN:** define `map/MapAdapter.ts` (`MapAdapter` component-type + `MapAdapterProps`), implement `SearchMapList` against the contract + selection sync, and `SearchMap` (dynamic `ssr:false` host) that renders the injected adapter component.
- **RED (adapter):** a focused test for `PigeonMapAdapter` asserting it conforms to `MapAdapterProps` and renders one pigeon-maps `<Marker>` per geocoded location, with each marker's `onClick` wired to call `props.onSelect` with the right id. (Real tile rendering is not asserted — only the adapter's mapping of props → `<Marker>` components.)
- **GREEN:** implement `PigeonMapAdapter.tsx` (the only file importing `pigeon-maps`); wire it as the concrete component in the page composition.
- **Ship:** full map + list view, library swappable behind the port.

### Slice F — polish + parity + migration gates
- i18n parity across en/ja/zh (CI `i18n-parity`); `lint:size`/`lint:modules`/`lint:boundaries` green; full `bun run lint` + `bun run test`.
- **Migration gates (new because of D2):** `bun run db:verify` shows all green checks locally; the CI `db-drift` job passes (ephemeral DB, so no persistent branch needed for the PR). Confirm the generated migration is `0039` with a `when` later than `0038` (no out-of-order skip — §3.3). Re-run `db:seed` on the staging branch so the manual demo has pins.
- (E2E happy-path can be a fast-follow under #390's E2E lane — not required to ship this slice.)

---

## 6. Risks / Decisions

> **D1, D2, D3 are DECIDED (approved 2026-06-06)** — captured below for the record and reflected in §3–§5. D4–D6 are residual risks/notes, not blockers.

**D1 — Map library → swappable behind a component contract (DECIDED, APPROVED).** Design the map so the view depends on a `MapAdapter` **React component contract** (props: `items`, `selectedId`, `onSelect`), never a library (DIP / ports-and-adapters, React-declarative — see §3.4). pigeon-maps is declarative (`<Map>`/`<Marker>` children, no imperative mount), so the boundary is a component type, not an imperative interface. One concrete adapter component implements the contract; injection passes the component; tests render a fake `MapAdapter` component and assert props-in → `onSelect`-out.
- **Starting concrete: `pigeon-maps`** (zero-dependency, tiny, React component API, SSR-safe raster tiles) — the lightest library that covers the contract (plot markers from `SearchResultItem[]`, marker-click → `onSelect`, fit/center via `<Map>` props). Added to `packages/web` only and imported in **exactly one file** (`PigeonMapAdapter.tsx`), rendered via `dynamic(..., {ssr:false})`.
- **Swap path:** if pigeon-maps proves limiting (e.g. vector styling), write a `MapLibreAdapter.tsx` (MapLibre GL JS) component implementing the same `MapAdapterProps` and re-point injection — `SearchMapList`/`SearchMap` are untouched. The whole point is the view never imports the library directly.

**D2 — Location coordinates → ADD lat/lng migration now (DECIDED, APPROVED).** `locations` gains `latitude`/`longitude` (`double precision`, nullable, no default) in this slice; seed/backfill populate the 3 known storefronts; the DTO/markers carry real coords (`null` → list-only fallback). Full schema + drizzle workflow (targeting the marketplace-pivot Neon **staging** branch, never production) + the **migration-coordination rules** are in **§3.3** — this is the FIRST step for any schema-backed projection (Slice 0), and the mandatory order is sequential 0 → A → … → F (§5 sequencing rule). Only coord-free scaffolding (the shared type, the flat-list row/toggle/i18n) may precede it; the coordinate-carrying projection (Slice B service + `Storefront`/`Location` repos), seed coords, and markers (Slice E) must come after Slice 0. *(Type/precision/nullability rationale: §3.3.)*

**D3 — "identified by plate" vs renter-safe projection (DECIDED, APPROVED — withhold the plate).** Do **NOT** expose the raw `licensePlate` string to anonymous renters. The slice-5 `AvailableVehicle` projection already omits it; each result row is one *physical car* with a stable `vehicleId`, and that per-car granularity *is* the "specific vehicle" the issue asks for. The plate is operator-side identity with no renter value (and a needless data exposure). `vehicleId` satisfies the requirement; the plate string stays server-side.

**D4 — Paging strategy / perf.** Both slice-5 services and this new one do **in-memory** sort + slice over a full availability scan per page (see `storefront-search.ts` L96-111). At 40-50 cars this is fine; it does not scale to thousands. This is the **same** limitation tracked in **#439** (DB-seek pagination). #458 follows the existing pattern; do not fix #439 here. Cross-referenced.

**D5 — Caching of a personalized view.** The endpoint is anonymous and date-param-keyed, so the same 10s public edge cache (`cachePublic`) as slice 5 is safe. No per-user data. (Confirmed: no auth, no cookies read.)

**D6 — Module boundary for the shared form.** The new `search` module reuses `StorefrontSearchForm` + `parseSearchRange` from `@/modules/storefronts`. That is an allowed **public-barrel** import (R2), not a cross-internal import (R3). If review prefers zero cross-module coupling, lift the form into `src/components/` or a shared `src/modules/search` form — flagging as a minor design choice.

---

## 7. Acceptance Criteria → Plan Mapping

| Issue acceptance criterion | Where satisfied |
|---|---|
| New renter result: **map + list of specific vehicles** (with plate) across all operators/locations for the search params | §3.2 `GET /search/vehicles` (cross-operator, all `SPECIFIC`) + §3.5 map+list view, markers from real coords (D2). "Specific vehicle" satisfied by per-car `vehicleId` (D3 — DECIDED: plate string withheld from renters). |
| Storefront-first flow (slice 5) **remains; both first-class** ("room to switch") | §3.5 URL `?view` toggle; default stays `stores`; `search/page.tsx` only *adds* a branch; storefront module untouched. |
| Search read-models **shaped to support both shapes** without rework | §3.1 `SearchResultItem` discriminated union with `CLASS_COMBO` member declared (no producer); maps to #463 `fulfillment_mode`. |
| MVP shows **specific vehicles only**; class-combo is a separate fast-follow | §1 non-goals; only `SpecificSearchResult` is produced; #464 explicitly out. |
| **Reuse slice-5 availability data/API** | §3.2 reuses `AvailabilityRepository.findAvailableVehicles` (same scan); no new availability model. The one additive migration (D2) only adds `locations.latitude/longitude` for markers. |
| Map shows real pins | §3.3 D2 migration + seed coords; §3.4 `MapAdapter` component renders markers; `null` coords degrade to list-only. |
| Reverses proposal §2/§10.12 (flat search now first-class) | §2.5 documents the reversal; §1.1 of scope-update is the authority. |
