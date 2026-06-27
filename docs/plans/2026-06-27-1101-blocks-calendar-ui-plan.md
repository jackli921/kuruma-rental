# #1101 Slice B — vehicle-blocks operator-calendar UI (execution plan)

> Execution breakdown of design doc `2026-06-26-vehicle-blocks-calendar-design.md`
> steps 6–15. Slice A (read endpoint `GET /vehicle-blocks?from&to`) is merged
> (develop `cdb2fc37`, PR #1219). **Web UI only — no API, no migration.**
> Branch `feat/1101-blocks-calendar-ui` off develop. Feature: `vite/operator-bookings`.

## Backend contract (already live)

- **Read:** `GET /vehicle-blocks?from&to` → `VehicleBlock[]`, gated `MANAGEMENT_READ_ROLES`
  (RENTER/PARTNER → 403), range required (omitted → 400), row-scoped in the repo
  (admin: all operators; operator: own tenant; else none).
- **Write:** `POST /vehicles/:vehicleId/blocks` (201) + `DELETE /vehicles/:vehicleId/blocks/:blockId`,
  `FLEET_WRITE_ROLES`, operatorId server-derived from the vehicle. Hard delete.
- **Block JSON:** `{ id, operatorId, vehicleId, startAt, endAt, kind, reason, notes, createdBy, createdAt }`
  (ISO dates). `kind ∈ MAINTENANCE | OUT_OF_SERVICE | MANUAL`.
- **Create body** (`createVehicleBlockSchema`, `.strict()`): `{ kind, reason(1–500), startAt, endAt, notes? }`.

## Key design decisions

- **Discriminated `CalendarItem`** (design P1.2): `BookingCalendarEvent = CalendarEvent & {type:'booking'}`
  | `BlockCalendarEvent = {type:'block'; id; title; start; end; resourceId; kind; reason; notes}`. Every
  consumer (styling, filter, click) switches on `type`. Blocks carry `kind`, never `status`.
  **`reason`/`notes` ride on the event** (review #1) so the click handler hands `BlockDetailDialog` the
  whole item — no parallel `blockById` map to thread. `vehicleId = resourceId`; vehicle *name* the route
  resolves from its `vehicles` list. (`createdBy`/`createdAt`/`operatorId` stay off — design P2, YAGNI.)
- **DTO omits `createdBy`** (design P2): raw audit user id, not a display record (YAGNI).
- **Read vs write split** (mirrors existing `canManualBook`):
  - `canViewBlocks = isVisibleToViewer(isOperatorBlocksEnabled(), role)` → fetch + render blocks,
    open BlockDetailDialog. Platform-admin previews cross-operator (design §Risks).
  - `canManageBlocks = canViewBlocks && isOperatorSession(session)` → Schedule button + Delete.
    **Verified security crux (review #3):** `FLEET_WRITE_ROLES = BUSINESS_ROLES` *includes* `PLATFORM_ADMIN`,
    so the write API admits an admin (operatorId derived from the vehicle's tenant). `isVisibleToViewer` is
    explicitly NOT an authz boundary — so the web `canManageBlocks` gate is the *only* thing keeping an admin
    *preview* read-only. A canView/canManage mixup would expose a real cross-tenant mutation. Hence the
    explicit gate test below. **Admins are read-only this slice** (answers the open question — mirrors
    `canManualBook`, which already excludes them via `isOperatorSession`). "Admin picks an operator then
    manages" is the **operator-context-picker** track (`project_admin-operator-context-picker.md`), NOT this
    slice — `isOperatorSession`'s own doc-comment warns against reusing it to gate an admin-picks-tenant surface.
- **Slot-select precedence** (resolves the gesture conflict — both manual-booking and
  block-create want the empty-slot drag): manual-booking keeps the slot when `canManualBook`
  (zero regression); when manual-booking is OFF but `canManageBlocks`, the slot prefills
  ScheduleBlockDialog. The **Schedule block button** is always available under `canManageBlocks`,
  so blocks are creatable via button regardless. Satisfies "create via button AND slot-select".
- **Pure-logic extraction (FC/IS):** `blocksToCalendarEvents`, `calendarItemClassName(item)`, and
  the union-aware `filterEvents` are pure and unit-tested; `BookingsCalendar`/route stay thin shells.

## Sub-slices (TDD, vertical; order = dependency)

### B1 — data layer (`schema.ts`, `api.ts`)
- `calendarBlockSchema` DTO (NOT the existing `vehicleBlockSchema` = vehicle expansion `{name,photos}` —
  name clash, use `calendarBlockSchema`): `{ id, vehicleId, startAt, endAt, kind, reason, notes }`,
  `kind` from `VEHICLE_BLOCK_KINDS`, `notes` nullable. Infer `CalendarBlockRow`.
- `fetchCalendarBlocks(from, to)` → `GET /vehicle-blocks?from&to`, `unwrap(res, calendarBlockSchema.array())`.
- `operatorCalendarBlocksQueryOptions(from, to)` queryKey `['operator-bookings','blocks',from,to]`.
- `createBlock(vehicleId, input, csrf)` → POST (reuse a thin fetch, `unwrap(res, calendarBlockSchema)`);
  `deleteBlock(vehicleId, blockId, csrf)` → DELETE. Both invalidate `OPERATOR_BOOKINGS_KEY` at call sites.
- **Tests:** schema parses a block row + rejects a missing `kind`; query key shape.

### B2 — transforms + union (`calendar-events.ts`)
- Add `BookingCalendarEvent`, `BlockCalendarEvent`, `CalendarItem` types.
- Tag `toCalendarEvents` rows with `type:'booking'`.
- `blocksToCalendarEvents(blocks): BlockCalendarEvent[]` — `resourceId = vehicleId`, `start/end` from
  ISO, `title` from kind (i18n-resolved at the component; transform carries `kind`), carries `kind`,
  `reason`, `notes` (review #1 — the detail dialog reads them off the clicked item).
- **Tests:** booking rows tagged `'booking'`; block rows → `'block'` + correct
  `resourceId`/`kind`/`reason`/`notes`/window.

### B3 — filter (`useCalendarFilters.ts`)
- Widen `filterEvents` generic to the `CalendarItem` union: vehicle filter applies to all; **status
  filter applies only to `type==='booking'`** (a block is never hidden/shown by a status toggle).
- **Tests:** mixed `CalendarItem[]` — unchecking a status hides that booking, leaves every block;
  unchecking a vehicle hides both its booking and its block.

### B4 — calendar component (`BookingsCalendar.tsx`, `calendar-theme.css`)
- Props: `events: readonly CalendarItem[]`; `onSelectEvent: (item: CalendarItem) => void`.
- **Slot payload carries the clicked vehicle (review #2):** widen `onSelectSlot` to
  `(range: { start: Date; end: Date; resourceId?: string }) => void`; the adapter forwards
  `slot.resourceId` (rbc `SlotInfo.resourceId?: number|string`, set in day/TimeGrid views) coerced to
  string — undefined in week/month. Backward-compatible: manual-booking's handler ignores the extra field.
- `calendarItemClassName(item)` pure helper (in calendar-events.ts): booking → `STATUS_CLASS[status]`,
  block → per-`kind` band class (`block-kind-*`, muted/hatched, distinct from status colors).
- CSS: `.block-kind-maintenance/-out-of-service/-manual` neutral/hatched bands + legend strip.
- **Tests:** `calendarItemClassName` returns a status class for a booking, a kind class for a block.

### B5 — dialogs + route wiring + i18n
- `ScheduleBlockDialog.tsx` (new): vehicle picker (defaults to slot vehicle / first), kind `NativeSelect`,
  start/end JST datetime-local (mirror ManualBookingDialog conversion; vehicle defaults to the slot's
  `resourceId` when present, else first vehicle — review #2), reason, notes; validates against
  `createVehicleBlockSchema`; `useMutation(createBlock)` → invalidate `OPERATOR_BOOKINGS_KEY` + close;
  surfaces 409 as "overlaps an existing block". shadcn base-ui, `render` prop (no `asChild`).
- `BlockDetailDialog.tsx` (new): vehicle, kind, window, reason, notes (no `createdBy`); Delete + confirm
  (`useMutation(deleteBlock)` → invalidate + close) shown only when `canManageBlocks`.
- Route (`manage/bookings/index.tsx`): fetch blocks via `operatorCalendarBlocksQueryOptions` when
  `canViewBlocks` (own `useQuery`, NOT the suspense loader — degrade gracefully like vehicles);
  merge `toCalendarEvents` + `blocksToCalendarEvents` → `CalendarItem[]`; `handleSelectEvent` switches
  on `type` (booking → navigate, block → open BlockDetailDialog with the selected block); Schedule
  button under `canManageBlocks`; slot-select precedence per decision above.
- i18n: `blocks` namespace under `bookings.operator` in `messages/{en,ja,zh}.json` (kinds, dialog
  labels, legend, delete confirm, overlap error).
- **Tests:** click dispatch (block item → dialog state, booking item → navigate); slot-select on a
  resource-day forwards the clicked `resourceId` and the dialog defaults to that vehicle (review #2);
  ScheduleBlockDialog create round-trip (mocked api → invalidate); BlockDetailDialog delete round-trip;
  **feature-gate both halves** — flag-OFF + non-admin → no blocks/button; flag-OFF + PLATFORM_ADMIN →
  blocks visible. **Admin read-only regression (review #3):** flag-OFF + PLATFORM_ADMIN session
  (operatorId=null) → blocks render, but NO Schedule button AND BlockDetailDialog shows NO Delete action
  (pins `canViewBlocks=true` / `canManageBlocks=false`; a mixup would surface a working cross-tenant write).

## Acceptance (from design doc)

Block renders in the right vehicle column + window, visually distinct by kind, status filter leaves it
untouched; create via button + slot-select round-trip; click block → detail → delete refreshes; click
booking still navigates; read row-scope (operator own / admin cross / RENTER·PARTNER 403); whole layer
hidden unless `isVisibleToViewer(isOperatorBlocksEnabled(), role)`.

## Out of scope

Soft-edit/cancel of a block (delete + recreate); recurring blocks; advisory lock on the create race
(tiny at 1 operator / 40–50 cars, operationally recoverable); the #1100 timeline spike.
