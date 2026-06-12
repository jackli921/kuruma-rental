# Issue #531 — Geocoding Foundation — Session Handoff

**Date:** 2026-06-12
**Issue:** #531 `feat(operator): geocoding foundation — provider-neutral Geocoder port + capture location lat/lng on save` (P1, part of #523/#385/#378). **Claimed** (assigned + `in-progress`).
**Scope:** API / service / contract ONLY — **no UI** (UI is #529, which depends on this).
**Base branch:** `marketplace-pivot` @ `1cd08e4`. **MERGE, never rebase** (force-push is hard-denied).

> **STATUS 2026-06-12 (FINAL — PR OPEN, MERGE-PENDING):** All slices 1-5 done +
> reviewed + **PR #564 open, MERGE-READY** (base `marketplace-pivot`). Tip `a75b6a6`.
> Two review rounds done: `/code-review` PASS (LOW immutability fix `9836d57`) + user
> MEDIUM on Nominatim rate-limit → hardened `b5069ff` (geocoder needs BOTH `NOMINATIM_USER_AGENT`
> AND explicit `NOMINATIM_API_URL`; warn on 429/ban; env docs) + **filed #574** (global
> limiter, blocks #529 prod). **Base merged in twice** (#521→mig renumber 0050, then #551
> turnaround→**mig renumbered to `0051_add_location_coordinate_source`**). PR is `MERGEABLE`,
> `BEHIND` by 1 (#528 operator-classes — no migration, no conflict). Gate GREEN merged tree:
> db:verify 4/4 (**52 migs**), shared 437, api 1183, integration 203. CI at handoff:
> db-drift/e2e/e2e-real-db PASS, **test-and-build still PENDING** (user stopped the watch).
> **NEXT = merge:** confirm test-and-build green → `gh pr merge 564 --squash --delete-branch=false`
> (if blocked as BEHIND, `gh pr update-branch 564` — MERGE not rebase — wait CI, then merge).
> Base merged
> in (no force) and **migration renumbered 0048 → `0050_add_location_coordinate_source`**
> because #521 landed 0048/0049. Local gate GREEN on the merged tree: tsc api+shared,
> lint:boundaries, **db:verify 4/4 (51 migs, fresh DB)**, shared 433, api **1175**,
> **integration 195/195** on docker pg `kuruma-531-pg` :5443 (db `kuruma`, recreated).
> Reviews: code-reviewer no CRITICAL/HIGH/MEDIUM; architect SHIP-WITH-NITS (nits fixed
> in `59156f7`; FC/IS planner deferred). **REMAINING = merge only:** wait for CI green
> (db-drift/e2e/e2e-real-db/test-and-build on PR #564) → merge via `gh pr merge --squash`
> → **manually `gh issue close 531`** (non-default base won't auto-close) + drop label →
> cleanup worktree + `docker rm -f kuruma-531-pg`. Nothing left to implement.

## Where to resume
- **Worktree:** `~/Dev/kuruma-531-geocoding`, branch `feat/531-geocoding-foundation`.
- **Docker PG:** container `kuruma-531-pg` on **:5443**, db `kuruma`. `DATABASE_URL=postgres://postgres:postgres@localhost:5443/kuruma`. (If gone: `docker start kuruma-531-pg` or recreate `postgres:16`, then `CREATE DATABASE kuruma;` + `db:migrate`.)
- **Test runner = vitest via filter** (NOT bunx-from-root): `bun run --filter @kuruma/api test -- <pattern>`, `bun run --filter @kuruma/shared test -- <pattern>`.
- Fresh worktree already had `bun install`. tsc: `bunx tsc --noEmit -p packages/<pkg>/tsconfig.json`.

## Plan = 6 TDD slices (issue body is the approved design w/ the decision matrix)

### DONE
- **Slice 1 — validators (commit `fe50cca`).** `packages/shared/src/validators/location.ts`: optional `latitude`/`longitude` on create/platform-admin/update, WGS84 bounds + finite-only, cross-field `coordPairIsComplete` refine (both-or-neither; rejects half-pair), `regeocode:true` on update. `coordinateSource` never client-accepted. Tests in `tests/validators/location.test.ts` (47 pass). Gotcha hit: `exactOptionalPropertyTypes` needs `| undefined` in the refine param type; drop `as const` on the refine `path`.
- **Slice 2 — schema + migration + plumbing (commit `6a3cb93`).** `coordinateSourceEnum` + `CoordinateSource` type + nullable `coordinate_source` column on `locations` (migration **`drizzle/0048_add_location_coordinate_source.sql`** — collides only with unmerged #394/#551 0048; renumber at merge). Threaded through `Location` (`packages/api/src/stores.ts`), both repos' `create`/`update` + `toLocation` + `locationColumns` (`repositories/{drizzle,in-memory}/location.ts`, `drizzle/shared.ts`), `repositories/types.ts` interface. Seed tags curated demo coords `GEOCODED` (`seed.ts`). Route still passes `latitude/longitude/coordinateSource: null` (placeholder). `db:verify` 4/4; api 115 affected tests pass.

### DONE (this session — slices 3-5)
- **Slice 3 — Geocoder port + `NominatimGeocoder` adapter (commit `cddfef5`).** Port `services/geocoding/types.ts` (`Geocoder.geocode -> {lat,lng}|null`, total/never-throws) + `nominatim-geocoder.ts` (jsonv2, limit 1, User-Agent, 4s `AbortSignal.timeout`; miss/non-OK/parse-fail/network/timeout → null). 8 fetch-stub tests.
- **Slice 4 — LocationService matrix + Slice 5 route+DI (commit `b765772`).** `Geocoder` is the 3rd ctor arg; `create`/`update` own the full #531 matrix (MANUAL pin wins + survives failed regeocode; changed non-manual address whose geocode fails CLEARS the stale pin; `coordinateSource` server-derived; `regeocode` stripped pre-write; geocode never blocks save). Route threads coords+regeocode. `index.ts` builds the geocoder at the composition root (real Nominatim only when `NOMINATIM_USER_AGENT` set, else null stub) behind `overrides.geocoder`. 20 matrix + DI tests (incl. fake-Geocoder swap proof via createApp).

<details><summary>Original TODO (now done) — kept for reference</summary>

- **Slice 3 — Geocoder port + `NominatimGeocoder` adapter.** New `packages/api/src/services/geocoding/`:
  - `types.ts`: `export interface Geocoder { geocode(address: string): Promise<{ lat: number; lng: number } | null> }`.
  - `nominatim-geocoder.ts`: `implements Geocoder`, ctor `(baseUrl, userAgent, fetchFn = fetch)`. GET `${baseUrl}/search?format=jsonv2&limit=1&q=<enc address>`, header `User-Agent` (app id + contact, OSMF policy), `signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS≈4000)`. Map first result `{lat:+r.lat, lng:+r.lon}`; empty array / non-ok / network / timeout (`TypeError`, `AbortError`, `TimeoutError` DOMException) → **return null, never throw**. No retries, ≤1 call (autocomplete forbidden). Mirror style of `services/email/resend-email-sender.ts`.
  - TDD with injected fake `fetchFn`: success maps lat/lon; empty→null; 500→null; timeout→null; sends User-Agent; single call.
- **Slice 4 — LocationService geocode-on-save matrix (the heart).** Inject `geocoder: Geocoder` as 3rd ctor arg of `LocationService` (`services/location.ts`). Implement the issue's decision matrix in `create` + `update`. Key rule = **stale-clear**: non-manual address changed + geocode fails/times out → coords cleared to **null + source null** (never leave a stale pin). MANUAL coords + unrelated edits → preserve. `regeocode:true` forces geocode of current address. `latitude:null+longitude:null` clears. Geocode never blocks save (treat throw/null as failure per matrix). One RED test per matrix row using success/failing/hanging fake geocoders. See the **"Denormalization Without Sync"** Learn note in the issue.
- **Slice 5 — route threading + DI wiring.** `routes/locations.ts`: stop hardcoding null — thread validated `latitude`/`longitude` into `service.create`, and `latitude`/`longitude`/`regeocode` into `service.update`. `index.ts`: build `const geocoder: Geocoder = ...` in the **production branch** (env `NOMINATIM_API_URL` default `https://nominatim.openstreetmap.org`, `NOMINATIM_USER_AGENT`), dev stub otherwise (returns null) — IIFE pattern like `emailSender` (~line 391); pass to `new LocationService(locationRepo, bookingRepo, geocoder)` (~line 579). Add a **fake-Geocoder DI test** proving provider swap touches only `index.ts` (create with address → GEOCODED coords in response).

</details>

## Final gates before PR
`bun run --filter @kuruma/shared test`, `bun run --filter @kuruma/api test`, integration tests (real DB on :5443), `db:verify` 4/4, `bun run --filter @kuruma/api lint:boundaries`, tsc shared+api+web, biome (pre-commit auto-runs lint-staged: biome + size + boundaries + web tsc — **format before commit** or the hook reverts).

## Ship
`/code-review` + `architect-review` → fix → commit → **merge base in** (`git fetch && git merge origin/marketplace-pivot`, resolve 0048 renumber if #394/#551 landed) → `gh pr create` (Closes #531, base `marketplace-pivot`) → close issue. Cleanup: worktree, `docker rm -f kuruma-531-pg`.
