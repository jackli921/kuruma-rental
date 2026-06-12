# Handoff — #549 operator trip detail page + event timeline

**Date:** 2026-06-12 · **Status:** design APPROVED, implementation JUST STARTED (no code written yet).

## TL;DR

Replace the #548 booking **drawer** with a deep-linkable operator **trip detail page** at
`/manage/bookings/:id` (full reservation detail + vertical event timeline). The full,
reviewed plan — including the 3 review refinements — lives in **GitHub issue #549**. Read it
first; this file is just the resume pointer + verified facts so you don't re-explore.

## Where things are

- **Worktree:** `~/Dev/kuruma-549-trip-detail-page`
- **Branch:** `feat/549-trip-detail-page`, off `origin/marketplace-pivot` @ `a8cd5bb`. `bun install` done.
- **Nothing committed yet** (this handoff is the first commit). No source changed.
- Issue #549 has the canonical plan + slice breakdown + acceptance criteria.

## Resume

```bash
cd ~/Dev/kuruma-549-trip-detail-page
gh issue view 549            # the plan
# then start Slice 1 (below), TDD
```

## Slices (from #549 "Implementation slices (TDD, vertical)")

1. **API: role-gated `GET /bookings/:id/events`** ← START HERE (nothing written)
2. **API: `expand=vehicle,renter` on `GET /bookings/:id`** (enrich, don't replace the operator projection)
3. **Web: route split + code→`Link` + remove drawer** (regen + stage `routeTree.gen.ts`)
4. **Web: `BookingTimeline` + page composition + i18n** (en/ja/zh)
5. **Full gate + rebase + PR (Closes #549)**

## The 3 review refinements (already baked into #549 — keep them)

1. `/events` is **operator/management-only**: a role gate (renter → 403) **plus** the per-booking
   `findById` tenant check (operator A can't read B's events → 404). No sanitized renter DTO (YAGNI).
   See memory `feedback_role-gate-not-just-ownership`.
2. **Deterministic order** `createdAt ASC, id ASC` — add the `id` tiebreaker to the repo read.
3. `expand` **enriches** the existing `findById` operator projection, never replaces the operator block.

## Verified facts (don't re-explore)

**API runner:** `vitest run` (NOT bun:test). `packages/api/package.json` test script.

**Event repo:** `BookingEventRepository.findByBookingId(ctx, bookingId)` exists
(`packages/api/src/repositories/types.ts:417`; drizzle impl
`packages/api/src/repositories/drizzle/booking-event.ts:32`). Drizzle impl currently
`orderBy(asc(createdAt))` only → **add `asc(bookingEvents.id)` tiebreaker**. In-memory impl exists too.

**Service wiring (important):** `BookingService` constructor (`services/booking.ts:101`) does NOT
take the event repo directly — it reaches it via a `repos` bundle (`repos.bookingEventRepo.append`
at `booking.ts:490/593/658/705`). For the new **read** `findEvents`, thread the event repo the same
way the append sites get it (inspect how `repos` is passed into those methods), or add
`bookingEventRepo` to the constructor. Composition root wires it in `index.ts`
(InMemory at 228/339 → bundle 234/345; `new BookingService(...)` at 550).

**`findEvents` shape:** authorize via `findById(ctx, id)` (applies tenant read-scope; absent → 404),
then return `bookingEventRepo.findByBookingId(ctx, id)`.

**Route patterns:** `routes/bookings.ts` — `GET /bookings/:id` at line 67 (`service.findById`, no expand);
list `GET /bookings` at line 14 has the `expand` parsing to mirror for slice 2; the **role-gate
pattern** is at the substitute route (~line 140): `if (!isOperatorRole(ctx.role)) return fail(c, '…', 403)`.
For `/events` allow operator **and** platform-management roles (the set allowed into `/manage`).
Helpers in that file: `toCallerContext`, `requireUser`, `ok`, `fail`, `isOperatorRole`, `STAFF_ROLES`.

**Event types/payloads** (`packages/shared/src/db/booking-types.ts`):
`BOOKING_CREATED`/`BookingCreatedPayload`, `STATUS_CHANGED`/`StatusChangedPayload {from,to}`,
`VEHICLE_SUBSTITUTED`/`VehicleSubstitutedPayload` (has `reason`), `BOOKING_CANCELLED`/`BookingCancelledPayload`.
Enum: `bookingEventTypeEnum`. No schema/migration needed (`booking_events` +
`idx_booking_events_bookingId (bookingId, createdAt)` already exist).

**API test files to mirror:** `tests/routes/operator-user-isolation.test.ts` (role/isolation route),
`tests/integration/tenancy-isolation.test.ts` (cross-tenant), `tests/routes/bookings.test.ts`
(route role-gate), `tests/repositories/booking-event.test.ts` (add the ordering/id-tiebreaker test).
Slice-1 role-gate + ordering + tenant-isolation can be done with **in-memory repos via DI** — no real DB.

**Web (slices 3-4):**
- Current route to split: `packages/web/src/routes/$locale/_business/manage/bookings.tsx`
  → `manage/bookings/index.tsx` (list, unchanged) + `manage/bookings/$bookingId.tsx` (page).
- **Remove** `packages/web/src/vite/operator-bookings/OperatorBookingDetailSheet.tsx`
  + `tests/vite/operator-bookings/OperatorBookingDetailSheet.test.tsx` + the `onSelectBooking`
  state in `OperatorBookingsView.tsx` (code button becomes a typed `<Link>`).
- **Reuse** `OperatorBookingDetail.tsx` (pure panel from #548) as the page's left "Trip" column.
- Single-booking web client: `bookingByIdQueryOptions` already in `@/vite/bookings/api`
  (returns `BookingDto | null`, 404→null). Add `bookingEventsQueryOptions(id)` under
  `@/vite/operator-bookings`.
- Web tests: `packages/web/tests/` mirrors `src/`; vitest + happy-dom. For the page/timeline use
  the passthrough Sheet mock pattern only if needed; QueryClient `{ retry:false }` for fetch states
  (see `OperatorBookingDetailSheet.test.tsx` for the established pattern before you delete it — copy it).
- i18n: `packages/web/messages/{en,ja,zh}.json`, namespace `bookings.operator.*`; reuse
  `bookings.confirmation.fees.*` labels. **i18n parity test enforces all 3 locales** stay in sync.
- **Adding a route file requires `vite build` to regen `routeTree.gen.ts` BEFORE typecheck**, and
  the regenerated `routeTree.gen.ts` must be **staged in the commit**.

## Gotchas / workflow

- Fresh worktree: deps installed; run `bun run --filter @kuruma/web typecheck` to confirm baseline.
- **Rebase onto `origin/marketplace-pivot` before pushing** — concurrent sessions are live
  (#550/#552 open, #547 merged). **No force-push** (reset→cherry-pick→ff-push if needed).
- Full gate: `bun run --filter @kuruma/web typecheck` · web `test` · `bun run --filter @kuruma/api test`
  · integration · `build` · `bunx biome check` · i18n parity · `bun run lint:modules` · db-drift (no migration → green).
- biome import-sort is an **assist** action — fix with `bunx biome check --write`, not `format`.
- Issue #549 is claimed (`in-progress` label). On finish: PR `Closes #549`, drop label, remove worktree.

## SESSION 2 PROGRESS (2026-06-12) — resume here

Branch tip `63b075e`. Commits added this session (on top of `30b7c40` handoff):
1. `791e214` **Slice 1 DONE** — `GET /bookings/:id/events`, role-gated, with ordering + tenant tests.
2. `3a11c8b` **Slice 2 DONE** — `expand=vehicle,renter` on `GET /bookings/:id` (enriches, keeps operator block).
3. `63b075e` **Web data layer (part of Slice 3) DONE** — operator single-booking + events query clients.

**Gates green now:** api 1082 pass · web vitest (operator-bookings/api 17 pass) · api+web typecheck 0 · DI boundaries OK · lint:modules OK. NOT pushed. NOT rebased (branch is 1 behind origin/marketplace-pivot — rebase before push in Slice 5).

### Decisions/facts discovered this session (don't re-derive)
- **Role gate = `MANAGEMENT_READ_ROLES`** (middleware/auth.ts) = STAFF_ROLES ∪ OPERATOR_ROLES = the set allowed into `/manage`. RENTER → 403. Imported into `routes/bookings.ts`.
- **BookingService constructor gained `bookingEventRepo?` at position 8** (after `operatorRepo`, before `generateCode`/`verificationGate`). Composition root `index.ts` hoists `let bookingEventRepo` and wires it in all 3 branches (overrides / DB=`new DrizzleBookingEventRepository(db)` / in-memory) and passes it at arg 8 of `new BookingService(...)`. **The 2 positional `new BookingService(...)` call sites in `tests/services/booking.test.ts` were realigned** (insert `bookingEventRepo` before the generateCode arg) — if you add another call site, mind the new arg order.
- **Ordering tiebreaker:** ONLY the Drizzle repo got `asc(createdAt), asc(id)`. In-memory keeps its stable append-order sort (its existing test `booking-event.test.ts:37` asserts append order for same-ms events; sorting by random UUID id would flake it). Endpoint contract tested = "chronological by distinct timestamp."
- **OperatorBookingDetail panel is REUSED UNCHANGED** (its 10 tests untouched). It takes `row: OperatorBookingRow` + `booking: BookingDto`. The page has no list row, so `operatorRowFromDetail(dto)` (new, tested) derives the row from the expanded single read. `OperatorBookingDetailDto extends BookingDto` with `vehicle?`/`renter?`.
- **Typed `Link` `to` = fullPath `/$locale/manage/bookings/$bookingId`** (pathless `_business` is stripped from `to`, only in the `id`). params `{ locale, bookingId }`.
- Web Link mock pattern (mirror landing tests): `vi.mock('@tanstack/react-router', () => ({ Link: ({to,params,children,...rest}) => <a href={to} data-to={to} data-locale={params?.locale} {...rest}>{children}</a> }))`.
- Event payload union is NOT discriminated — timeline must `switch(event.type)` and treat `payload` as the matching shape (`StatusChangedPayload{from,to}`, `VehicleSubstitutedPayload{reason}`, `BookingCancelledPayload{cancellationFee}`).

### REMAINING
- **Slice 3 (rest):** route split `routes/$locale/_business/manage/bookings.tsx` → `bookings/index.tsx` (list, drop `selected` state + Sheet) + `bookings/$bookingId.tsx` (page). `OperatorBookingsView`: code button → typed `<Link to="/$locale/manage/bookings/$bookingId" params={{locale,bookingId:booking.id}}>`, drop `onSelectBooking` (update `OperatorBookingsView.test.tsx`: assert the link `to`/`bookingId` instead of the onSelect callback). **DELETE** `OperatorBookingDetailSheet.tsx` + its test. **Regen + STAGE `routeTree.gen.ts`** (run `vite build` BEFORE typecheck — typed Links resolve against the gen).
- **Slice 4:** `BookingTimeline.tsx` (+ test) vertical stepper oldest→newest from `bookingEventsQueryOptions`; compose `$bookingId.tsx` = loader prefetches `operatorBookingDetailQueryOptions(id)` + `bookingEventsQueryOptions(id)`, `notFound()` on null detail; left = OperatorBookingDetail (via `operatorRowFromDetail`), right = BookingTimeline, empty Actions placeholder (phase 2). i18n `bookings.operator.timeline.*` in en/ja/zh (parity test enforces all 3).
- **Slice 5:** full gate (web vitest · api test · integration · typecheck-all · build [regens routeTree] · biome · i18n parity · lint:modules · db-drift) → rebase onto origin/marketplace-pivot (no force) → push → PR `Closes #549` → drop in-progress label → remove worktree.

## Open product note (deferred, designed in #549)

Phase 2 = operator **action buttons** (cancel / substitute / start-complete) wired to existing
`POST /bookings/:id/cancel|substitute` + `PATCH /bookings/:id/status`, behind confirm dialogs,
invalidating booking+events queries on success. Layout reserves an empty "Actions" area for it. NOT this PR.
