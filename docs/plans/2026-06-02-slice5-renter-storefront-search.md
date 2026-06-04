# Slice 5 — Renter Storefront Search (issue #391)

**Date:** 2026-06-02
**Status:** Draft v1 — awaiting review/green-light before issue kickoff
**Parent epic:** #385
**Source of truth:** `docs/plans/2026-05-25-marketplace-mvp-proposal.md` — §2 (Search result shape, Availability query, Turnaround buffer), §4 renter portal items 1–3, §6 row 5, §6.1 (E2E gate), §6.2 (tenant scoping — RENTER has no operatorId), §9 items 20/21, §10 items 10/12/13.
**Locked decision (epic #385 body):** *Renter search is storefront-first.* §10 item 12: "storefront cards first, storefront vehicle detail second… flat all-vehicle search is rejected for MVP because it hides the operator/location choice."

This slice is a **read-path** slice. It ships **zero booking writes** (booking = slice 6) and, ideally, **zero new tables** — only two new read endpoints, their repository reads, the renter search UI, and (likely) one or two covering indexes. It is the first **renter-facing** slice, so it is the **first slice that requires a Playwright E2E happy path** (§6.1).

---

## 0. Decision: one slice, two read models (no sub-split)

Unlike slice 4 (three independent entity CRUDs), slice 5 is a single cohesive read feature: a search list and its drill-down detail, both backed by the **same availability computation**. There is nothing to parallelize across worktrees. It ships as **one PR on `feature/391-renter-storefront-search`**.

The two read models (§9 item 21, §10 item 12):

| Read model | Endpoint | Returns |
|---|---|---|
| **Storefront search** | `GET /storefronts/search` | Location/storefront cards across all operators, each with `classSummaries[]` (per-ACRISS-class available count), `fromDailyPriceJpy`, and fallback `fromHourlyPriceJpy` |
| **Storefront detail** | `GET /storefronts/:locationId/vehicles` | The available **individual** vehicles at that storefront for the selected date range, grouped/filterable by class |

**Hard boundary (§10 item 12):** the primary search result is **store cards, never a flat cross-operator vehicle list**. The flat list only ever appears *inside* one storefront's detail.

---

## 1. Preconditions (MUST hold before kickoff)

| Precondition | Why | Status 2026-06-02 |
|---|---|---|
| **Slice 2 (#387 locations) merged to `marketplace-pivot`** | The store card IS a `locations` row. Search reads `locations` (name, address, `operatingHours`, `defaultTurnaroundMinutes`) and joins `vehicles.pickupLocationId → locations.id`. Without it there is no storefront entity to return. | In review (PR #414 → `marketplace-pivot`; locations table + `vehicles.pickupLocationId` composite FK present on that branch, not yet on pivot) |
| **Slice 3 (#388 ACRISS + vehicle CRUD) merged** | `classSummaries` group by ACRISS class; the card shows "Compact x4, Minivan x2". Requires `vehicle_classes.acriss_code` + i18n class labels. The current `marketplace-pivot` `vehicle_classes` has **no `acrissCode` column yet** — slice 3 adds it. | Not started |
| **Slice 4 (#389a/b/c pricing) merged** | Card pricing is computed from `vehicles.dailyRateJpy` / `vehicles.hourlyRateJpy`. §10 item 11 + §5.1: pricing is **vehicle-level only**; slice 4c drops `vehicle_classes.dailyRateJpy`. Slice 5 must read price from `vehicles`, never from the class. | Not started (4a/4b drafted in `2026-06-02-slice4-*`; 4c trails #388) |

`operators`, `locations`, `vehicles.operatorId` + `vehicles.pickupLocationId` (composite FK to `locations`), `vehicle_classes.acriss_code`, `vehicles.dailyRateJpy`/`hourlyRateJpy`, the `bookings` exclusion semantics on `effectiveEndAt`, and `CallerContext` (with `PUBLIC_CONTEXT`, `operatorReadScope`, `bypassScope`) from `packages/api/src/middleware/auth.ts` are all assumed present from slices 1–4.

**If slices 2–4 are not all merged at kickoff,** do not stub their schema — block on them. Slice 5 is genuinely downstream; building against placeholder columns bakes in rework.

---

## 2. The reuse target — DO NOT reinvent availability

The availability computation already exists and already honours the exclusion/turnaround model. Slice 5 **extends its reach to a storefront**, it does not re-derive overlap logic.

### What exists today (cite, reuse)

- **`DrizzleAvailabilityRepository.findAvailableVehicles(from, to)`** — `packages/api/src/repositories/drizzle/availability.ts:10`. Selects `vehicles` where `status='AVAILABLE'` AND `NOT EXISTS` an overlapping `CONFIRMED`/`ACTIVE` booking via `tstzrange(b."startAt", b."effectiveEndAt") && tstzrange(from, to)`. **This is the canonical overlap predicate** (#317). `effectiveEndAt = endAt + turnaround` is already materialized on the booking row, so the turnaround buffer (§2 / §9 item 20) is honoured by reusing this predicate — slice 5 adds **no new range math**.
- **`VehicleClassAvailabilityService.getAvailabilityForClass(slug, from, to)`** — `packages/api/src/services/vehicle-class-availability.ts`. Already computes `{ totalCars, availableCars, sampleAvailableVehicleIds }` per class by intersecting `findAvailableVehicles` with the class membership (#317). The `classSummaries` aggregation in slice 5 is the **same intersection, grouped by `(locationId, classId)` instead of one class**.
- **`GET /vehicle-classes/:slug/availability`** route + `cachePublic(c, 10)` — `packages/api/src/routes/vehicle-classes.ts:54`. The 10s edge-cache pattern for time-sensitive availability and the public-catalog per-IP rate limiter (`publicCatalogLimiter`, lines 25–30) are reused verbatim for the new search routes.
- **`parseDateRange(c, true)`** + `parsePagination`/`parseLimit` — `packages/api/src/routes/helpers.ts`. Date-range parse (both/one/neither, `to>from`, ISO validation) and cursor/offset parsing are done; reuse, do not duplicate.
- **`PUBLIC_CONTEXT`** — `auth.ts`: `{ userId:'public', role:'RENTER', bypassScope:false }`. The sanctioned caller context for anonymous renter reads. `operatorReadScope(PUBLIC_CONTEXT)` resolves to `{kind:'all'}` (cross-operator marketplace is the point), **without** granting a privilege bypass.

### The one real gap

`AvailabilityRepository.findAvailableVehicles(from, to)` (`repositories/types.ts:181`) takes **no location/operator filter** — it scans the whole fleet. Slice 5 needs availability **scoped to a storefront** and **grouped by class**. Two options, pick the cheaper:

- **(A, preferred)** Add `locationId?: string` (and keep `operatorId` derivable via the join) as an optional filter arg: `findAvailableVehicles(from, to, filters?: { locationId?: string; operatorId?: string; classId?: string })`. Backward-compatible (existing callers pass no filter). The class catalog endpoint keeps working unchanged.
- (B) Add a dedicated `findAvailableVehiclesByLocation(...)` method. More surface, no benefit over (A).

Go with **(A)**. It is additive to the interface; the InMemory + Drizzle impls both gain the optional predicate; no existing caller changes.

> **Learn: Open/Closed via optional filter arg.** Extending `findAvailableVehicles` with an optional, defaulted filter adds the new storefront-scoped behaviour without editing any existing call site — adding feature N didn't force a rewrite of feature N-1. Heuristic: when a query needs one more axis, add a defaulted filter param, not a parallel method.

---

## 3. Read model 1 — Storefront search

### Endpoint

`GET /storefronts/search` — **public, no auth** (registered before `requireAuth`, behind `publicCatalogLimiter` + `cachePublic(c, 10)`).

Query params (parsed via `parseDateRange(c, true)` + bespoke parse for the rest):

| Param | Required | Notes |
|---|---|---|
| `from`, `to` | **yes** | Pickup/return datetime (ISO, JST per existing `parseDateRange`). `to>from` enforced. |
| `pickupLocationId` | no | If present, narrows to that one storefront (degenerate single-card search). |
| `class` (ACRISS code, repeatable) | no | Filter to stores that have ≥1 available vehicle in any listed class; the card's `classSummaries` is filtered to the requested classes. |
| `limit`, `cursor` | no | Cursor pagination (§3.3). Default 25, max 50. |

§4 item 1 lists "pickup location + return location" — MVP UX defaults pickup=return (proposal §2 Locations: "MVP UX defaults equal"); **dropoff filtering does not ship here** (one-way rental is post-MVP, §2). The search form may show a locked return location mirroring pickup, but slice 5 filters on `pickupLocationId` only.

### Response shape

```jsonc
{
  "success": true,
  "data": {
    "storefronts": [
      {
        "locationId": "loc_...",
        "operatorId": "op_...",
        "operatorName": "Best Car Rental",
        "name": "Best Car Rental Osaka — Namba",
        "address": "…",
        "operatingHours": { "openTime": "09:00", "closeTime": "20:00" } | null,
        "classSummaries": [
          { "acrissCode": "CCAR", "label": "Compact", "availableCount": 4 },
          { "acrissCode": "MVAR", "label": "Minivan", "availableCount": 2 }
        ],
        "fromDailyPriceJpy": 4500,
        "fromHourlyPriceJpy": 800,
        "representativePhotos": ["…"]   // up to N from available vehicles' photos
      }
    ],
    "nextCursor": "…" | null
  }
}
```

The demo target string — "Best Car Rental Osaka — Compact x4, Minivan x2, from ¥4,500/day" (§6 row 5) — renders directly from `name` + `classSummaries` + `fromDailyPriceJpy`.

### Aggregation logic (`StorefrontSearchService`)

For the date range `[from, to)`:

1. Resolve candidate `locations` (status `ACTIVE`) across all operators (or the single `pickupLocationId`), honouring `operatorReadScope(PUBLIC_CONTEXT) = {kind:'all'}`.
2. Compute the set of **available vehicles** via the extended `findAvailableVehicles(from, to, { locationId })` — already filters `status='AVAILABLE'` + no overlapping `CONFIRMED`/`ACTIVE` booking on `effectiveEndAt` (turnaround included). One query per result page, **not** per location (avoid N+1, §8).
3. Group available vehicles by `(pickupLocationId, classId)` → `availableCount`; join `vehicle_classes` for `acrissCode` + label.
4. `fromDailyPriceJpy = min(vehicle.dailyRateJpy)` over available daily-priced vehicles and `fromHourlyPriceJpy = min(vehicle.hourlyRateJpy)` over available hourly-priced vehicles. Prefer daily in UI; if no daily price exists, render the hourly fallback. **Never** read class pricing — it's dropped in 4c.
5. **Drop stores with zero available vehicles** from the result (an empty store is not a useful card).
6. Apply `class` filter: keep stores with ≥1 available vehicle in a requested class; trim `classSummaries` to requested classes.

> **Learn: Batch the availability scan (N+1 guard).** Computing availability once over all candidate vehicles and grouping in memory — instead of calling `getAvailabilityForClass` per (store × class) — keeps it to ~1 DB round trip per page. The per-class service is fine for one class detail page; looping it across a search result is the N+1 trap. Heuristic: a search list aggregates with one scan + in-memory group-by, never a query per row.

### ACRISS label i18n

`classSummaries[].label` is the **localized** class label. Resolution mirrors the existing class catalog: the API returns the `acrissCode` + raw class `name`; the **web layer** localizes via the `catalog`/ACRISS i18n namespace (server-rendered with `getTranslations`). The API stays locale-agnostic (operator-entered names are single-language per §9 item 4). Decide at impl time whether to send `label` pre-localized (requires `Accept-Language` plumb-through) or send `acrissCode` and localize in web — **default to localize-in-web** (no new API i18n surface).

### 3.3 Pagination

Cursor over `(locationId)` ordered by a stable key (e.g. `operatorName, name, locationId`). Reuse `parseLimit`. The cursor encodes the last `(sortKey, locationId)` — opaque base64. At MVP scale (3 ops × ~3 locations = ~9 stores) pagination is barely exercised, but the contract ships now so the renter list never returns an unbounded set. Default 25 / max 50.

---

## 4. Read model 2 — Storefront detail

### Endpoint

`GET /storefronts/:locationId/vehicles` — **public, no auth**, `publicCatalogLimiter` + `cachePublic(c, 10)`.

Query params: `from`, `to` (required, `parseDateRange`), optional `class` (ACRISS filter), `limit`/`cursor`.

### Response shape

```jsonc
{
  "success": true,
  "data": {
    "storefront": { "locationId": "…", "name": "…", "address": "…", "operatorName": "…", "operatingHours": {…}|null },
    "vehicles": [
      {
        "id": "veh_...", "name": "Toyota Yaris", "make": "Toyota", "model": "Yaris",
        "year": 2023, "seats": 5, "transmission": "AUTO",
        "acrissCode": "CCAR", "classLabel": "Compact",
        "dailyRateJpy": 4500, "hourlyRateJpy": 800,
        "photos": ["…"]
      }
    ],
    "nextCursor": "…" | null
  }
}
```

### Logic (`StorefrontDetailService`)

1. Load the `location` by id (404 if missing/`ARCHIVED`).
2. `findAvailableVehicles(from, to, { locationId, classId? })` → the available individual vehicles for the range (exclusion + turnaround already applied).
3. Join `vehicle_classes` for `acrissCode` + label; project the renter-safe vehicle fields (no operator-internal fields — no `shakenExpiryDate`, no `insuranceExpiryDate`, no `bufferMinutes`).
4. Group/sort by class for the grouped-by-ACRISS UI (§4 item 3).

**404 vs empty:** unknown/archived `locationId` → **404**. Known store with no available vehicles for the range → **200 with `vehicles: []`** (the store exists; it's just full).

---

## 5. Architecture & boundaries (AGENTS.md)

Import direction **routes → services → repositories**; web has **no DB access** (calls Hono via `hono/client`).

### API layer (`packages/api`)

| Layer | File(s) | Responsibility |
|---|---|---|
| **Repo interface** | `repositories/types.ts` | Extend `AvailabilityRepository.findAvailableVehicles(from, to, filters?)` with optional `{ locationId?, operatorId?, classId? }`. Add a `StorefrontRepository` (or extend `LocationRepository` from #387) read method `findActiveStorefronts(ctx, { pickupLocationId? })` returning location rows with operator name joined. Every method takes `CallerContext`. |
| **Drizzle repo** | `repositories/drizzle/availability.ts`, `…/storefront.ts` | Add the optional `locationId`/`classId`/`operatorId` predicate to the existing `NOT EXISTS` query (join `vehicles.pickupLocationId`). New storefront read joins `locations ⨝ operators`. Reads use `operatorReadScope(ctx)` → `{kind:'all'}` for `PUBLIC_CONTEXT` (renter sees all operators — this is the marketplace, §6.2). |
| **InMemory repo** | `repositories/in-memory/availability.ts`, `…/storefront.ts` | Mirror the interface for tests (injected via `createApp(overrides)`). |
| **Service** | `services/storefront-search.ts`, `services/storefront-detail.ts` | Auth-agnostic; return `{ ok:true, data } | { ok:false, error, status }`. Own the group-by-class aggregation + daily/hourly min-price calculation. **No HTTP, no Hono imports.** |
| **Routes** | `routes/storefronts.ts` | Public GET routes registered **before** `requireAuth` (like `routes/vehicle-classes.ts:19`). Build ctx as `PUBLIC_CONTEXT` (no JWT needed). Use `ok()`/`fail()`/`parseDateRange()` + `cachePublic(c, 10)`. Mount at `/` in `index.ts`; stack `publicCatalogLimiter`. |
| **Composition root** | `index.ts` | Construct `StorefrontSearchService`/`StorefrontDetailService` with the storefront + availability + class repos; wire `createStorefrontRoutes(...)`. Only `index.ts` touches concrete classes. |

### Auth/scope model — the renter difference (§6.2)

Search is **public/renter-facing**. This is the inverse of slice 4's operator-private config:

- **No `requireManagementRead` gate.** Insurance/fees (slice 4) reject `RENTER`; the storefront catalog **must admit anonymous renters** — that's the product. Routes register before `requireAuth`.
- **`operatorReadScope(PUBLIC_CONTEXT) = {kind:'all'}` is correct and intended here** (the exact opposite of why it was unsafe for slice-4 private config). The renter genuinely should see every operator's stores — cross-operator search is the point (§2 Tenant routing: "renter portal = single URL space").
- **RENTER has no `operatorId`** (§6.2). No tenant predicate is applied to the renter read; the only filters are `status='AVAILABLE'`/`ACTIVE` location + the date-range availability + any explicit `pickupLocationId`/`class` query filter.
- **Renter-safe projection.** The repo/service must project only renter-visible columns. Never leak operator-internal fields (sha-ken/insurance expiry, buffer minutes, cost). This is the read-side analogue of tenant scoping: a public endpoint over a multi-tenant table must whitelist columns.

> **Learn: Public read ≠ privilege bypass.** `PUBLIC_CONTEXT` resolves to `{kind:'all'}` scope but `bypassScope:false` — it can read the cross-operator catalog but is not an admin. The safety control on a public multi-tenant read is **column projection** (whitelist renter-safe fields), not row scoping. Heuristic: when an endpoint is intentionally cross-tenant, audit the SELECT column list, not the WHERE clause.

### Web layer (`packages/web`)

- New renter route group: `app/[locale]/search/page.tsx` (search form + results) and `app/[locale]/storefronts/[locationId]/page.tsx` (detail). Follows the existing `app/[locale]/vehicles` catalog pattern (server component + `getTranslations`).
- New module `modules/storefronts/` mirroring `modules/classes/`: `api.ts` (typed `hono/client` calls via `createApiClient` — `packages/web/src/lib/api-client.ts`), `hooks.ts`, `index.ts`, `components/` (`StorefrontSearchForm`, `StorefrontCard`, `ClassSummaryBadges`, `StorefrontDetailView`, `AvailableVehicleCard`).
- i18n namespace `search.*` (and reuse `catalog.*` for ACRISS labels) across `en`/`ja`/`zh` (renter pages require all three, §8.2). **New namespaces require a dev-server restart** (`rm -rf packages/web/.next && bun run dev`).
- `StorefrontCard` renders the demo string; `ClassSummaryBadges` reuses the badge consistency rule (named badge component, never ad-hoc colors — `memory/feedback_badge-consistency`).
- A11y (§8.2 / `~/.claude/rules/react.md`): search form inputs have `<label>`s; date pickers keyboard-navigable; cards are semantic `<a>` links to detail.

---

## 6. What does NOT ship in slice 5 (explicit boundaries)

| Deferred to | Item | Why |
|---|---|---|
| **Slice 6 (#392)** | Any booking write; `requested_vehicle_id`/`assigned_vehicle_id` insert; the exclusion-constraint *write*; `booking_code`; selected-insurance snapshot; fee snapshot; vehicle selection → confirm. | Slice 5 is read-only. It surfaces a "select" button that, in slice 5, links to a placeholder/disabled booking route. The availability **read** predicate slice 5 uses is the same one slice 6's write transaction validates against — but the write is slice 6 (§2 Booking write boundary, §10 item 14). |
| **Slice 6** | Renter contact capture, insurance dropdown wired to operator options, booking submit. | §4 item 4. |
| **Post-MVP** | One-way rental (dropoff ≠ pickup filtering); distance/area geo-sort; map view; per-weekday operating hours. | §2 Locations; §4 item 2 lists "distance/area" — MVP shows address/area text only, no geo ranking. |
| **Post-MVP** | Materialized availability view. | §2 Availability query: "Live scan… no materialized view in MVP." Slice 5 uses the live `NOT EXISTS` scan. |

---

## 7. Schema changes (likely indexes only)

Slice 5 ideally adds **no tables and no columns** — it reads slices 1–4's schema. The only candidate change is **covering indexes** for the new query paths, if `bun run lint:fk-indexes` / query plans demand:

- `vehicles.pickupLocationId` — #387 already adds `idx_vehicles_pickupLocationId` (confirmed on PR #414); the storefront availability join reuses it. **No new index needed if present.**
- `bookings(vehicleId, status, startAt, effectiveEndAt)` — the `NOT EXISTS` overlap subquery filters on `vehicleId` + status + range. A composite/GiST index here would help at scale, **but** §8.2 sets search p95 <500ms at MVP scale (3 ops × ~40 vehicles) which the live scan "handles trivially." **Recommendation: ship no new index in slice 5; measure first.** If a plan regression shows up, add the index in a dedicated follow-up — do not speculatively index (YAGNI).

**If** any index is added: `bun run db:generate --name <describe>` → `db:migrate` → `db:verify` (3 green); respect the journal-`when` monotonic rule (CLAUDE.md 2026-04-17) when rebasing onto `marketplace-pivot`. **No hand-written `.sql` in `drizzle/`.**

---

## 8. Tests (TDD vertical-slice, mutation-resistant)

Strict RED→GREEN per behaviour (`~/.claude/rules/testing.md`). Seed two operators (A, B) each with a location + vehicles across ≥2 ACRISS classes + at least one overlapping booking, to prove cross-operator aggregation and exclusion.

| Layer | Coverage |
|---|---|
| **Service unit** (`StorefrontSearchService`) | Empty range params rejected (400 upstream). `classSummaries` counts ONLY available vehicles (a vehicle with an overlapping `CONFIRMED` booking is excluded; assert exact count drops by 1). `fromDailyPriceJpy === min(dailyRateJpy)` and hourly-only stores return `fromDailyPriceJpy:null` + exact `fromHourlyPriceJpy`. Store with zero available vehicles omitted. `class` filter trims summaries to requested codes. Cross-operator: stores from A and B both appear (assert both `operatorId`s present). |
| **Service unit** (`StorefrontDetailService`) | Unknown `locationId` → `{ok:false,status:404}`. Known store, full range → `vehicles:[]` (200). Available vehicles list excludes MAINTENANCE/RETIRED and overlapping-booked ones — assert exact ids. Renter projection omits `shakenExpiryDate`/`bufferMinutes` (assert key absent). |
| **InMemory repo** | `findAvailableVehicles(from,to,{locationId})` returns only that location's free vehicles; `{classId}` filter narrows correctly; turnaround respected (a booking ending inside `[from,to)` minus turnaround still blocks). |
| **Drizzle repo** (Neon `test`) | The extended `NOT EXISTS` overlap query returns the right vehicle set for a `locationId` against a seeded overlapping booking on `effectiveEndAt`. Confirms the SQL predicate, not just the in-memory mirror. |
| **Route** | `GET /storefronts/search` 200 public (no auth). Missing `from`/`to` → 400 (`parseDateRange`). `to<=from` → 400. Response shape matches the contract (assert `storefronts[0].classSummaries` + daily/hourly price fields). `GET /storefronts/:id/vehicles` unknown id → 404. `cachePublic` header present. |
| **E2E (Playwright)** — REQUIRED (first renter-facing slice, §6.1) | Happy path: renter opens `/en/search`, enters a date range, submits → sees a storefront card containing the store name + a class-summary badge (e.g. "Compact x4") + "from ¥4,500"; clicks the card → lands on `/en/storefronts/:id`, sees grouped available vehicles, sees a (disabled/placeholder) select control. **Mock only HTTP boundaries** (none external here beyond the API; seed the `test` DB). Extend the existing `e2e/browse.spec.ts` pattern + `playwright.config.ts` (#296 infra, #321 renter-browse spec). |

**E2E note:** this is the slice that *introduces* the renter search E2E; slices 6/8 build the full search→book→confirm journey on top. The §6.1 gate "E2E happy-path required green before slice 6 and slice 8 merge" means slice 5's E2E is the seed the later gates extend.

---

## 9. Resolved decisions / cross-slice risks

1. **Slices 2–4 not yet merged.** Slice 5 is the most downstream renter slice and **hard-depends** on `locations` (#387), `acriss_code` (#388), and vehicle-only pricing (#389c-drop). As of 2026-06-02 none are merged to `marketplace-pivot`. **Risk:** kicking off slice 5 early means coding against placeholder columns. **Mitigation:** treat slices 2→3→4 as a strict gate; do not start the schema-touching parts of slice 5 until they land. The web/UI scaffolding *can* start against the documented API contract.
2. **`AvailabilityRepository` signature change** is a shared interface edit (`repositories/types.ts`) touched by other slices. Making `findAvailableVehicles`' new arg **optional** keeps it backward-compatible, but coordinate so slice 6's booking-availability work and slice 5 don't both edit the method concurrently. Land slice 5's signature extension first if 5 and 6 partially parallelize (§6 "5 and 6 can partially parallelize").
3. **Dropoff/return location filtering.** Resolved for MVP: pickup=dropoff. The search API filters only `pickupLocationId`; the web may show a locked return-location control mirroring pickup, but no one-way filtering ships here.
4. **ACRISS label localization placement.** Resolved: API returns `acrissCode` (and raw operator-entered class data); the web localizes labels via the slice-3 `acriss.*` namespace. No `Accept-Language` API surface in this slice.
5. **Min price when a store has only hourly-priced vehicles.** Resolved: storefront cards prefer the minimum `dailyRateJpy` and render "from ¥X/day". If a store has available vehicles but no daily-priced vehicle, return `fromDailyPriceJpy:null` plus `fromHourlyPriceJpy` and render "from ¥X/hour"; do not derive a fake daily equivalent.
6. **Index speculation.** §7 recommends shipping no new index and measuring (§8.2 says the live scan handles MVP scale trivially). If a reviewer wants a guard index on `bookings`, it's a one-line additive migration — but YAGNI says wait for a real plan regression.

---

## 10. Per-slice merge gate (§6.1)

All green before merge: `bun run test` (unit + integration) · `bun run test:e2e` (renter happy path — **required this slice**) · `bun run lint` · `bun run --filter @kuruma/api lint:boundaries` · `bun run lint:modules` · `bun run db:verify` (if any index migration) · code-reviewer + architect agents (`memory/feedback_review-before-ship`).

---

## 11. Execution order & worktree

```
# Branch from the remote pivot; local marketplace-pivot is known to lag.
git worktree add ../kuruma-storefront-search -b feature/391-renter-storefront-search origin/marketplace-pivot
```

Within the worktree (vertical slice, RED/GREEN per behaviour):

1. Extend `AvailabilityRepository.findAvailableVehicles` interface + InMemory impl (RED test → GREEN).
2. `StorefrontRepository`/`LocationRepository` read interface + InMemory impl.
3. `StorefrontSearchService` aggregation (group-by-class, daily/hourly min prices) — unit tests first.
4. `StorefrontDetailService` — unit tests first.
5. Drizzle impls (integration tests against Neon `test`).
6. `routes/storefronts.ts` + mount in `index.ts` (route tests).
7. Web: `modules/storefronts/` + `app/[locale]/search` + `app/[locale]/storefronts/[locationId]` + i18n (`search.*`, restart dev).
8. Playwright E2E happy path.
9. code-reviewer + architect → rebase onto `origin/marketplace-pivot` (never force push) → PR `Closes #391`.

**Effort:** proposal §6 row 5 estimates **2–3 days**. The availability reuse (no new overlap math) keeps it toward the low end; the E2E + renter UI is the bulk of the work.

---

## 12. Critical files

**New (API):** `services/storefront-search.ts`, `services/storefront-detail.ts`, `repositories/{drizzle,in-memory}/storefront.ts`, `routes/storefronts.ts`.
**Modify (API):** `repositories/types.ts` (`findAvailableVehicles` filter arg + `StorefrontRepository`), `repositories/{drizzle,in-memory}/availability.ts`, `index.ts` (DI + mount).
**New (Web):** `app/[locale]/search/page.tsx`, `app/[locale]/storefronts/[locationId]/page.tsx`, `modules/storefronts/*`.
**Modify (Web):** `messages/{en,ja,zh}.json` (`search.*`), renter nav.
**New (test):** service unit + repo integration + `e2e/storefront-search.spec.ts`.
**Schema:** none expected (indexes only if a plan regression appears — §7).
