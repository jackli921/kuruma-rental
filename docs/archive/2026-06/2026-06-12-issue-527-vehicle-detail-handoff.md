# Issue #527 — operator vehicle detail (Vite port) — handoff

**Status (2026-06-13):** ALL 3 COMMITS DONE + REBASED + CODE-REVIEWED. Worktree
`/Users/jack/Dev/kuruma-527-vehicle-detail`, branch `feat/527-vehicle-detail`,
REBASED onto `origin/marketplace-pivot` tip `14e053f` (branch tip `571e708`).
**Working tree clean, NOT pushed, NO PR yet.** Commit 3 (web UI) below is DONE.

## What's left (next agent starts here)
1. (Optional) `/code-review` — user-billed, NOT run by the agent; and/or architect-review.
2. Push (ff only, NO force — branch never pushed so first push is clean).
3. `gh pr create --base marketplace-pivot` with body `Closes #527`.
   Base ≠ default → on merge, MANUALLY close #527 + drop the in-progress label.
4. Manual browser smoke (not done): login `kanata.studio.dev@gmail.com`,
   open `/zh/manage/fleet`, click a vehicle → detail; check Edit + photos + back link.

Rebase note: trunk #596 (grid select-all) touched the SAME fleet files; git
auto-merged (its select-all + my locale/Link threading are orthogonal). Code
review (code-reviewer agent): authz airtight, no CRITICAL/HIGH — fixed 2 MEDIUM
(name-link target assertion; `'L'`→`'LARGE'` test fixture) + 1 LOW (clamp daily
utilization ≤24h). routeTree.gen.ts regenerated programmatically
(`{Generator,getConfig}` from `@tanstack/router-generator`, run from `packages/web`).
Gates green: web 1039 tests, tsc 0, biome, lint:size/modules, api boundaries.

---
## Original plan (Commit 3 now COMPLETE — kept for reference)

## Scope correction (important)
The endpoint was NOT "API-ready" as the original note claimed. `GET /vehicles/:id/detail`
was STAFF-only + tenant-UNSCOPED: operators got 403, and any STAFF could read another
tenant's vehicle (cross-tenant leak). Same class as #594/fleet-overview. So #527 is
**API + web**. The API fix is Commit 1 (done). Validated by a Plan agent against the code.

## Done
- **Commit 1 `ce8dc2d` (API security fix):** route `vehicle-detail.ts` admits
  `MANAGEMENT_READ_ROLES` (STAFF + OPERATOR_*; RENTER/PARTNER 403) + passes
  `toCallerContext(user)`; threaded `ctx` through service → `VehicleDetailRepository`
  interface → drizzle repo (`fetchVehicleRow` scoped via `operatorReadScope`: none→404,
  operator→`eq(vehicles.operatorId,...)`, all→no filter) → in-memory repo
  (`vehicleRepo.findById(ctx,...)`). Fixed 9 integration-test calls (+`SYSTEM_CONTEXT`).
  New route tests: operator-own 200, foreign-tenant 404, no-operatorId 404, PARTNER 403.
  Gates: api unit 1230 green, tsc 0, boundaries OK. (DB integration not run locally —
  no-op for SYSTEM_CONTEXT; CI integration lane validates.)
- **Commit 2 `bed87e6` (web data layer):** in `vite/operator-fleet/api.ts` added
  `VehicleDetailResponse` DTO (shared `VehicleDetail` over JSON, ISO-string dates),
  `fetchVehicleDetail(id)` (404→null), `vehicleDetailQueryOptions(id)` (key
  `['operator-fleet','detail',id]`), and `vehicleRowFromDetail(d)` adapter (maps catalog
  fields to `OperatorFleetVehicle`; stubs 5 fleet-overview-only fields the edit form never
  reads). Test `tests/vite/operator-fleet/api.test.ts` (7) green. Pre-commit gates pass.

## TODO — Commit 3 (web UI + routing)
Routing convention: NO `fleet.tsx` may coexist with a `fleet/` dir (it'd force a layout
Outlet). Mirror `manage/bookings/{index,$bookingId}.tsx`.

1. **Delete** `routes/$locale/_business/manage/fleet.tsx`; **create**
   `routes/$locale/_business/manage/fleet/index.tsx` = the SAME content (Route +
   `OperatorFleetRoute` + `OperatorFleetError`), but the route path becomes
   `/$locale/_business/manage/fleet/` and pass `locale={Route.useParams().locale}` to
   `<OperatorFleetView>`. URL is unchanged; Navbar/MobileMenu need NO edit (verified —
   `to="/$locale/manage/fleet"` still resolves, per bookings precedent in routeTree.gen).
   NOTE: `OperatorFleetRoute.test.tsx:1` imports `{ OperatorFleetRoute }` from
   `@/routes/.../manage/fleet` — update that import path to `.../manage/fleet/index`.
