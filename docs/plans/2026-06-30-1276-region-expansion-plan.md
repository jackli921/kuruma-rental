# #1276 — Nationwide region dataset + selectable CITY nodes

Status: in progress. Branch `feat/1276-regions` off `develop`.

## Goal

The shared region selector is Kansai-only (18 nodes: 4 prefectures, 5 cities, 9 areas).
Operators outside Kansai cannot pick their prefecture/city when creating a location.
Expand to nationwide coverage and let a CITY be a valid (selectable/assignable) location region.

## Scope decision (confirmed with owner)

- Dataset: **all 47 prefectures + their capitals + the 20 government-designated cities** (deduped union, ~52 city rows; existing 4 prefectures / 5 cities kept as-is).
- Cities become **assignable** (operator picks prefecture -> city and can stop there).
- **Extensible later**: going to full ~1700 municipalities is pure additive seed data, no schema/UI change.

## Key facts (from investigation)

- Location region gate (`packages/api/src/services/location.ts:234-240` `resolveRegionId`) checks
  `assignable === true && status === 'ACTIVE'` — **NOT** `type === 'AREA'`. So API/validator/repo need **no change**.
- Seeding is idempotent: `seed.ts:176-210` upserts `onConflictDoUpdate({ target: regions.id })`.
  Ids are hashed via `seedId(literal)` (SHA-256 -> UUID); slugs are stored verbatim and are UNIQUE.
- New cities reference existing prefectures by literal `parentId: 'reg_osaka'` etc. -> `seedId` maps to the
  existing prefecture UUID, so parents are reused, never duplicated.
- No schema change (no new columns) => **no drizzle migration**; only `DEMO_REGIONS` grows + one web component.

## Decisions baked in

1. **City coords = null.** `nearestAssignableRegion` is type-agnostic; giving cities coords would pull them into
   auto-derivation and "near me", changing existing behavior. Null keeps cities explicit-select-only (safer).
   Consequence: a city-only operator must pick a region explicitly (auto-derive 422s without coords) — acceptable.
2. **Slug uniqueness via `-city` suffix** for cities sharing a name with their prefecture (e.g. `osaka` vs
   `osaka-city`). `onConflictDoUpdate` targets id only; a dup slug on a new id throws a raw unique-violation.
3. Keep the existing 4 prefectures / 5 cities / 9 areas untouched (same ids/slugs); flip the 5 existing CITY rows
   to `assignable: true` for consistency.

## Work (vertical slices, commit per slice)

1. **Plan doc** (this file). [commit]
2. **Dataset**: extend `packages/shared/src/db/seed-data/regions.ts` — add 43 prefectures + capitals + designated
   cities (trilingual en/ja/zh, kebab slugs with `-city` suffix, `assignable: true`, coords null, sortOrder within
   parent). Flip existing 5 cities to assignable. Add a **structural test** asserting: all slugs unique, every
   non-null parentId resolves within the array, parents ordered before children, all 3 names non-empty. [commit]
3. **Web cascade**: `packages/web/src/vite/operator-locations/RegionCascade.tsx` — `handleCity` emits the city id
   when the city is `assignable && ACTIVE`; area select becomes an optional deeper refinement; rewrite `chainFor`
   to resolve prefecture/city/area slots by `type` (mirror `regions/region-lookup.ts` `regionChain`). Update prop
   doc + `LocationForm.tsx` comment; optional i18n `region.help` wording. Update
   `packages/web/tests/vite/operator-locations/RegionCascade.test.tsx` for city-as-terminal. [commit]
4. **API integration test**: extend `packages/api/tests/integration/locations-region.test.ts` — assert an
   assignable CITY regionId is accepted on location create (PREFECTURE still rejected). [commit]

## Verification

- `bunx tsc` (web + api) clean.
- Web: `bunx vitest run` region + operator-locations green.
- API: locations-region integration green.
- Dataset structural test green (guards slug collisions + FK order without needing a live DB).
- Optional: local docker pg + `bun run scripts/seed-tcp.ts` to confirm the full dataset loads (FK order, no slug dup).
- Populating beta/prod happens later: owner re-runs `bun run db:seed` against the beta branch (idempotent upsert).

## Out of scope / follow-ups

- Full ~1700 municipalities (additive later).
- `search/result.ts:135` labels "nearest area" only for AREA nodes — assignable cities won't get a distance label
  (graceful degrade; file as UX follow-up if needed).
- AREA nodes per city (sub-city landmarks) — add on demand.
