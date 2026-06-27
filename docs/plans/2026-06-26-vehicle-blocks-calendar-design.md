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

1. **Repo** — add `findOverlappingForOperator(operatorId, from, to): Promise<VehicleBlock[]>` to
   `VehicleBlockRepository` (`types-vehicle-block.ts`); implement in both `in-memory/vehicle-block.ts`
   (filter store by operatorId + half-open `[from,to)` overlap) and `drizzle/vehicle-block.ts`
   (`tstzrange(startAt,endAt) && tstzrange(from,to)` + `operatorId =`). Half-open; adjacent = no overlap
   (mirror existing `findOverlapping`).
2. **Service** — `VehicleBlockService.listBlocks(ctx, from, to)`: resolve operator scope using the **same
   read-scope resolver the operator calendar bookings read already uses** (not the write-scope helper), then
   call `findOverlappingForOperator(operatorId, from, to)`. Returns `VehicleBlock[]`. Verify the exact
   resolver name against the `GET /bookings` calendar handler during TDD; do not invent a second scoping path.
3. **Route** — `GET /blocks?from&to` (fleet-wide, root-mounted). Use `parseDateRange` from `routes/helpers.ts`
   for `from`/`to`; gate mirrors the operator calendar bookings read (`MANAGEMENT_READ_ROLES`). Returns
   `ok([...blocks])`. Wire in `index.ts`.
4. **Tests (TDD):** in-memory repo parity (operator isolation + overlap window); service operator-scope;
   route happy-path + cross-operator returns only caller's blocks + bad range → 400; real-pg range query.

## Slice B — web UI (own PR), extends `operator-bookings`

5. **`api.ts`** — `fetchCalendarBlocks(from, to)` → `GET /blocks?from&to`, parsed by `calendarBlockSchema`;
   `operatorCalendarBlocksQueryOptions(from, to)` (queryKey `['operator-bookings','blocks',from,to]`);
   `createBlock(vehicleId, input, csrf)` → POST; `deleteBlock(vehicleId, blockId, csrf)` → DELETE. Mutations
   invalidate `OPERATOR_BOOKINGS_KEY` (prefix cascade covers calendar + blocks).
6. **`schema.ts`** — `calendarBlockSchema` DTO (`id, vehicleId, startAt, endAt, kind, reason, notes, createdBy`).
7. **`calendar-events.ts`** — `blocksToCalendarEvents(blocks)`: map to react-big-calendar events keyed by
   `resourceId = vehicleId`, tagged `type: 'block'` + `kind`. Merge with booking events for one `events` array.
8. **`BookingsCalendar.tsx`** — render block bands distinctly (neutral/hatched background, per-kind color +
   icon, via `eventPropGetter`); add a legend; enable `selectable` so an empty-slot drag opens the create
   dialog prefilled with vehicle + range; `onSelectEvent` on a block opens the detail dialog. Whole blocks
   layer gated behind `isVisibleToViewer(isOperatorBlocksEnabled(), role)`.
9. **`ScheduleBlockDialog.tsx`** (new) — vehicle picker (defaults to slot vehicle), kind select, start/end,
   reason, notes; shadcn base-ui (no `asChild`); validates against the shared create schema; on success closes
   + invalidates. Surfaces 409 (block-vs-block overlap) as a friendly "overlaps an existing block" message.
10. **`BlockDetailDialog.tsx`** (new) — shows vehicle, kind, window, reason, notes, createdBy; Delete button
    + confirm (hard delete); on success closes + invalidates.
11. **i18n** — `blocks` namespace in `messages/{en,ja,zh}.json` (kinds, dialog labels, legend, errors).
12. **Tests:** transform unit (`blocksToCalendarEvents` styling/keys); dialog round-trip (create → invalidate,
    delete → invalidate) with mocked api; feature-gate hides the layer for a non-admin when flag OFF.

## Risks / notes

- **Scope resolution reuse:** `listBlocks` must use the *same* operator-scope resolver as the calendar
  bookings read so platform-admin and operator see a consistent fleet. Don't invent a second scoping path.
- **Visual disambiguation:** block bands must read as clearly *not bookings* (bookings are status-colored);
  use a muted/hatched treatment + kind icon + legend.
- **Feature-boundary lint (#1110):** keep all new files inside `operator-bookings`; export only through its
  barrel if anything is consumed elsewhere.
- **Create race:** schedule-during-checkout race is tiny at 1 operator / 40–50 cars and operationally
  recoverable (shows on calendar; operator substitutes) — no advisory lock in this slice (issue's "optional").

## Acceptance criteria

- Block renders on the operator calendar in the correct vehicle column + window, visually distinct by kind.
- Create via button (manual) and via slot-select (prefilled) both round-trip and refresh the calendar.
- Click a block → detail dialog → delete restores the slot (calendar refreshes).
- All block reads/writes operator-scoped (cross-operator never visible/mutable).
- Entire blocks layer hidden unless `isVisibleToViewer(isOperatorBlocksEnabled(), role)`.
