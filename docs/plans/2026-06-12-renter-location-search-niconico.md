# Renter location search — NicoNico-style hierarchical regions, with tourist shortcuts on top

**Status:** PROPOSAL v2 (hybrid, owner-approved direction) · revised 2026-06-13 (hardened after adversarial review)
**Relates to:** #391/#458 (storefront + flat search, merged), #531/#574/#601 (geocoding), **#394 (region taxonomy — this BUILDS ON it, the foundation)**
**Owner checklist rows addressed:** 游客端 step 2 (搜索 时间/**地点**/车型) + step 3 (门店列表 显示**该区域**各家店)

> **v2 reframe.** v1 proposed static "Kansai area chips" that would *supersede* #394. That was wrong: it
> could not support a real prefecture→city→area dropdown, and — critically — it never closed the
> operator→search loop. **#394's DB-backed region hierarchy is the real foundation.** Tourist chips and
> "📍 Near me" are *shortcuts on top of it*, not replacements. This version bakes in the hybrid:
> operator-registered stores are auto-suggested a region from their geocoded pin, the operator confirms or
> overrides, and an ACTIVE public storefront may not exist without a confirmed region — so it can never
> silently vanish from area search.

---

## 1. Goal

Give renters NicoNico-style hierarchical location search (**prefecture → city → area** dropdowns) that
**actually works end to end**: when an operator registers a store, that store appears under the right area
in renter search — automatically, without making operators classify geography from scratch. Layer
tourist-friendly affordances (quick area chips, "📍 Near me", nearest-first ranking) on top of the same
foundation. Scale to nationwide by adding *data*, not schema.

## 2. The model

