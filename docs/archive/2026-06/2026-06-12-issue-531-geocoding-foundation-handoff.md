# Handoff — #531 geocoding foundation (provider-neutral `Geocoder` port + capture location lat/lng on save)

> **For the next session. Start here, then read issue #531 (the authoritative spec).**
> Date: 2026-06-12 · Trunk: `marketplace-pivot` · Epic: #523 (operator portal) / #385 (MVP) / #378 (Vite)

## TL;DR

Claim **#531** and implement it TDD. It is the **operator-first foundation**: operators capture a storefront's coordinates so it appears on the search map, and search-by-location/map become possible. Plan was reviewed across 3 rounds and is **implementation-ready**.

**Approved by the owner:**
- **OSM/Nominatim** is the forward-geocoder for this slice (under the issue's OSMF constraints). Swap to Google later = one line in `index.ts`.
- **Scope is API/service/contract ONLY.** No UI. The operator location form (address input + manual pin) is **#529**, which depends on this. Do not spill into #529.
- **Migration:** regenerate against latest trunk and take the **next free number** (0048 is held by #394/#551, 0049 by #521 — so likely **0050**, but DO NOT hardcode; let `db:generate` assign it against current trunk to avoid the `_journal` out-of-order skip gotcha).

## Session-start protocol

1. `gh issue view 531`, then `gh issue edit 531 --add-label in-progress`.
2. Create your **own** worktree off trunk (never reclaim another session's):
   ```
   git worktree add ~/Dev/kuruma-531-geocoding -b feat/531-geocoding origin/marketplace-pivot
   cd ~/Dev/kuruma-531-geocoding && bun install
   ```
3. Bring up a fresh local Postgres (other sessions hold :5440–5442; pick a free port, e.g. :5443):
   ```
   docker run -d --name kuruma-531-pg -p 5443:5432 -e POSTGRES_PASSWORD=postgres postgres:16
   ```
   Point `DATABASE_URL` at it, then `bun run db:migrate && bun run db:verify` (expect 4/4 green) before touching schema.
4. Tests run via **vitest through the workspace filter** (NOT `bun test`, NOT `bunx vitest` from root):
   `bun run --filter @kuruma/api test` · `bun run --filter @kuruma/shared test`.

## Ground-truth file map (verified on `origin/marketplace-pivot`)

| Concern | File | Note |
|---|---|---|
| Locations schema | `packages/shared/src/db/schema.ts` (~L210–241) | `address` notNull; `latitude`/`longitude` `doublePrecision` **nullable** (mig 0045); `operatingHours`, `defaultTurnaroundMinutes` exist. **Add `coordinateSource` enum here.** |
| Validators | `packages/shared/src/validators/location.ts` (~L58–80) | `createLocationSchema` / `updateLocationSchema` — **do not accept coords yet.** Add them. |
| Validator tests | `packages/shared/tests/validators/location.test.ts` | |
| Route | `packages/api/src/routes/locations.ts` (~L87–94) | **hardcodes `latitude:null, longitude:null`** — remove; thread coords + `regeocode` to the service. |
| Service | `packages/api/src/services/location.ts` | `LocationService` — owns the write-decision matrix. Inject the `Geocoder` here. |
| Repos | `packages/api/src/repositories/{in-memory,drizzle}/location.ts` + `repositories/types.ts` | Persist `coordinateSource`. Service depends on the **interface** only. |
| Composition root | `packages/api/src/index.ts` | L579 `new LocationService(locationRepo, bookingRepo)` → add geocoder arg. L648 `createLocationRoutes(...)`. Mirror the **email DI block at ~L388** for env-gating; add `geocoder` to the test-overrides bag (alongside `locationRepo` etc.) so service/route tests inject a fake. |
| Read path (already done — do NOT touch) | `packages/api/src/services/flat-search.ts` `toResultLocation`; `packages/web/src/vite/search/SearchMapList.tsx` `geocodedByLocation` | Coords already thread to the map; null-coord rows are dropped. Once write side lands, operator pins appear automatically. |
| Service/route/integration tests (TDD homes) | `packages/api/tests/services/location.test.ts`, `tests/routes/locations.test.ts`, `tests/integration/locations.test.ts` | |

## TDD order (the approved sequence — one failing test at a time)

**Phase 1 — `Geocoder` port + `NominatimGeocoder` adapter** (`packages/api/src/services/geocoding/`)
- Port: `interface Geocoder { geocode(address: string): Promise<{ lat: number; lng: number } | null> }`. No `formattedAddress`/`precision` (address is authoritative; YAGNI).
- `NominatimGeocoder`: fetch with **`AbortSignal.timeout(GEOCODE_TIMEOUT_MS)`** (~4000ms), descriptive **User-Agent** (app id + contact), parse first result → `{lat,lng}`; return `null` on no-result/non-OK/parse-fail; let timeout reject (the service catches). RED tests with a stubbed `fetch`: happy parse, empty result → null, non-OK → null, **timeout → rejects within bound**.

**Phase 2 — validator + route contract** (`@kuruma/shared` then route)
- Add to create/update schemas: `latitude`/`longitude` optional, **finite**, lat `[-90,90]`, lng `[-180,180]`, **required as a pair** (both numbers OR both `null`; never one) via cross-field refine; `regeocode?: boolean` on update. **`coordinateSource` is NOT a client field** (server-derived).
- Route: remove the hardcoded nulls; pass `latitude/longitude/regeocode` through to the service. RED: schema accept/reject (bounds, finiteness, half-pair); route threads coords.

**Phase 3 — write-service decision matrix** (`LocationService.create`/`update`)
- Implement the matrix below. Geocode is **best-effort**: failure OR timeout never throws out of the write path; the location always persists. RED one row per test (8 rows).

**Phase 4 — DI / provider-swap proof** (`index.ts` + test)
- Construct `NominatimGeocoder` in `index.ts`; inject into `LocationService`; add to overrides. RED: a fake `Geocoder` injected via overrides drives the service in tests, proving the swap touches only `index.ts` (no schema/logic/component edits).

## Write-decision matrix (authoritative — mirror of issue #531)

`coordinateSource` enum (`GEOCODED | MANUAL`, nullable; null = no coords) is **server-derived, never client-writable**.

| Situation (create or update) | lat/lng result | coordinateSource |
|---|---|---|
| Explicit coord **pair** in request | stored as given | `MANUAL` |
| `latitude:null` + `longitude:null` (explicit clear) | null | null |
| source ≠ `MANUAL`, and (create OR **address changed** OR `regeocode:true`) → geocode **succeeds** | geocoded | `GEOCODED` |
| ...same precondition, geocode **fails / times out** | **null (cleared)** | **null** |
| source = `MANUAL` + `regeocode:true` → geocode **succeeds** | geocoded | `GEOCODED` |
| source = `MANUAL` + `regeocode:true` → geocode **fails / times out** | **preserved** (manual kept) | `MANUAL` |
| **Unchanged** address, unrelated edit (hours/turnaround/name) | preserved | preserved |
| source = `MANUAL`, address changed, no explicit coords / `regeocode` | preserved (manual wins) | `MANUAL` |

**Stale rule:** a changed **non-manual** address whose geocode fails → **clear** (old derived value would lie). A failed `regeocode` over **MANUAL** coords → **preserve** (manual is an explicit assertion, never stale; a transient outage must not destroy a known-good pin). To remove a manual pin, send the explicit `null` pair. (See memory `feedback_denormalization-without-sync`.)

## Constraints / architecture rules (must respect)

- **OSMF Nominatim policy** (https://operations.osmfoundation.org/policies/nominatim/): ≤1 req/s, descriptive User-Agent, attribution, cache. Geocode-on-save complies (low volume, persisted). **Autocomplete is forbidden on public Nominatim** — the future renter address-autocomplete is a SEPARATE adapter (not this slice).
- **Layering** (AGENTS.md): routes → services → repositories, never backwards. Routes import services + `routes/helpers.ts` (`ok`/`fail`/`parseBody`); services import repo **interfaces** (`types.ts`) only; **only `index.ts` constructs concretes**. Enforced by `bun run --filter @kuruma/api lint:boundaries`.
- `noUncheckedIndexedAccess` is on; no `any`; explicit return types on exports; `import type` for types.
- **Schema danger zone:** `bun run db:generate --name add_location_coordinate_source` → `db:migrate` → `db:verify` (4/4). Never edit merged migrations; let `db:generate` assign the number against current trunk.
- **No force-push** (hard-denied). Rebase via reset→cherry-pick→ff-push; clear BEHIND via `gh pr update-branch`. Use plain `rm` (not `rm -f`).

## Definition of done / gates

Run the full local gate before claiming green (CI mirrors it):
`bun run lint` · `bun run --filter @kuruma/api typecheck` + `--filter @kuruma/shared typecheck` · `lint:boundaries` · `db:verify` (4/4) · `bun run --filter @kuruma/api test` · `--filter @kuruma/shared test` · the `e2e-real-db` lane is a required check on mp (local postgres:16).

Then: push `feat/531-geocoding`, open PR → `marketplace-pivot` with `Closes #531`, request `/code-review`. Remember marketplace-pivot PRs don't auto-close (non-default base) — close #531 manually after merge, drop the `in-progress` label, clean up the worktree + docker.

## Acceptance criteria (from #531)

- Schemas accept an optional lat/lng pair with bounds + finiteness; route threads them; `coordinateSource` server-derived.
- Explicit coords → `MANUAL`; address-only create / `regeocode` / changed non-manual address → best-effort `GEOCODED`; that geocode failing/timing out → cleared.
- Manual coords + unrelated edits preserved; `regeocode` over manual: success → `GEOCODED`, failure → preserve.
- Geocoder failure or timeout never blocks save (bounded wall-clock).
- Provider swap touches only `index.ts` (fake-`Geocoder` DI test).
- Tests cover every matrix row + bounds-reject + pair-enforcement + server-derived source + bounded-timeout.
