# Issue #651 — Renter location search build (implementation plan)

**Status:** PLAN (awaiting agent review + owner confirm) · 2026-06-13
**Design source of truth:** `docs/plans/2026-06-12-renter-location-search-niconico.md`
**Issue:** #651 · **Builds on:** #394 (foundation, unmerged on `feat/394-region-search`)

---

## 0. Objective & sequencing reality

Make the landing-page "Where" control functional. The visible gap is #394's **Phase 4 (renter dropdown UI)** which was never built. But that UI (our Slice 3) is the *last* link in a chain — it cannot work until the region foundation, coordinates, and the operator→search loop exist on `marketplace-pivot`.

**Critical constraint:** the #394 foundation (regions table, `GET /regions`, recursive subtree filter) is built but **only on the foreign worktree** `feat/394-region-search` (`~/Dev/kuruma-394-region-search`, 60 commits behind mp, unmerged, handed off after "Phase 4 remaining"). Per repo rule we **never edit a foreign worktree**. The design's Slice 0 already anticipates this: re-land its commits on a fresh branch off mp.

So the build order is fixed and sequential: **Slice 0 → 1 → 2 → 3.** Each is one PR; do not start N+1 until N's migration is applied and `db:verify` is green.

---

## 1. Slice 0 — Land the #394 foundation onto mp (immediate next action)

**Branch:** `feat/651-land-region-foundation` off `origin/marketplace-pivot` in a new worktree `~/Dev/kuruma-651-region-foundation`.

### 1a. Re-land Phases 1-3 (do NOT touch the foreign worktree)
**This is a manual re-apply, not a clean cherry-pick** (architect-confirmed). The foundation branched at migration `0047`; mp has since moved 5 migrations + heavy feature work ahead, so `git cherry-pick` WILL conflict. Guaranteed hotspots:
- `packages/api/src/services/location.ts` — foundation's Phase-2 `regionId`-settable edit was on the **pre-#531** service; mp rewrote it into a geocode-on-save service (`resolveCreateCoords`/`resolveUpdateCoords`). Re-apply the `regionId` change **by hand onto mp's rewrite**.
- `packages/api/src/index.ts` (composition root) — mp's `LocationService` is 3-arg `(locationRepo, bookingRepo, geocoder)` + adds a mp-only `StorefrontDetailService`; foundation adds `regionRepo` to both search-service ctors + the regions route. Merge by hand.
- `services/{flat-search,storefront-search}.ts` ctors gain `regionRepo` — ctors differ on mp.

Bring across the foundation's non-migration changes by re-applying the diff, then **discard the stale `drizzle/` artifacts** and regenerate (see 1b). Foundation commits:
- `7755898` feat(shared): regions table + `locations.regionId` (Phase 1)
- `5ab0e65` feat(api): make `locations.regionId` settable (Phase 2)
- `0b88116` feat(api): `GET /regions` tree endpoint + recursive region filter on search (Phase 3)

Files it touches (verify each still applies on current mp): `packages/shared/src/db/{schema.ts,regions.ts,seed.ts,seed-data/*}`, `packages/shared/src/validators/location.ts`, `packages/api/src/repositories/{drizzle,in-memory}/{region,location,storefront}.ts`, `packages/api/src/repositories/{types.ts,region-tree.ts}`, `packages/api/src/routes/{regions.ts,locations.ts,search.ts,storefronts.ts}`, `packages/api/src/{index.ts,stores.ts,pg-errors.ts}`, `packages/api/src/services/{storefront-search,flat-search}.ts` + their tests, integration tests `regions.test.ts` / `locations-region.test.ts`.

### 1a-bis. Carry the foundation code-review fixes into the re-land (don't re-land blind)
A code review of the foundation impl returned **SHIP-WITH-FIXES**. Apply during re-apply:
- **[HIGH] Cycle guard in `collectDescendantIds`** (`packages/api/src/repositories/region-tree.ts`). The BFS has no visited-set; the `regions.parentId` self-FK has no cycle constraint, so a single cyclic/self-parent row infinite-loops the **public, unauthenticated** search path → CPU-limit DoS. Add a `visited: Set<string>` (also dedupes diamond paths). Add a unit test with a cyclic fixture. **This is the one must-fix before re-landing.**
- **[MED] Stale comments** in `repositories/types.ts` + `shared/src/db/regions.ts` claim a `WITH RECURSIVE` CTE; the impl deliberately uses app-code BFS (design §7). Correct the comments.
- LOW (readability of the `regionId || pickupLocationId ? …` filter guard; a shared-fixture cross-repo contract test) — optional cleanup, non-blocking.
- Everything else passed: FK→422 mapping, seed integrity (no cycles, stable `seedId()` UUIDs), region filter correctness (empty/null/unknown all closed), arch boundaries, test quality.

### 1b. Migration renumber (the collision)
Foundation ships `drizzle/0048_add_regions_and_location_region_id.sql` + `0048_snapshot.json` + a `_journal.json` entry. mp is already at **`0053`**. **Do not rename the file** — discard the foundation's `drizzle/` artifacts entirely and regenerate from the updated `schema.ts`:
```
bun run db:generate --name add_regions_and_location_region_id   # emits ~0054
bun run db:migrate
bun run db:verify   # 3 green checks required
```
The `locations` table already exists on mp, so the regenerated delta = create `regions` + add `regionId` FK/index to `locations`. Watch the journal `when`-ordering gotcha (CLAUDE.md): the new entry's `when` must be `> max(previous)`.

