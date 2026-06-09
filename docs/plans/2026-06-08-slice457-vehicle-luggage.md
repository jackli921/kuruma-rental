# Plan — #457: Vehicle luggage capacity (count + size) + result-card display

> Status: **DRAFT — awaiting review.** No code until D1–D5 confirmed.
> Issue: #457 (epic #385). Source: `docs/plans/2026-06-05-scope-update-du-kaku.md` §1.2.
> Branch: `feat/457-luggage` off `origin/marketplace-pivot`. Worktree: `~/Dev/kuruma-457-luggage`.

## Goal

Renters compare cars by luggage, not just seats. Two-layer model — **per-vehicle** luggage
(count + size) as primary, **class-level** default as fallback — surfaced on result cards.
Vertical slice: schema → validators → API → operator forms → renter cards → i18n.

## Design decisions (confirm on review)

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Size enum values | `SMALL \| MEDIUM \| LARGE` (simple, i18n-friendly; labels may read "Small (carry-on) / Medium / Large (suitcase)"). |
| D2 | Class-level size column | `vehicle_classes.luggageSize` **NOT NULL default `'MEDIUM'`** — class is the ultimate backup, must always resolve. Existing rows backfill to `'MEDIUM'`. |
| D3 | Vehicle-level columns | `vehicles.luggageCapacity` (int, **nullable**) + `vehicles.luggageSize` (enum, **nullable**). Blank → fall back to class. |
| D4 | Fallback granularity | Per-field: `count = vehicle.luggageCapacity ?? class.luggageCapacity`; `size = vehicle.luggageSize ?? class.luggageSize`. |
| D5 | Which "result cards" | Show luggage wherever seats show today: `ClassCatalogCard`, `ClassDetailView`, storefront-detail `AvailableVehicleCard`, booking `BookingVehicleSummary`. Class surfaces show class luggage; vehicle surfaces show resolved luggage. |
| D6 | Storefront **search** cards (class-summary badges) | **Include** luggage in `ClassSummaryBadges` (pulling class-level luggage), since the storefront search card is the primary surface renters compare on. Widens the storefront-search projection by 2 class cols. Alternative: explicitly exclude search cards and limit to catalog/detail/vehicle cards. |

## The model (`packages/shared/src/db/schema.ts`)

