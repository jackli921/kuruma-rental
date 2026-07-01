# Bookings calendar quick-view (hover-peek / click-pin)

Date: 2026-06-27
Status: Design — pending review
Area: `packages/web` operator bookings calendar (`/$locale/manage/bookings`)

## Problem

On the operator bookings calendar, the only way to see a booking's details is to
click an event and load the full-page trip-detail route (`.../$bookingId`). That is a
full navigation for what is usually a glance ("who, which car, when, how much?").
Scanning a week of bookings means a click-in / back / click-in loop.

## Goal

Surface a booking's key facts inline, without leaving the calendar:

- **Hover** an event chip → a transient preview card appears (a peek).
- **Click** an event chip → the same card **pins** (stays open when the mouse leaves).
- **Click outside / Esc** → the pinned card closes.
- **Click the card** → navigate to the full trip-detail page (for the actions/timeline
  that don't belong in a peek).

No new API calls: the card shows only data the calendar already has in hand.

## Non-goals

- No insurance / add-on / fee breakdown in the card (that stays on the detail page).
- No indicative multi-currency in the card (JPY only; detail page owns currency, #1070).
- No change to event chip colors, the toolbar, filters, or slot-click manual booking.

## Interaction model (per event chip)

Local state on each chip: `hovering`, `pinned`. Derived: `open = hovering || pinned`.

Transitions are driven by **named, reason-aware events** — never by a bare `open` boolean
(see the State Machine Ambiguity note below):

| Event (source) | Effect |
|---|---|
| `mouseenter` (after `HOVER_OPEN_DELAY_MS ≈ 120`) | `hovering = true` |
| `mouseleave` (cancels a pending open) | `hovering = false` |
| `onOpenChange(true, …)` — any trigger activation (click / Enter / Space) | `pinned = true` |
| `onOpenChange(false, reason ∈ {outside-press, escape-key, focus-out})` — a **dismiss** | `pinned = false`, `hovering = false` |
| `onOpenChange(false, reason = trigger-press)` — a toggle-close | **ignored** (clicking a chip only ever pins; it never closes its own card) |
| activate the card body (a `<Link>`) | navigate to detail page |

So a chip click **only ever pins**; the card is dismissed **only** by clicking away, Esc, or
focus leaving it. (Re-clicking the same chip does nothing — matching "clicking away closes",
not "re-click toggles".) Two cards may be visible at once (one pinned + one hovered) —
harmless and even useful for comparison, so no cross-chip coordination is needed; state
stays local to the chip.

**Key implementation subtlety (must be covered by a test):** the chip is a base-ui
`Popover` in **controlled** mode (`open = hovering || pinned`). base-ui's trigger toggles on
click and reports the change through `onOpenChange(open, eventDetails)` — and it can report
`open=false` for a `trigger-press`. A bare-boolean handler would let a hover-open click pin
and then immediately clear (library-event-order dependent). The handler therefore **branches
on `eventDetails.reason`**: any open-intent pins; only `outside-press` / `escape-key` /
`focus-out` dismiss; `trigger-press` closes are ignored. Hover is driven by our own
`mouseenter`/`mouseleave` handlers, **not** base-ui's `openOnHover`. (Confirm the exact
`reason` strings against the installed `@base-ui/react` version during implementation.)

> **Learn: State Machine Ambiguity.** When a component has multiple event sources (hover,
> click, outside-press, Esc), a generic `open: boolean` hides intent and lets library event
> ordering decide behavior — flaky UI. Heuristic: model transitions as named, reason-tagged
> events, not just `open: true/false`.

## Components (new — small, presentational, testable in isolation)

### `BookingQuickView.tsx`

The card. Pure render of in-hand fields; no state, no fetch.

- Props: the enriched event fields + `locale`.
- Renders: status (colored dot + label) · booking code, renter, vehicle, pickup–return,
  total. A trailing "View full details →" affordance.
- A **block `<Link>` wraps the card body inside the popup** (`<PopoverContent><Link
  className="block …">{fields}</Link></PopoverContent>`) — NOT the popup rendered as a Link.
  base-ui puts `role="dialog"` + `tabIndex={-1}` on the popup element, so rendering the popup
  itself as the Link (via `render`) would clone those onto the anchor — it would neither be
  exposed as a link nor be tabbable. An inner block Link keeps the whole card clickable *and*
  keyboard/AT-navigable (a real `<a>` with link role); the card has no nested interactive
  elements, so a card-wide link is valid.
- `to="/$locale/manage/bookings/$bookingId"`, `params={{ locale, bookingId: event.id }}`.
- Null-safe: missing vehicle → "—"; missing total → omit the total row.

### `CalendarEventChip.tsx`

The react-big-calendar custom event component (`components={{ event }}`).

- Receives rbc's `EventProps<CalendarEvent>`; uses `event`.
- Renders the chip title as the **`PopoverTrigger`** (a button filling the event box, so
  the whole chip is the hover/click target), and the `BookingQuickView` as the popup.
- Owns the `hovering`/`pinned` state machine above; receives `locale` as a prop.
- A pending-open timeout ref is cleared on `mouseleave` and unmount.

`locale` reaches the chip without a context: rbc only hands custom event components
`{ event, ... }`, so `BookingsCalendar` supplies `locale` by closing over it in the
`components` map — `event: (props) => <CalendarEventChip {...props} locale={locale} />` —
inside a `useMemo([locale])` so the map keeps a stable identity (an unstable `components`
object remounts every event on each render, dropping open cards). Simpler than a provider
and trivially testable.

## Data — no extra fetch

`CalendarBookingRow` already carries `bookingCode`, `renterName`, `totalPrice`, `vehicleId`;
vehicle **names** come from the fleet list the route already loads
(`operatorCalendarVehiclesQueryOptions`). So we enrich the event at transform time:

```ts
// calendar-events.ts
export interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  resourceId: string
  status: OperatorBookingStatus
  // --- new: in-hand fields the quick-view card needs (self-describing event) ---
  bookingCode: string
  renterName: string | null
  renterEmail: string | null   // carried so the card's renter line keeps the chip's fallback
  vehicleName: string | null   // resolved from the fleet map; null when unassigned
  totalPrice: number | null
}

export function toCalendarEvents(
  rows: readonly CalendarBookingRow[],
  vehicles: readonly { id: string; name: string }[],
): CalendarEvent[] {
  const nameById = new Map(vehicles.map((v) => [v.id, v.name]))
  return rows.map((r) => ({
    ...,
    bookingCode: r.bookingCode,
    renterName: r.renterName,
    renterEmail: r.renterEmail,
    vehicleName: r.vehicleId ? (nameById.get(r.vehicleId) ?? null) : null,
    totalPrice: r.totalPrice,
  }))
}
```

The event becomes self-describing (Tell-Don't-Ask): the chip needs no extra lookups to
render its card. The card's renter line mirrors the chip title's fallback —
`renterName ?? renterEmail` (→ "—" only when both are null) — so the card never shows blank
while the chip shows an email.

## Wiring changes

- **`index.tsx` (route):** `toCalendarEvents(bookings, vehicles)`. **Delete** `handleSelectEvent`
  and stop passing `onSelectEvent` — navigation now lives in the card's `<Link>`, so a chip
  click pins instead of navigating.
- **`BookingsCalendar.tsx`:** build the rbc `components` map in a `useMemo([locale])` —
  `{ toolbar: () => null, event: (props) => <CalendarEventChip {...props} locale={locale} /> }`
  — replacing the module-level `CALENDAR_COMPONENTS` const (it now depends on `locale`).
  Remove the `onSelectEvent` prop and `handleSelectEvent`. `eventPropGetter` (status color on
  the `.rbc-event` wrapper) and `onSelectSlot` (manual-booking) are untouched.

## Navigation is pin-first (deliberate)

Hover shows a **non-interactive peek**: because the card is portaled, the gap between chip
and card means moving the pointer toward the card fires `mouseleave` and closes it before the
pointer arrives. That is intended — to act on a booking you **click** the chip (which pins
the card), then click the pinned card to open the detail page. This matches the requested
flow ("hover to show … click to show the modal … click the modal to open the detail page").
We deliberately do **not** build a hoverable bridge / close-delay (the HoverCard pattern) —
it adds timing complexity for a peek that is read-only by design.

## i18n

**No new keys.** The card reuses existing `business.bookings.calendar` keys (verified present
in en / ja / zh): `viewFullDetails` for the affordance, and `sidebar.statuses.{CONFIRMED,
ACTIVE,COMPLETED,CANCELLED}` for the status label. The card carries **no per-field labels**
(renter / vehicle / dates / total render as plain values under the status + code header — a
peek, not a form), so there is nothing to translate. This supersedes an earlier draft that
proposed a `quickView` label block; it was dropped as unnecessary (YAGNI).

## Formatting

Use `packages/web/src/lib/format.ts` — **not** browser-local formatting:

- Price: `formatJpy(totalPrice)` (zero-decimal yen, e.g. `¥27,000`).
- Dates: `formatDateTime(date, locale)`, which is **pinned to `Asia/Tokyo`**. The card shows
  a range `formatDateTime(start, locale) – formatDateTime(end, locale)`. This matters: the
  business runs in Osaka, and browser-local formatting would shift a booking's pickup/return
  time for a non-JST operator (and make tests machine-dependent).

## Testing (TDD, vitest + testing-library, mutation-resistant)

1. **`calendar-events.test.ts` (extend):** `toCalendarEvents` attaches `bookingCode`,
   `renterName`, `renterEmail`, `totalPrice`; resolves `vehicleName` from the fleet map;
   `vehicleName` is `null` for an unassigned (class-only) booking.
2. **`BookingQuickView.test.tsx`:** renders code / renter / vehicle / formatted range /
   total; the card is a `<Link>` with `to` + `params.bookingId === event.id`; the renter
   line falls back to `renterEmail` when `renterName` is null (and "—" when both null);
   null vehicle renders "—"; null total omits the total row; the formatted time is JST
   (assert a fixed UTC instant renders its Tokyo wall-clock, machine-independent).
3. **`CalendarEventChip.test.tsx`** (chip rendered directly with a `locale` prop, not the
   full rbc grid; fake timers for the hover delay):
   - `mouseenter` → card appears after the delay; `mouseleave` before the delay → no card.
   - hover-open then `mouseleave` → card closes (not pinned).
   - click → card pins and **survives** a subsequent `mouseleave`.
   - **a second click on the pinned chip does NOT close it** (the reason-aware guard: a
     `trigger-press` close is ignored — this is the P1 regression test).
   - Esc / outside press while pinned → card closes.
4. **Wiring (extend the existing `BookingsCalendar` / route test):** assert the route enriches
   events via `toCalendarEvents(bookings, vehicles)` (a rendered event exposes its
   `vehicleName`), and that `BookingsCalendar` hands rbc a custom `components.event` (a chip,
   not rbc's default, renders for an event) — so the transform/card/chip units are actually
   connected, not just individually correct.

## Files

New: `BookingQuickView.tsx`, `CalendarEventChip.tsx`, `BookingQuickView.test.tsx`,
`CalendarEventChip.test.tsx`.
Modified: `calendar-events.ts`, `BookingsCalendar.tsx`, route `index.tsx`,
`messages/{en,ja,zh}.json`, `calendar-events.test.ts`, and the existing
`BookingsCalendar`/route wiring test. Reuses `lib/format.ts` (`formatDateTime`, `formatJpy`).
No new context module, API, schema, or migration changes.