### 1c. Bound the availability scan (high-leverage; land as the FINAL commit of the Slice 0 PR)
Per design §7: when a region (not a single store) is selected, `regionIds` narrows only `findActiveStorefronts`; `findAvailableVehicles(from,to,…)` is then called with `undefined` location filter and scans **all** vehicles platform-wide, discarding out-of-region in memory (verified: `storefront-search.ts:92`, `flat-search.ts:73`).
- `AvailabilityFilters` **already has a singular `locationId`** (`types.ts:484-488`). **Add `locationIds?: string[]` alongside it** — do not replace.
- Data path: after `findActiveStorefronts(regionIds)` returns the in-region storefronts, pass their **`.id`s** (a storefront id = its location id) as `locationIds` into `findAvailableVehicles`, in **both** `StorefrontSearchService` and `FlatSearchService`.
- Drizzle query gains `inArray(location_id, ids)` (index `idx_vehicles_pickupLocationId` confirmed at `schema.ts:463`); in-memory path filters the same way (keep for tests).
- **`StorefrontDetailService` (mp-only, `index.ts:653`) is a 3rd `availabilityRepo` consumer** — single-storefront, already passes one `locationId`; confirm unaffected (no change expected).
- Land this as the last commit on the Slice 0 branch (after the foundation re-apply is green) so it reads as an isolated diff. If review finds Slice 0 too large, split this into a Slice 0b follow-up PR.

### Slice 0 tests / exit
- shared: regions seed-data shape; `region-tree` descendant BFS.
- api integration (real PG): `GET /regions` returns the tree; `regionId` filter returns node + descendants on both search paths; availability scan bounded to `locationIds`.
- `db:verify` 3 green; CI lanes green. **Exit:** region tree + `regionId` + subtree filter live on mp via seed; #394's build effectively closed.

---

## 2. Slice 1 — Region coords + suggestion + backfill

- Migration: add `type` (PREFECTURE|CITY|AREA), `lat`/`lng` (nullable), `assignable` (default false), `status` (ACTIVE|INACTIVE default ACTIVE), `slug` (unique) to `regions`.
- Seed region centers + `assignable=true` on AREA nodes + stable `slug`s. (Note: the foundation's `seed.ts` already sets `regionId` on seed locations + seeds the region tree — so Slice 1's net-new is the centers/`lat`/`lng`/`slug`/`type`/`assignable`, not the location wiring.)
- Pure `nearestAssignableRegion(regions, point)` in `packages/shared/src/lib/` — filters to assignable+ACTIVE+coords-present, Haversine, **sanity-radius cap**, deterministic tiebreak (`sortOrder` then `id`), null point → null. Shared by backfill, Slice 2 service, Slice 3 web labels.
- Idempotent one-off backfill script: assign every existing location from its `lat/lng`; far-away rows left null + reported.
- Test: zero ACTIVE locations regionless; far rows reported not mis-assigned.

## 3. Slice 2 — Operator→search loop guard

- Inject `RegionRepository` into `LocationService`.
- On create/update: derive `regionId` from coords when absent (via geocoder coords + `nearestAssignableRegion`).
- **Service-level guard** (not the route): effective status (`data.status ?? existing.status`) ACTIVE + no `regionId` after suggestion → reject **422**. Fires on create AND update; covers operator + platform-admin + seed paths. ARCHIVED may stay regionless.
- Validate `regionId` references an assignable+ACTIVE region → 422 (not raw FK 500).
- Operator location form: show suggested region, prefecture→city→area override dropdown, "region changed to X" hint on address edit.

## 4. Slice 3 — Renter front door (the live picker)

- Two integration points, different patterns (verified):
  - `vite/landing/SearchWidget.tsx` — replace the static "Where" `<div>` (`:48-55`). This form is already **controlled** (`useState` dates, `:26-27`), so region selection just joins existing local state.
  - `vite/storefronts/StorefrontSearchForm.tsx` — **add** a "Where" control (it has none today, `:22-24`). This form is **uncontrolled** (reads FormData on submit, dodges hydration flake #392) — keep the date inputs uncontrolled; the region popover is the one piece of local state, merged into submit navigation.
  - Build the cascade client-side from cached `GET /regions`.
- Quick chips (`なんば` `梅田` `KIX` `京都`) referenced by **`slug`** (`?region=namba`), never UUID.
- "Near me": opt-in, HTTPS-only; a chosen region always wins over geolocation; denial → full list.
- Add `latitude`/`longitude` to the `StorefrontCard` projection (it has none today); thread the anchor point into the grid; "~2.1 km · Namba" labels; null-coord stores last.
- Map view (#458): center on chosen region's `lat/lng`, fall back to fit-all-pins when null.
- Thread chosen region `slug` through search→detail→back nav (#499 pattern).
- *Deferred (design §6 optional):* region breadcrumb on the storefront card — not a must-have for this slice.

---

## 5. Risks & open questions (for review)

1. **Foreign worktree contention.** If the `feat/394-region-search` owner resurfaces and lands #394 themselves, Slice 0 collapses to a rebase. Mitigation: re-land off mp now (design-sanctioned); reconcile if a #394 PR appears.
2. **Migration discipline.** Regenerate (don't rename) the foundation migration; journal `when` > max. db:verify is the only trustworthy signal.
3. **Availability scan bounding (1c)** changes a hot query in two services — needs the `vehicles.pickupLocationId` index to exist (verify) and the in-memory path kept in sync for tests.
4. **StorefrontCard DTO** must gain `lat/lng` without leaking operator internals (`licensePlate` etc.) — verify current projection.
5. **Scope size.** 4 sequential slices spanning schema→api→web. Confirm we ship slice-by-slice (4 PRs) vs one mega-PR. Recommend 4 PRs per repo vertical-slice rule.
6. **Should Slice 0 close #394**, or keep #394 for the design and let #651 own all build slices? (Recommend: Slice 0 PR says "Closes #394"; #651 tracks the remaining renter-facing build.)
