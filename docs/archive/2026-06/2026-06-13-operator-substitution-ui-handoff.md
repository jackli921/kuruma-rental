# Handoff — Operator vehicle substitution UI (#610)

> **Screenshot step 8** (商家端 管理订单 → 故障车可换同店同级别车，系统留痕).
> The backend is **100% shipped**. This is a **web-only** slice that wires an existing
> endpoint into the trip-detail Actions panel. Estimated ~1 focused session.

Date: 2026-06-13 · Issue: #610 · Base: branch off `origin/marketplace-pivot`.

---

## TL;DR

An operator viewing a booking at `/<locale>/manage/bookings/:id` should be able to swap
a broken/unavailable car for **another car of the same class at the same store**. The
server already does all the validation + writes the audit event. You build: a write
client, a candidate-vehicle picker dialog, and wire it into the panel that is currently a
dashed placeholder. Gate it to real operators (bypass roles read-only).

## Backend contract — ALREADY BUILT, do not rebuild

| Piece | Location | Notes |
|---|---|---|
| Route | `packages/api/src/routes/bookings.ts:178` `POST /bookings/:id/substitute` | Operator-only (403 renter), cross-operator → 404 (no leak). |
| Body schema | `packages/shared/src/validators/booking.ts:46` `substituteVehicleSchema` | `{ newVehicleId: string, reason?: string }`. |
| Service | `packages/api/src/services/booking.ts` `substitute()` (~line 560) | One transaction. |
| Audit event | `VEHICLE_SUBSTITUTED` appended with `actorId = ctx.userId` | This **is** the 系统留痕; `BookingTimeline` already renders it. |

**Server validation (your candidate filter MUST mirror this or the POST 400s):**
- replacement must be the **same operator** (else 404),
- **same `pickupLocationId`** (else 400 "different pickup location"),
- **same ACRISS class** (`classId`) (else 400),
- replacement `status === 'AVAILABLE'` (else 400),
- booking status `CONFIRMED` or `ACTIVE` (else 409),
- replacement not already booked for the window → 409 (exclusion constraint, atomic).
- `requestedVehicleId` is never mutated (renter's original choice is preserved); only
  `assignedVehicleId` + a re-snapshotted `totalPrice` (locked insurance preserved, #429).

Result envelope: `ok(c, result.booking)` on success; `fail(c, error, status)` on the
400/404/409 paths above.

## Frontend gap (what you build)

`packages/web/src/routes/$locale/_business/manage/bookings/$bookingId.tsx` has:

```tsx
{/* Actions reserved for phase 2 (cancel / substitute / status). */}
<div className="rounded-xl border border-dashed border-border px-4 py-6">
  <h2 ...>{t('detail.actions')}</h2>
</div>
```

Replace the placeholder body with a working **Substitute vehicle** action.

### Data you already have on the page
- `detail` (a `BookingDto`, `vite/bookings/api.ts:12`) exposes `classId`, `pickupLocationId`,
  `assignedVehicleId`, `status` — everything needed to filter candidates.
- Queries already wired: `operatorBookingDetailQueryOptions(id)`, `bookingEventsQueryOptions(id)`.

### Candidate replacement list (no new endpoint needed)
Reuse `operatorFleetQueryOptions()` (`vite/operator-fleet/api.ts`, the operator-scoped
fleet-overview) and filter client-side:
```ts
candidates = fleet.filter(v =>
  v.status === 'AVAILABLE' &&
  v.classId === detail.classId &&
  v.pickupLocationId === detail.pickupLocationId &&
  v.id !== detail.assignedVehicleId)
```
Prefetch it in the route loader alongside the existing two queries (mirror the pattern
already in `fleet.tsx`'s `Promise.all` loader).

## Implementation plan (TDD, vertical)

1. **Write client** — add to `vite/operator-bookings/api.ts`:
   `substituteBooking(bookingId, newVehicleId, reason, csrfToken)` → `POST /bookings/:id/substitute`
   with `headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }`,
   `credentials: 'include'`, `unwrap()` the result. **Test first** (URL, method, body, CSRF header).
2. **SubstituteVehicleDialog** (`vite/operator-bookings/SubstituteVehicleDialog.tsx`) —
   Dialog (mirror `operator-fleet/FleetRowActions.tsx`'s dialog + `useMutation`): a
   `<select>`/radio of candidates (`name` + `licensePlate`), optional reason `<Textarea>`,
   submit → `useMutation` → on success invalidate the detail + events queries and close.
   Empty-candidate state ("no same-class vehicle available at this location"). **Test:**
   renders candidates, calls `substituteBooking` with the picked id + reason + csrf,
   invalidates on success, surfaces the 409/400 error message.
3. **Wire into the panel** — in `$bookingId.tsx`, read `sessionQueryOptions()` →
   `canWrite = isOperatorSession(session)`; render the action only when `canWrite`
   (bypass roles get read-only — the established #581/#583/#598 pattern) AND
   `detail.status === 'CONFIRMED' || 'ACTIVE'` (else show a disabled/explanatory state).
   Export the route component for testability (mirror #583/#598).
4. **i18n** — add keys under `bookings.operator.detail` (e.g. `substitute.action`,
   `substitute.dialogTitle`, `substitute.reasonLabel`, `substitute.noCandidates`,
   `substitute.submit`) in `messages/{en,ja,zh}.json`; keep `lint:i18n-parity` green.
5. **Route test** (`tests/vite/operator-bookings/...`) — operator sees the Substitute
   action; PLATFORM_ADMIN does not; terminal-status booking disables it. Seed `['session']`
   + the detail/events/fleet query keys (mirror `OperatorFleetRoute.test.tsx`).

## Patterns to copy
- CSRF write: `vite/operator-fees/api.ts` / `operator-insurance/api.ts` (the `X-CSRF-Token` thread).
- Dialog + mutation + invalidate: `vite/operator-fleet/FleetRowActions.tsx` (maintenance/retire dialogs).
- Read-only gating + route test seeding: `$locale/_business/manage/fleet.tsx` + `OperatorFleetRoute.test.tsx` (#598).

## Gotchas
- **CSRF is global** (`app.use('*', csrf())`); a cookie POST without `X-CSRF-Token` → 403.
- **Candidate filter must match server rules exactly** (class + location + AVAILABLE) or the
  POST 400s with a confusing message. Filter on the client so the operator never picks an invalid car.
- **The audit trail is automatic** — after a successful substitute, invalidating
  `bookingEventsQueryOptions(id)` makes the new `VEHICLE_SUBSTITUTED` row appear in the
  existing timeline. No timeline work needed.
- **`detail.assignedVehicleId` is the CURRENT car** — exclude it from candidates.

## Parallel / collision
- **#525** (live worktree `~/Dev/kuruma-525-operator-bookings`) is editing
  `operator-bookings/api.ts` + `useCalendarFilters.ts` — it is **NOT** touching
  `$bookingId.tsx`. You will both edit `operator-bookings/api.ts` (append-only addition is
  low-risk); rebase on `origin/marketplace-pivot` before pushing and re-check.
- Do not touch any other session's worktree.

## Verification (gates before PR)
- `bun run --filter @kuruma/web test -- --run tests/vite/operator-bookings/` green
- `bun run --filter @kuruma/web typecheck` 0 · `bun run lint:i18n-parity` (parity ×3)
- full `bun run --filter @kuruma/web test -- --run` (no regressions)
- pre-commit gate (biome + size + module-boundaries + tsc web×2 + api)
- PR → `marketplace-pivot`, body `Closes #610`. Non-default base → close manually if no auto-close.
