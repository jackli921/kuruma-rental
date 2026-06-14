# Slice 6 (#392) — Task #8 (web booking flow) execution plan & handoff

**Resume here after `/clear`.** Worktree: `/Users/jack/Dev/kuruma-slice6`
Branch: `feat/slice6-booking-events` (ahead 21 / behind 2 of `origin/marketplace-pivot`).
Prereqs done: Task #1–#7 + #6.4 — 14 integration files (**156 tests**) green on Neon
`slice6-dev`, api unit/route suite **790** green. See `2026-06-04-slice6-handoff.md`.

## ⚠️ READ THE RIGHT PLAN FIRST
- **Authoritative spec = Draft v2 on `origin/docs/slice678-refresh`** (worktree
  `/Users/jack/Dev/kuruma-docs678`). The on-disk `docs/plans/2026-06-02-slice6-
  booking-event-log.md` cited below is **stale v1** — section numbers (§7/§8) and
  details may differ. Re-read v2 before coding.
- **#391 (slice 5) has MERGED** (2026-06-05) → the full renter-search→book E2E is
  now unblocked; you may build the complete Task #9 happy-path (not just
  form-onwards). Re-confirm the marketplace seed shape (default operator =
  Best Car Rental Osaka).
- **#413 merged** to marketplace-pivot (this branch is behind 2; rebase at PR time only).

## What Task #8 is
Rework the **renter** `bookings/new` + confirmation flow from the pre-pivot
**class-based** shape (#311) to the slice-6 **marketplace vehicle+insurance**
contract. Plan §7 step 8 + acceptance: form renders active operator insurance
options; confirmation renders selected insurance + each `feeSnapshot` row +
disclaimer; **empty snapshot renders no block (no empty heading)**.

## The contract (already shipped on this branch)
`shared/validators/booking.ts` `createBookingSchema`:
- `requestedVehicleId` (uuid, required) — server derives operatorId/classId/renterId
- `insuranceOptionId` (uuid, **optional**)
- `startAt`, `endAt` (ISO datetime; refine endAt > startAt)
- ⚠️ READ THE FULL SCHEMA FIRST — lines 13–20 not yet inventoried (possible
  optional `notes`/`idempotencyKey`/`source`). Do not assume.

## KEY FINDING — existing web flow is the wrong (legacy) shape
- `lib/bookings.ts` `createClassBooking()` POSTs `{classId, renterId, source:'DIRECT',
  idempotencyKey, startAt, endAt}` → **rejected** by the new schema (no such fields).
- `bookings/new/ClassBookingForm.tsx` is class+availability based, **no vehicle,
  no insurance**. `bookings/confirmation/page.tsx` looks up `fetchClassById`, shows
  no insurance / no fee snapshot. `getBookingById` returns a legacy `Booking`
  (classId/vehicleId/effectiveEndAt) with **no bookingCode / insuranceSnapshot /
  feeSnapshot / totalPrice**.
All three must be reworked. The class-based components may stay for the legacy
owner flow if still referenced — verify references before deleting (grandfather).

## Resolve these unknowns BEFORE coding (each is a `tsc`/contract dependency)
1. **API `GET /bookings/:id` response shape** on this branch — does it return
   `bookingCode`, assigned vehicle (name/photos), `insuranceSnapshot`,
   `feeSnapshot[]`, `totalPrice`? Read `packages/api/src/routes/bookings.ts` +
   the booking serializer/repo. The confirmation page renders from this.
2. **Slice-5 → 6 vehicle handoff.** How does a selected `requestedVehicleId`
   reach `bookings/new`? Check `modules/storefronts` detail page / `(renter)`
   routes for the vehicle-select control + nav state or query param. Plan §10.2:
   if slice 5 only lands a placeholder select, slice 6 wires the real submit.
3. **Renter insurance-options fetch.** `modules/insurance/{api,actions}.ts` —
   find/add a fetch for **active** options for the operator owning the vehicle.
   `hooks.ts` currently exposes only a mutation hook (CRUD), no list query.

## File-by-file plan (vertical, RED→GREEN per cycle, commit each)
1. **lib/bookings.ts** — add marketplace `createBooking({requestedVehicleId,
   insuranceOptionId?, startAt, endAt})` (server action) → POST /bookings; widen
   the confirmation fetch type to the §unknown-1 shape. Unit-test the action's
   request body + 409 mapping first.
2. **bookings/new** — new `BookingForm` (vehicle-based): date range (reuse
   `parseJstDateTimeLocal`), **insurance `<select>`** of active options (incl. a
   "no insurance" option → omit `insuranceOptionId`), submit → confirmation.
   RHF + zodResolver(createBookingSchema) mirroring Location/ClassForm patterns
   (3-param useForm, `errors`, no `as`). Tests: renders options, omits id when
   none, blocks invalid range, submits the marketplace body.
3. **bookings/confirmation** — render bookingCode + vehicle + selected insurance
   + **each feeSnapshot row + disclaimer**; **empty/again-null snapshot renders
   no block** (pure helper, unit-tested — FC/IS: decide-render in a pure fn).
4. **i18n** — extend `bookings.new` / `bookings.confirmation` namespaces (en + ja).
   New namespace ⇒ `rm -rf packages/web/.next && bun run dev` (CLAUDE.md i18n
   gotcha). Run `bun run lint:i18n-parity`.
5. **Task #9 E2E** (separate, HARD GATE): Playwright renter search → storefront →
   vehicle → book → confirmation shows code + vehicle + insurance + potential
   charges. Mock only OAuth callback (Resend is slice 7).

## Merge gate (plan §8) — all green before the DRAFT PR (#11)
`bun run test` · `bun run lint` · `bun run --filter @kuruma/api lint:boundaries`
· `bun run lint:modules` · `bun run db:verify` · **E2E happy-path (hard gate)** ·
code-reviewer + architect. `#392` stays OPEN; do not claim the E2E gate until
#391 has landed (it has — slice 5 merged — but re-confirm seed shape).

## Run commands (Neon gotcha)
Integration needs the **slice6-dev** branch, not production:
```
cd packages/api
export DATABASE_URL="$(grep -E '^DATABASE_URL=' ../../.env | head -1 | cut -d= -f2-)"
bunx vitest run --config vitest.integration.config.ts   # host MUST be ep-small-dawn-anzoxhc5
```
Web tests: `bun run --filter @kuruma/web test`. Typecheck gate:
`bun run --filter '*' typecheck`. Never force-push; rebase onto
`origin/marketplace-pivot` only at PR time (#11).