NicoNico's flow: **pick an area → see stores in that area → open store → choose class + dates → reserve.**
`marketplace-pivot` already implements everything *after* "pick an area" (storefront-first, epic #385).
The missing axis is **WHERE**, and the right shape for it is a real region hierarchy, not a flat chip list:

| Layer | What | Source of truth |
|---|---|---|
| **Foundation** | DB-backed region tree (prefecture→city→area), recursive subtree filter | `regions` table + `locations.regionId` (#394) |
| **Shortcuts** | Quick chips (`なんば` `梅田` `KIX` `京都`), "📍 Near me" | UI sugar → resolve to a `regionId` or a `lat/lng` point |
| **Ranking** | "~2.1 km · Namba" nearest-first *within* the chosen area's results | Haversine over store coords (already present, #531) |

The hierarchy gives a true **filter** (NicoNico-literal: "stores in this area"); distance is **ranking
within** that filter, not the whole model. Chips are just preset region selections. "Near me" skips the
hierarchy and ranks by raw `lat/lng`.

## 3. What already exists (#394) vs. what is net-new

**Already built on `feat/394-region-search` (unmerged):**
- `regions` table — adjacency list (`parentId` self-ref, null=root), trilingual `nameEn/nameJa/nameZh`, `sortOrder`.
- `locations.regionId` — nullable FK + Zod validator + index; create/update routes thread it; FK→422 mapping.
- Recursive descendant resolution — `collectDescendantIds` (pure BFS, driver-agnostic; not a raw CTE on purpose).
- `GET /regions` — public, edge-cached 1h, flat list; client builds the cascade.
- `regionId` filter wired into **both** storefront-search and flat-search (filter to `regionId` subtree).
- Kansai seed (Osaka/Kyoto/Hyogo/Nara → city → area incl. KIX, Namba, Umeda) + integration tests.

**Net-new in this slice (the hybrid that closes the loop):**
- Extend `regions` with `type`, `lat`, `lng`, `assignable`, `status`, and a stable `slug` (below).
- A **region suggestion engine** (pure: nearest assignable region to a point).
- Operator location form: show the suggested region, allow override.
- Location service: derive a region from coords when none supplied; **reject an ACTIVE location with no region**.
- Backfill existing/seed locations from their `lat/lng`; assert no ACTIVE searchable location is unassigned.
- Renter: the cascading **dropdown UI** (#394 left this — its "Phase 4"), chips, "Near me", distance labels.

## 4. Data model

### 4.1 `regions` (extend #394's table)

Current #394 columns: `id`, `parentId`, `nameEn`, `nameJa`, `nameZh`, `sortOrder`, timestamps. **Add:**

| Column | Type | Why |
|---|---|---|
| `type` | enum `PREFECTURE \| CITY \| AREA` (extensible) | Label each dropdown level; decouples "level" from raw tree depth |
| `lat`, `lng` | double precision, nullable | Region center — powers map-centering, distance anchor, and the suggestion engine |
| `assignable` | boolean (default false) | Only assignable nodes (typically `AREA`) are valid store targets + suggestion candidates |
| `status` | enum `ACTIVE \| INACTIVE` (default ACTIVE) | Hide a region from dropdowns/suggestions without deleting it |
| `slug` | text, unique | **Stable** human ID for chips + shareable URLs. #394 region `id` is `crypto.randomUUID()` regenerated on every seed run — so chips and search URLs MUST reference `slug` (`?region=namba`), never the UUID, or they break on re-seed. |

Region names stay **DB columns** (`nameEn/Ja/Zh`), not i18n message keys — so the renter UI picks by route
locale and we never touch the i18n parity gate for region labels. (Fixes a v1 hazard.) **Trade-off:** adding
a 4th locale later becomes a schema migration (`nameXx` column + backfill) rather than a message-file edit.
Acceptable at three locales; revisit if the locale set grows.

### 4.2 `locations.regionId`

- **Nullable at the DB level** (migration safety: legacy rows, and the create path before suggestion runs).
- **Required by the service when effective `status = 'ACTIVE'`** — see §5. `regionId` is the **confirmed
  assignment and the only truth.** Nearest-center is a *suggestion engine*, never a stored shadow field.
- **Must reference an `assignable`, ACTIVE region** — validated in the service (a Postgres `CHECK` cannot
  hold a subquery, so this is service-level + the FK, not a DB CHECK). Rejects a bad/ineligible region with
  422, not a raw FK 500.
- **`locations.status` enum is `ACTIVE | ARCHIVED` today — there is no `DRAFT`.** So a newly created store is
  ACTIVE immediately and must resolve a region at create time. A draft-before-publish state would be a
  separate future change (new enum value + migration + publish flow); out of scope here.

## 5. The operator → search loop (the part v1 missed)

This is the loop that makes a registered store discoverable. It hooks into `LocationService.create/update`,
which already resolves coordinates through the injected `Geocoder` (#531) — the suggestion runs right after.

1. **Operator registers/edits a store** → enters address (and/or drops a manual pin).
2. **Coords resolve** via the existing geocoder — `coordinateSource` ∈ `GEOCODED | MANUAL | PENDING` (#531/#601),
   or null when no coords are captured. `PENDING` (geocode throttled) means coords are *unknown right now*.
3. **Suggestion engine** (pure: `nearestAssignableRegion(assignableRegionsWithCoords, point)`) proposes a
   `regionId` from those coords. The operator form shows it pre-filled. **No usable point → no suggestion:**
   when coords are null/`PENDING`, or the nearest assignable region is beyond a sanity radius (a store far
   from every seeded area — e.g. Tokyo while only Kansai is seeded), the engine returns nothing rather than a
   wrong guess, and the operator **must** pick a region manually before the store can be ACTIVE.
4. **Operator confirms or overrides** via the prefecture→city→area dropdown.
5. **API create/update** accepts an explicit `regionId`, OR derives one from coords when absent.
6. **Guard — enforced in `LocationService`, NOT the route**, so the operator form, the platform-admin path,
   and the seed path all obey the same rule. If the location's **effective** status is `ACTIVE`
   (`data.status ?? existing.status` — a status transition into ACTIVE can't sneak past it) and it still has
   no `regionId` after suggestion, the write is **rejected (422)** — an active public storefront cannot be
   unsearchable. Fires on create AND update. `ARCHIVED` locations may remain unassigned.
7. **Backfill** (one-off, idempotent script; runs in Slice 1 **after** region centers are seeded and
   **before** the Slice 2 guard deploys): assign every existing location from its `lat/lng` via the same
   nearest-assignable logic. Stores beyond the sanity radius (no confident region) are left null and reported
   — they can't go ACTIVE until manually assigned. A test then asserts no ACTIVE location is regionless.

**Suggestion vs. truth (the refinement):** the nearest-center function is stateless and advisory. We persist
only the confirmed `regionId`. A store near a boundary that the engine mis-snaps is fixed by the operator
override, not by trusting geometry as fact. On an **address edit** that moves the store, the service
re-suggests from the new coords and the form should surface the change ("region updated to Umeda") rather
than silently re-stamping. If we later add region **polygons** for precise point-in-region, it changes only
the suggestion engine — the search contract (filter by `regionId` subtree) is unchanged.

## 6. Renter search

- **Cascading dropdowns** (prefecture → city → area), built client-side from the cached `GET /regions` flat
  list — this is #394's unfinished "Phase 4" UI.
- **Quick chips** (`なんば` `梅田` `KIX` `京都`) = preset region selections referenced by **`slug`** (`?region=namba`),
  never the UUID (§4.1).
- **Precedence (one anchor at a time):** the active "Where" is exactly one of — a selected region (dropdown or
  chip), a "Near me" point, or nothing. A selected region **always wins** over geolocation; "Near me" is
  opt-in, never the default. On geolocation denial/unavailable, fall back to "nothing" (full list). This
  resolves the demo-from-outside-Japan footgun (a stale device location can never override a chosen area).
  "Near me" also requires HTTPS (localhost is fine in dev).
- **Results:** when a region is chosen, filter storefronts to that subtree (already built), then **rank
  nearest-first within the filtered set** with "~2.1 km" labels (distance = Haversine from the anchor point —
  the region center or the geolocation point — to each store). No region chosen → today's behavior unchanged:
  all stores in the existing **operator-name → name → id** stable sort (NOT "date-sorted" — v1 error). Stores
  with null coords rank last. **Note:** "nearest-first" is a *within-page* ordering + display label until the
  server-side `?sort=distance` follow-up (#439); see §7.
- **Store-grid card needs coords + an anchor.** Today's `StorefrontCard` DTO has **no** `lat/lng` (only
  flat-search's `ResultLocation` does, for the map). So the store-grid distance labels require (a) adding
  `latitude/longitude` to the `StorefrontCard` projection and (b) threading the chosen anchor point into the
  grid. Optionally add `regionId` + a region breadcrumb to the card so a renter who picked "Osaka City" sees
  why a "Namba" store is in the list.
- **Map view (#458, already built):** promote its toggle to co-equal. *New* behavior added by this slice:
  when an area is chosen, center the map on that region's `lat/lng`; if that region has null coords, fall back
  to the existing fit-all-pins viewport (centering does not exist today).

### Form integration caveat
`StorefrontSearchForm` is deliberately **uncontrolled** (reads FormData on submit; dodges hydration flake
#392). The new Where control is a popover/dropdown that resolves to a `regionId` (or point) merged into the
submit navigation — keep the date inputs uncontrolled; the region selection is the one piece of local state.

## 7. Architecture & future-proofing

- **Nationwide = data, not schema.** New prefectures/cities/areas are rows; the adjacency tree + recursive
  filter already scale. MVP seeds **Kansai only**.
- **Tree stops at AREA.** Finer-than-area ("near my hotel / station name") is **free-text geocode (Phase 2,
  out of scope here)**, not thousands of landmark rows in the taxonomy.
- **Distance sort is client-side, per page.** Fine at ~9 stores (one page). With the region filter the result
  set is a subtree, smaller still. If store count ever outgrows a page, server-side `?sort=distance` is the
  documented follow-up (#439) — and must keep a deterministic tiebreak for the cursor.
- **Region-aware availability query (REQUIRED before multi-operator scale).** Region filtering currently
  narrows only the *storefront list* — the **availability scan is not bounded**: with a region (not a single
  `pickupLocationId`) selected, `findAvailableVehicles(from, to, …)` passes no location filter and scans
  *all* available vehicles platform-wide for the window, then groups in memory and discards out-of-region
  cars. Acceptable at ~9 stores; an unbounded full-inventory scan per search at many operators/locations.
  **Fix:** push the resolved descendant location set into the query — extend `AvailabilityFilters` with
  `locationIds` (plural) and pass the region-matched storefronts' ids (already in hand after
  `findActiveStorefronts`) into `findAvailableVehicles`, in **both** `StorefrontSearchService` and
  `FlatSearchService`. The Drizzle availability query gains a `location_id = ANY($ids)` predicate (index on
  `vehicles.pickupLocationId`); the in-memory path stays for tests. Cheap to do when landing #394 (the
  descendant ids are already resolved for the storefront filter) — do it then or track as a hard pre-scale gate.
- **Recursion stays app-code BFS** (#394's choice) for driver portability (neon-http `.rows` vs postgres-js
  array); revisit only if the tree grows to thousands of nodes.

## 8. Slices (vertical, TDD)

**Slices are strictly sequential — each depends on the previous.** Do not start Slice N+1 until Slice N's
migrations are applied and `db:verify` is green.

- **Slice 0 — Land #394.** Bring `feat/394-region-search`'s commits onto a **fresh branch off current mp** (do
  NOT edit the foreign worktree). #394's migration is a stale `0048` that **collides** with mp's existing
  `0048` (operator memberships); mp is already past `0050`. So **do not rename the file** — rebase onto mp and
  regenerate: `bun run db:generate --name add_regions_and_location_region_id` produces the delta at the next
  free number (≈`0054`), adding the `regions` table + `regionId` FK to the *already-existing* `locations`
  table. Watch the journal `when`-ordering gotcha (CLAUDE.md). `db:verify` must show 3 green. Outcome: region
  tree + `regionId` + renter subtree filter live; demo works via seed. **While here, also bound the
  availability scan** (§7 "Region-aware availability query"): extend `AvailabilityFilters` with `locationIds`
  and pass the region-matched storefront ids into `findAvailableVehicles` in both search services — the
  descendant ids are already resolved at this point, so it's a small, high-leverage scale fix to land now.
- **Slice 1 — Region coords + suggestion + backfill.** New migration adds `type/lat/lng/assignable/slug/status`
  to `regions`. Then, in order: (a) seed region centers (`lat/lng`, `type`, `assignable=true` for AREA nodes,
  `slug`); (b) implement pure `nearestAssignableRegion(regions, point)` in `packages/shared/src/lib/` (filters
  to `assignable && ACTIVE && coords present`, Haversine, **sanity-radius cap**, deterministic tiebreak by
  `sortOrder` then `id`; null point → null) so both backfill and the service (Slice 2) and web distance labels
  share it; (c) one-off idempotent backfill script assigns every existing location; (d) test: zero ACTIVE
  locations regionless, far-away stores left null + reported. Also set `regionId` on the #394 seed locations.
- **Slice 2 — Close the operator loop.** Inject `RegionRepository` into `LocationService`; derive region from
  coords on create/update; **guard in the service** on effective status → reject ACTIVE-without-region (422),
  covering operator + platform-admin + seed paths; validate `regionId` is assignable+ACTIVE (422, not FK 500);
  operator form shows suggested region + override dropdown + "region changed" hint on address edit.
- **Slice 3 — Renter front door.** Cascading dropdowns + chips (`slug`) + "Near me" + `lat/lng` on the
  `StorefrontCard` projection + distance labels + map-centering on the chosen region; thread the chosen region
  (`slug`) through search→detail→back nav (#499 pattern).
- **Phase 2 (later, out of scope):** free-text hotel/station search → public geocode endpoint behind #601 KV
  cache; matched to nearest region or used as a raw point.

## 9. Test plan (per slice, mutation-resistant)

- **shared (unit):** `nearestAssignableRegion` picks the nearest *assignable, ACTIVE, coords-present* region;
  ignores non-assignable/inactive/null-coord regions; null point → null; beyond sanity radius → null;
  equidistant → deterministic tiebreak (`sortOrder` then `id`). Haversine + null-coord-stores-last ordering.
- **api (service):** create/update derives region from coords when absent; **effective-ACTIVE + no region →
  422** (incl. a DRAFT-less status transition and the platform-admin/seed paths); `ARCHIVED` may be
  regionless; explicit override beats suggestion; non-assignable/inactive `regionId` → 422; PENDING/null
  coords → no suggestion → manual region required for ACTIVE. Backfill assigns all in-radius rows; assertion:
  zero ACTIVE locations unassigned; far-away rows reported, not silently mis-assigned.
- **api (search, Drizzle):** `regionId` filter returns the node + descendants; `StorefrontCard` projection
  **gains** `latitude/longitude` (it has none today) while still omitting operator internals
  (`licensePlate`, etc.). (Flat-search's `ResultLocation` already carries coords — that is a separate DTO, not
  a regression target.)
- **web (component):** dropdown cascade builds from `/regions`; selecting an area pushes `slug` to the URL and
  re-filters + re-sorts; chip resolves to the same `slug`; "Near me" denied → falls back to full list; a
  chosen area overrides a geolocation point.
- **e2e (real-DB lane):** operator registers a store with a Kansai address → renter picks that area → the new
  store appears, nearest-first → opens → books. Plus: pick a far region → all stores still shown, ranked.

## 10. Decisions (owner-approved)

1. **Region assignment:** hybrid — auto-suggest from pin, operator overrides.
2. **Blank region:** not allowed for an effective-ACTIVE public storefront (guard enforced in the service so
   no path bypasses it; nullable at DB for migration safety). `ARCHIVED` may be unassigned. (No `DRAFT` status
   exists today; the enum is `ACTIVE | ARCHIVED`.)
3. **Backfill:** yes, via the same nearest-region suggestion, with a sanity radius; tests prove every
   ACTIVE location has a region and far-away rows are reported rather than mis-assigned.
4. **Truth vs. suggestion:** `locations.regionId` is the confirmed truth; nearest-center is only a suggestion
   engine, never persisted as a separate "truth" field.
5. **Area-list breadth:** Kansai-only for MVP; nationwide later by adding rows.
6. **Stable identifiers:** regions carry a unique `slug`; chips and search URLs reference `slug`, never the
   re-seed-unstable UUID.
7. **Free-text hotel/station:** deferred to Phase 2 (behind #601); not in this design.