2. **Create** `routes/$locale/_business/manage/fleet/$vehicleId.tsx` — mirror
   `bookings/$bookingId.tsx`: loader `ensureQueryData(vehicleDetailQueryOptions(params.vehicleId))`,
   `if(!detail) throw notFound()`, `pendingComponent: PageSkeleton`, error component,
   renders `<VehicleDetail detail={detail} locale={locale} />` with a back `<Link to=
   "/$locale/manage/fleet">`. Behind `_business` (guard inherited).
3. **Create** `vite/operator-fleet/VehicleDetail.tsx` — port the frozen
   `app/[locale]/(business)/manage/vehicles/[id]/VehicleDetail.tsx` (135 lines): header
   (photo/name/`StatusPill` from `cells.tsx`/specs/rates), 4-card stats grid
   (utilization% / upcoming count+next / revenue30d / maintenance count), **calendar-lite**
   = compact upcoming-bookings list (`detail.upcomingBookings`) + a 30-day utilization
   strip (`detail.utilizationLast30Days`) — NOT react-big-calendar. Reuse Vite
   `PhotoUpload` (cookie-based). Edit affordance: local `useState` open + `<EditVehicleSheet
   vehicle={vehicleRowFromDetail(detail)} .../>`. i18n namespace `business.vehicles.detail`
   — ALL keys already exist in en/ja/zh (backToFleet, editVehicle, specs, seats,
   utilizationShort, upcomingShort, nextBookingShort, revenueLast30dShort,
   maintenanceHistory, noUpcomingBookings, source, renterName, photos, notFound, etc.). Use
   `formatJpy`/`formatDateTime` from `@/lib`. NO new i18n keys expected (none enforced by a
   parity test anyway — keep 3 locales in sync manually if you add any).
4. **Row → detail link (thread `locale`):** add `locale: string` prop to
   `OperatorFleetView` → pass to `FleetTable` + `FleetGrid` → `FleetGrid` passes to
   `FleetVehicleCard`. Wrap the vehicle NAME (`FleetTable.tsx:87`, `FleetVehicleCard.tsx:57`)
   in `<Link to="/$locale/manage/fleet/$vehicleId" params={{locale, vehicleId:v.id}}
   className="hover:underline">`. Keep it a real `<a>` (Link), not a button (a11y: nav=anchor).
   This is the bookings locale-as-prop convention (keeps components router-free/testable).
   Always-rendered (NOT behind `canWrite`) so read-only oversight roles reach it too.
5. **Update tests:** `OperatorFleetView.test.tsx` + `OperatorFleetRoute.test.tsx` — add
   `locale="en"` to the `<OperatorFleetView>` renders (and fix the import path in #1).
   Wrapping the name in a `<Link>` requires a router context in those tests — EITHER wrap
   renders in a memory router/`RouterProvider` stub, OR (simpler) make the name link
   degrade gracefully. Check how OperatorFleetView.test renders (no router today) before
   choosing; the bookings list test may show the lightest router-stub pattern.
6. **New tests (acceptance criteria):** `VehicleDetail.test.tsx` — render-with-data
   (specs/status/upcoming/utilization visible) + empty-bookings (shows `noUpcomingBookings`,
   zeroed stats). Guard is the `_business` layout (already covered by `tests/vite/guards.test.ts`);
   optionally add a `$vehicleId` route test asserting `notFound()` on null (mirror an existing
   route test). RouteTree regenerates automatically on `bun run dev`/build — don't hand-edit
   `routeTree.gen.ts`.

## Gates before commit/PR
`bun run --filter @kuruma/web test`, `--filter @kuruma/web typecheck`, biome. Pre-commit hook
runs biome + lint:size (index.ts hard cap 800) + boundaries + tsc(web+api). Then:
`gh pr create --base marketplace-pivot` body `Closes #527`. Base ≠ default → manual close +
drop in-progress label on merge. Run `/code-review` (user-billed) + architect-review.

## Conflict watch
Open PRs vs mp: #602 (#585 add-ons — touches messages/*.json + Navbar/MobileMenu + routeTree),
#593 (#519 oauth, API-only), #590 (#525 bookings — touches routeTree). Only real overlap is
auto-gen `routeTree.gen.ts` (regenerate) and possibly messages.json if #527 adds keys (it
shouldn't). Low risk. Live fleet worktrees (#526/#561) already merged — FleetTable/Grid stable.

## Verify locally (manual)
Dev DB was migrated this session (0051) via `bun --env-file=packages/api/.dev.vars run db:migrate`.
Seed/login: operator owner = `kanata.studio.dev@gmail.com` (DEMO_OWNER_EMAIL → Best Car Rental).
Open `/zh/manage/fleet`, click a vehicle → detail. Restart dev servers after pulling.