- New `luggageSizeEnum = pgEnum('luggage_size', ['SMALL','MEDIUM','LARGE'])` next to `transmissionEnum` (~:56).
- `vehicleClasses`: + `luggageSize: luggageSizeEnum('luggageSize').notNull().default('MEDIUM')` (count `luggageCapacity` already at :82).
- `vehicles`: + `luggageCapacity: integer('luggageCapacity')` (nullable) + `luggageSize: luggageSizeEnum('luggageSize')` (nullable), after `seats` (:118).
- Migration `0040_*`: `bun run db:generate --name vehicle_luggage` → `db:migrate` → `db:verify` (3 green).
  Rebase onto `origin/marketplace-pivot` immediately before generate so I own the journal tip
  (2026-04-17 out-of-order-journal gotcha). No other session holds a pending migration
  (#493 is a driver fix; #378 doesn't touch schema).

## Integration points (verified via exploration)

| Area | File:line | Change |
|------|-----------|--------|
| pgEnum | `schema.ts:56-65` | add `luggageSizeEnum` |
| class table | `schema.ts:71-106` | + `luggageSize` notNull default |
| vehicle table | `schema.ts:108-163` | + nullable `luggageCapacity` + `luggageSize` |
| vehicle validator | `validators/vehicle.ts:16-99` | create/update `.nullish()` luggage fields |
| class validator | `validators/vehicle-class.ts:7-34` | + `luggageSize` default |
| API projections | `api/.../drizzle/shared.ts:25-68` | add cols to `vehicleColumns` + `vehicleClassColumns` |
| **API create allowlists** (P2) | `api/.../drizzle/vehicle.ts:91`, `api/.../drizzle/vehicle-class.ts:64` | explicit insert allowlists — **must add new fields or created values silently drop** |
| **PATCH merge block** (P1) | `api/src/routes/vehicles.ts:153` | add nullable luggage to the update merge so submitting `null` clears the override (enables fallback) |
| storefront-detail vehicle projection | (resolve `vehicle ?? class`) | return resolved luggage |
| **Contract DTO mirrors** (P1) | `api/src/stores.ts:9` (VehicleClass), `shared/src/types/vehicle.ts:4`, `web/.../classes/api.ts:10` (VehicleClassData), `web/src/lib/vehicle-api.ts:7`, `web/.../storefronts/api.ts:38` | thread new fields through every mirrored contract or the UI never sees them |
| operator vehicle form | `web/.../components/vehicles/VehicleForm.tsx:139-156` | optional count + size after seats |
| operator class form | `web/.../classes/components/ClassForm.tsx:107-118` | size select after luggageCapacity |
| renter cards | `ClassCatalogCard.tsx:43-52`, `ClassDetailView.tsx:95-100`, `ClassRow.tsx:40`, storefront `AvailableVehicleCard.tsx:47`, booking `BookingVehicleSummary.tsx:33` | luggage next to seats (Briefcase icon) |
| search summary badges (D6) | `api/.../services/storefront-search.ts:16`, `web/.../storefronts/components/ClassSummaryBadges.tsx:15` | if D6=include: class luggage into the summary projection + a badge |

## Vertical-slice steps (TDD — one failing test → impl, commit each)

1. **shared — pure resolver + enum.** `resolveLuggage(vehicle, class) → {count, size}` (FC/IS pure core) + Zod `luggageSizeEnum`. Tests: vehicle wins; per-field fallback; both-null→class.
2. **shared — validators.** vehicle create/update gain `luggageCapacity`/`luggageSize` as `.nullish()`; class gains `luggageSize` (default). Tests: blank ok; bad enum rejected; partial PATCH doesn't wipe (the `.partial()+.default()` leak).
3. **schema + migration** (D2/D3) — generate/migrate/verify; add `luggageSize` to slice-8 class fixtures.
4. **api — projections, writes, contracts.** (a) columns into `shared.ts` projections; (b) **create allowlists** `drizzle/vehicle.ts:91` + `drizzle/vehicle-class.ts:64` (named checklist — easy to miss, silently drops create values); (c) **PATCH merge** `routes/vehicles.ts:153` so `null` clears the override; (d) storefront-detail vehicle projection resolves effective luggage; class summary returns size; (e) **thread the DTO mirrors**: `stores.ts:9`, `shared/types/vehicle.ts:4`, `web classes/api.ts:10`, `web lib/vehicle-api.ts:7`, `web storefronts/api.ts:38`. Integration tests: create persists luggage (allowlist guard); **clear vehicle luggage override → class fallback returns** (PATCH-null guard); projection row shape.
5. **web operator — forms.** `VehicleForm` optional count + size (`nullableNumber` pattern); `ClassForm` size select. Component tests.
6. **web renter — cards.** Luggage count + size next to seats on the D5 surfaces (`ClassCatalogCard`, `ClassDetailView`, `ClassRow`, `AvailableVehicleCard`, `BookingVehicleSummary`) + the D6 `ClassSummaryBadges` if included, reading resolved/class luggage. Component tests.
7. **i18n** — `luggage`, `luggageCount`, size labels (`SMALL/MEDIUM/LARGE`) × en/ja/zh; `lint:i18n-parity` green.

## Test plan

Unit (resolver, validators) · integration (projection shape; **create persists luggage** — allowlist guard;
**clear vehicle override → class fallback returns** — PATCH-null guard; write round-trip on a Neon branch) ·
component (forms accept/omit luggage; cards render resolved value) · i18n parity.
Full CI gate (lint, typecheck, boundaries, export-drift, fk-indexes, i18n-parity, unit, build,
db:verify) + code-reviewer + architect before PR.

## Risks / cross-session notes

- **#378 is concurrently porting these renter cards to Vite** (5d-2 vehicles done; 5d-3 search/storefronts next).
  I edit the **Next.js** trunk components (source of truth until the #378 cutover); #378 re-ports whatever
  exists. Leave a heads-up comment on #378 so the luggage field is carried over. No file-lock conflict (separate branches).
- Migration ordering — rebase right before `db:generate`.
- Commit at each slice step + print a resume handoff so the session can be `/clear`-ed mid-way (standing ask).

## Wrap-up

One PR `Closes #457` → `marketplace-pivot` (base is non-default → close #457 manually on merge).
Claim #457 with `in-progress` at kickoff; drop on completion.
