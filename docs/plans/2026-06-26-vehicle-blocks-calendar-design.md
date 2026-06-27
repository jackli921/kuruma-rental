# Scheduled vehicle blocks on the operator calendar (#1101)

> Slice 2 of epic #1099 (operator calendar UX overhaul). Design doc.
> Status: approved 2026-06-26. Branch `feat/1101-blocks-calendar-ui` off develop `e877b6a1`.

## Context

The `vehicle_blocks` backend already shipped (#1142 table + block-vs-block `EXCLUDE`,
#1152 assign/substitute block-awareness, #1159 class-capacity subtraction). Availability
search and booking-overlap rejection already account for blocks, so two of the issue's
acceptance criteria are **already met**:

- Blocked vehicle excluded from `GET /availability` + storefront search.
- Booking overlapping a block → 409.

What remains for #1101 is making blocks **visible and manageable** on the operator
calendar — plus the one piece of backend the UI cannot work without: a **read endpoint**.

### What exists today (develop `e877b6a1`)

- **Write API:** `POST /vehicles/:vehicleId/blocks`, `DELETE /vehicles/:vehicleId/blocks/:blockId`
  (`packages/api/src/routes/vehicle-blocks.ts`). Hard delete, operator-scoped, server-derived `operatorId`.
- **Service:** `VehicleBlockService.createBlock` / `deleteBlock` (`services/vehicle-block.ts`).
- **Repo:** `VehicleBlockRepository` with `create` / `findById` / `findOverlapping(vehicleId, from, to)` / `delete`
  (`repositories/{in-memory,drizzle}/vehicle-block.ts`, iface `types-vehicle-block.ts`).
- **Validator:** `createVehicleBlockSchema` (`validators/vehicle-block.ts`) — `kind` ∈
  `MAINTENANCE | OUT_OF_SERVICE | MANUAL`, `reason` (1–500), `startAt`/`endAt` ISO, `notes?` ≤2000, `.strict()`.
- **Calendar surface:** `operator-bookings/BookingsCalendar.tsx` — react-big-calendar, day/week/month,
  vehicle resource columns; bookings fetched via `GET /bookings?from&to`, transformed in `calendar-events.ts`.
- **Feature flag:** `isOperatorBlocksEnabled()` (`config/features.ts`) — OFF by default; gate via
  `isVisibleToViewer(flag, role)` (`config/feature-visibility.ts`, platform-admin bypass per #1161).

### The gap

There is **no read/list endpoint** for blocks — only `findById` + per-vehicle `findOverlapping`.
The calendar shows the whole fleet, so it needs a fleet-wide range query.

## Scope

**In:** fleet-wide read endpoint; render blocks on the calendar; create (button + slot-select);
view/delete (click band → detail dialog); i18n; feature gating.

**Out (already shipped):** the table, EXCLUDE constraint, availability subtraction, booking guard.
**Out (YAGNI):** soft-cancel/edit of a block (delete + recreate); recurring blocks; the #1100
react-calendar-timeline spike (separate, unmerged).

**No migration** — read-only addition over existing schema.

## Slice A — backend read endpoint (own PR)

Vertical slice with standalone value: the fleet's blocks become queryable.

> **Scope contract first (review P1).** Blocks are operator-internal management data — never
> renter- or partner-facing — so unlike `GET /bookings` (open to all authed users, scoped in the repo)
> the blocks read is **gated to `MANAGEMENT_READ_ROLES`** (= `BUSINESS_ROLES`: PLATFORM_ADMIN + tenant
> operators; RENTER/PARTNER → 403 at the route). Within that gate the **row-scope is an explicit union**
> mirroring `bookingReadScope`'s admin/operator arms (minus partner/renter, which the gate already excludes):
> ```ts
> type VehicleBlockReadScope =
>   | { kind: 'all' }                         // PLATFORM_ADMIN (ctx.bypassScope) — cross-operator preview (#1161)
>   | { kind: 'operator'; operatorId: string } // OPERATOR_* with operatorId — own tenant only
>   | { kind: 'none' }                         // anyone else in-gate — fail-closed, read nothing
> ```

1. **Scope resolver** — add `vehicleBlockReadScope(ctx): VehicleBlockReadScope` in `tenancy.ts` beside
   `bookingReadScope`. **The resolver must be total over the gate's admitted set and fail closed** —
   `MANAGEMENT_READ_ROLES` (= `BUSINESS_ROLES`) admits legacy `STAFF`/`ADMIN` too, and #487 removed them
   from `SCOPE_BYPASS_ROLES`, so they pass the gate but are neither bypass nor `isOperatorRole`. Do **not**
   copy `operatorReadScope` (`tenancy.ts:36`, `!isOperatorRole → all`) — that catalog pattern would hand
   legacy admins a cross-tenant read. Explicit, fail-closed:
   ```ts
   if (ctx.bypassScope) return { kind: 'all' }
   if (isOperatorRole(ctx.role))
     return ctx.operatorId ? { kind: 'operator', operatorId: ctx.operatorId } : { kind: 'none' }
   return { kind: 'none' } // in-gate but neither bypass nor tenant (legacy STAFF/ADMIN): read nothing
   ```
   (RENTER/PARTNER never reach it — route-gated out.) Repo consumer keeps a `scope satisfies never` guard.
2. **Repo** — add `findOverlappingInRange(ctx, from, to): Promise<VehicleBlock[]>` to
   `VehicleBlockRepository` (`types-vehicle-block.ts`). Per the codebase convention (`in-memory/vehicle-class.ts`
   imports `operatorReadScope` and resolves scope **inside** the repo), the method takes `ctx` and calls
   `vehicleBlockReadScope(ctx)` itself: `all` → no operator filter; `operator` → `operatorId =`; `none` → `[]`
   (Drizzle: `sql\`false\``). Implement in both `in-memory/vehicle-block.ts` and `drizzle/vehicle-block.ts` with
   the half-open `tstzrange(startAt,endAt) && tstzrange(from,to)` overlap (adjacent = no overlap; mirror `findOverlapping`).
3. **Service** — `VehicleBlockService.listBlocks(ctx, from, to)`: thin delegation to
   `findOverlappingInRange(ctx, from, to)` (scope enforced in the repo). Returns `VehicleBlock[]`.
4. **Route** — `GET /vehicle-blocks?from&to` (fleet-wide collection read; top-level resource, clearer than a
   bare `/blocks` and unambiguous vs the `POST`/`DELETE /vehicles/:vehicleId/blocks` writes). Gate
   `MANAGEMENT_READ_ROLES.has(role)` else 403 (mirror `routes/maintenance-logs.ts:13`). The time window is the
   only bound (no limit/cursor), so make the range **required** — `parseDateRange(c, true)` → 400 when
   `from`/`to` are missing, so no caller can trigger an all-time fleet-wide (or cross-operator) dump.
   `ok([...blocks])`. Wire in `index.ts`.
5. **Tests (TDD):** repo `findOverlappingInRange` for each scope arm (in-memory + real-pg parity);
   **service-level scoping** — admin (`all`) sees blocks across two operators, operator sees only its own,
   operator-without-operatorId AND an in-gate non-bypass non-operator (legacy `STAFF`/`ADMIN`) both → `none`
   (empty); route — happy path, RENTER/PARTNER → 403, missing/bad range → 400.

## Slice B — web UI (own PR), extends `operator-bookings`

> **Discriminated calendar item (review P1.2).** The existing `CalendarEvent` smuggles "this is a booking"
> through `status` (`STATUS_CLASS[event.status]`, `BookingsCalendar.tsx:103`), `filterEvents`'s
> `{ resourceId; status }` constraint (`useCalendarFilters.ts:53`), and the route click handler treating
> every `id` as a booking id (`index.tsx:134`). Blocks have no `status`. So introduce an explicit discriminant
> rather than overloading the booking shape:
> ```ts
> type BookingCalendarEvent = CalendarEvent & { type: 'booking' }       // carries status
> type BlockCalendarEvent  = { type: 'block'; id; title; start; end; resourceId; kind } // carries kind, no status
> type CalendarItem = BookingCalendarEvent | BlockCalendarEvent
> ```
> Every consumer switches on `type` at the boundary: styling, filtering, and click dispatch.

6. **`api.ts`** — `fetchCalendarBlocks(from, to)` → `GET /vehicle-blocks?from&to`, parsed by `calendarBlockSchema`;
   `operatorCalendarBlocksQueryOptions(from, to)` (queryKey `['operator-bookings','blocks',from,to]`);
   `createBlock(vehicleId, input, csrf)` → POST; `deleteBlock(vehicleId, blockId, csrf)` → DELETE. Mutations
   invalidate `OPERATOR_BOOKINGS_KEY` (prefix cascade covers calendar + blocks).
7. **`schema.ts`** — `calendarBlockSchema` DTO: `id, vehicleId, startAt, endAt, kind, reason, notes`.
   **Omit `createdBy`** (review P2): it is a raw audit user id (`fleet.ts:250`), not a display record;
   surfacing it would need enrichment that isn't in this slice's scope (YAGNI).
8. **`calendar-events.ts`** — tag existing booking events `type: 'booking'`; add
   `blocksToCalendarEvents(blocks): BlockCalendarEvent[]` (keyed by `resourceId = vehicleId`, carrying `kind`,
   no `status`). The component merges both into one `CalendarItem[]`.
9. **`useCalendarFilters.ts`** — widen `filterEvents` to the `CalendarItem` union: the **status filter applies
   only to `type:'booking'` items**; blocks are filtered by vehicle (`resourceId`) only. Define this explicitly
   and test it — a status filter must never silently hide or show a block by accident.
10. **`BookingsCalendar.tsx`** — `eventPropGetter` switches on `type`: booking → `STATUS_CLASS[status]`,
    block → per-`kind` band class (neutral/hatched, distinct from status colors) + legend. `onSelectEvent`
    passes the **item** (not bare id) so the parent can dispatch by `type`. Enable `selectable` so an empty-slot
    drag opens the create dialog prefilled with vehicle + range. Whole blocks layer gated behind
    `isVisibleToViewer(isOperatorBlocksEnabled(), role)`.
11. **Route click dispatch (`bookings/index.tsx`)** — `handleSelectEvent` switches on `type`: `'booking'` →
    navigate to the booking detail (today's behavior); `'block'` → open `BlockDetailDialog`.
12. **`ScheduleBlockDialog.tsx`** (new) — vehicle picker (defaults to slot vehicle), kind select, start/end,
    reason, notes; shadcn base-ui (no `asChild`); validates against the shared create schema; on success closes
    + invalidates. Surfaces 409 (block-vs-block overlap) as a friendly "overlaps an existing block" message.
13. **`BlockDetailDialog.tsx`** (new) — shows vehicle, kind, window, reason, notes (no `createdBy`); Delete
    button + confirm (hard delete); on success closes + invalidates.
14. **i18n** — `blocks` namespace in `messages/{en,ja,zh}.json` (kinds, dialog labels, legend, errors).
15. **Tests:** transform unit (`blocksToCalendarEvents` keys/kind); **mixed `CalendarItem[]`** through
    `filterEvents` (status filter hides a booking but never a block) and `eventPropGetter` (block gets a
    kind class, booking a status class); **click dispatch** (block → dialog, booking → navigate); dialog
    round-trip (create/delete → invalidate) with mocked api; **feature-gate both halves** of
    `isVisibleToViewer` (`feature-visibility.ts:16` = `flag || isPlatformAdmin(role)`): flag-OFF + non-admin →
    hidden, AND flag-OFF + PLATFORM_ADMIN → visible (the admin-bypass half is the easy-to-regress one).

## Risks / notes

- **Row-scope is the contract, not the gate (review P1):** the role gate (`MANAGEMENT_READ_ROLES`) answers
  "may this caller enter"; the `VehicleBlockReadScope` union answers "which tenant's rows" — both are required.
  `all` (admin) is exercised by a test that seeds two operators and asserts cross-operator visibility, so
  admin preview can't silently break and an operator can't accidentally read another tenant.
- **Visual disambiguation:** block bands must read as clearly *not bookings* (bookings are status-colored);
  use a muted/hatched treatment + kind icon + legend.
- **Feature-boundary lint (#1110):** keep all new files inside `operator-bookings`; export only through its
  barrel if anything is consumed elsewhere.
- **Create race:** schedule-during-checkout race is tiny at 1 operator / 40–50 cars and operationally
  recoverable (shows on calendar; operator substitutes) — no advisory lock in this slice (issue's "optional").

## Acceptance criteria

- Block renders on the operator calendar in the correct vehicle column + window, visually distinct by kind
  (never mistaken for a booking), with a status filter that leaves blocks untouched.
- Create via button (manual) and via slot-select (prefilled) both round-trip and refresh the calendar.
- Click a block → detail dialog → delete restores the slot (calendar refreshes); clicking a booking still
  navigates to the booking detail.
- Read row-scope: operator sees only its own blocks; PLATFORM_ADMIN preview sees across operators; RENTER/
  PARTNER → 403. Writes remain operator-scoped (cross-operator never mutable).
- Entire blocks layer hidden unless `isVisibleToViewer(isOperatorBlocksEnabled(), role)`.
