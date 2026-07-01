# Bookings Calendar Quick-View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator see a booking's key facts inline on the calendar (hover to peek, click to pin a card, click the card to open the full detail page) instead of full-navigating on every event click.

**Architecture:** Each react-big-calendar (rbc) event renders a custom `CalendarEventChip` that owns a controlled base-ui `Popover`. Local `hovering`/`pinned` state drives `open`; transitions are reason-aware (a chip click only ever pins; only outside-press/Esc/focus-out dismiss). The popup is a `BookingQuickView` card rendered as a TanStack `<Link>` to the detail route. No new API calls — the calendar event is enriched at transform time with the fields it already has in hand.

**Tech Stack:** Vite + TanStack Router SPA, react-big-calendar, `@base-ui/react` v1.3.0 Popover, use-intl, vitest + @testing-library/react.

**Spec:** `docs/plans/2026-06-27-calendar-quickview-design.md`

**Prerequisite:** Work in a fresh worktree off `origin/develop` (branch `feat/calendar-quickview`); `bun install` first. Carry the spec + this plan into the branch. No route is added, so no `routeTree.gen.ts` regen is needed. Run web tests with `bunx vitest --root packages/web run <path>`.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `packages/web/src/vite/operator-bookings/calendar-events.ts` | enrich `CalendarEvent` + `toCalendarEvents(rows, vehicles)` | Modify |
| `packages/web/src/lib/event-colors.ts` | host the shared `STATUS_DOT` map (moved from `CalendarSidebar`) | Modify |
| `packages/web/src/vite/operator-bookings/CalendarSidebar.tsx` | import the shared `STATUS_DOT` (drop its local copy) | Modify |
| `packages/web/src/vite/operator-bookings/BookingQuickView.tsx` | pure card body (fields only, no Popover/Link) | Create |
| `packages/web/src/vite/operator-bookings/CalendarEventChip.tsx` | rbc custom event component: Popover + state machine + Link wrap | Create |
| `packages/web/src/vite/operator-bookings/BookingsCalendar.tsx` | wire `components.event` (memoized w/ locale); drop `onSelectEvent` | Modify |
| `packages/web/src/routes/$locale/_business/manage/bookings/index.tsx` | `toCalendarEvents(bookings, vehicles)`; drop navigate-on-click | Modify |
| `packages/web/tests/vite/operator-bookings/calendar-events.test.ts` | transform enrichment tests | Modify |
| `packages/web/tests/vite/operator-bookings/BookingQuickView.test.tsx` | card render + fallbacks + JST | Create |
| `packages/web/tests/vite/operator-bookings/CalendarEventChip.test.tsx` | hover/pin/dismiss + Link target | Create |
| `packages/web/tests/vite/operator-bookings/BookingsCalendar.test.tsx` | assert `components.event` wired; drop `onSelectEvent` | Modify |
| `packages/web/tests/vite/operator-bookings/OperatorBookingsRoute.test.tsx` | assert route enriches events with `vehicleName` | Modify |

No new i18n keys: the card reuses `business.bookings.calendar.viewFullDetails` and `business.bookings.calendar.sidebar.statuses.{STATUS}`, which already exist in en/ja/zh.

---

## Task 1: Enrich the calendar event transform

**Files:**
- Modify: `packages/web/src/vite/operator-bookings/calendar-events.ts:23-49`
- Test: `packages/web/tests/vite/operator-bookings/calendar-events.test.ts`

- [ ] **Step 1: Update the existing transform tests to the new shape (RED)**

Replace the first `describe('toCalendarEvents', …)` block (lines 29-53) with:

```ts
const fleet = [
  { id: 'veh-1', name: 'Toyota Aqua' },
  { id: 'veh-2', name: 'Nissan Note' },
]

describe('toCalendarEvents', () => {
  it('maps a row to an rbc event with the in-hand quick-view fields', () => {
    expect(toCalendarEvents([row()], fleet)).toEqual([
      {
        id: 'bk-1',
        title: 'Jane',
        start: new Date('2026-07-01T01:00:00.000Z'),
        end: new Date('2026-07-03T02:00:00.000Z'),
        resourceId: 'veh-1',
        status: 'CONFIRMED',
        bookingCode: 'ABCD2345',
        renterName: 'Jane',
        renterEmail: 'jane@example.com',
        vehicleName: 'Toyota Aqua',
        totalPrice: 24000,
      },
    ])
  })

  it('titles by renterEmail when the name is null, then by bookingCode when both are null', () => {
    expect(toCalendarEvents([row({ renterName: null })], fleet)[0]!.title).toBe('jane@example.com')
    expect(
      toCalendarEvents([row({ renterName: null, renterEmail: null })], fleet)[0]!.title,
    ).toBe('ABCD2345')
  })

  it('resolves vehicleName from the fleet map and is null for an unassigned booking', () => {
    expect(toCalendarEvents([row({ vehicleId: 'veh-2' })], fleet)[0]!.vehicleName).toBe('Nissan Note')
    expect(toCalendarEvents([row({ vehicleId: null })], fleet)[0]!.vehicleName).toBeNull()
    expect(toCalendarEvents([row({ vehicleId: null })], fleet)[0]!.resourceId).toBe('')
  })

  it('is null for a vehicleId absent from the fleet map (deleted car)', () => {
    expect(toCalendarEvents([row({ vehicleId: 'gone' })], fleet)[0]!.vehicleName).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest --root packages/web run tests/vite/operator-bookings/calendar-events.test.ts`
Expected: FAIL — `toCalendarEvents` takes 1 arg / events lack `bookingCode` etc.

- [ ] **Step 3: Enrich the interface and transform (GREEN)**

In `calendar-events.ts`, extend the interface (after line 31, inside `CalendarEvent`):

```ts
  status: OperatorBookingStatus
  // --- in-hand fields the quick-view card renders (self-describing event) ---
  bookingCode: string
  renterName: string | null
  renterEmail: string | null
  vehicleName: string | null
  totalPrice: number | null
}
```

Replace `toCalendarEvents` (lines 40-49) with:

```ts
export function toCalendarEvents(
  rows: readonly CalendarBookingRow[],
  vehicles: readonly { id: string; name: string }[],
): CalendarEvent[] {
  const nameById = new Map(vehicles.map((v) => [v.id, v.name]))
  return rows.map((r) => ({
    id: r.id,
    title: r.renterName ?? r.renterEmail ?? r.bookingCode,
    start: new Date(r.startAt),
    end: new Date(r.effectiveEndAt),
    resourceId: r.vehicleId ?? '',
    status: r.status,
    bookingCode: r.bookingCode,
    renterName: r.renterName,
    renterEmail: r.renterEmail,
    vehicleName: r.vehicleId ? (nameById.get(r.vehicleId) ?? null) : null,
    totalPrice: r.totalPrice,
  }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest --root packages/web run tests/vite/operator-bookings/calendar-events.test.ts`
Expected: PASS (all `toCalendarEvents`, `fleetToResources`, `calendarRange`, parse tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/operator-bookings/calendar-events.ts \
        packages/web/tests/vite/operator-bookings/calendar-events.test.ts
git commit -m "feat(calendar): enrich calendar events with in-hand quick-view fields"
```

---

## Task 2: Promote the shared `STATUS_DOT` map

`CalendarSidebar.tsx` already defines a `STATUS_DOT` color map (lines 21-26) identical to what the card needs. Don't duplicate it — move it to `event-colors.ts` (beside `STATUS_CLASS`) so the sidebar swatch and the card dot are one source, then point both at it.

**Files:**
- Modify: `packages/web/src/lib/event-colors.ts`
- Modify: `packages/web/src/vite/operator-bookings/CalendarSidebar.tsx:21-26`

No new test (a static color map; the sidebar's existing tests still pass since output is unchanged, and the card test asserts the status label).

- [ ] **Step 1: Add the shared `STATUS_DOT` to `event-colors.ts`**

Append to `event-colors.ts`:

```ts
// Tailwind dot color per status, shared by the calendar sidebar swatch and the
// quick-view card dot. Tracks STATUS_CLASS / calendar-theme.css so a status's
// color homes change together.
export const STATUS_DOT: Record<BookingStatus, string> = {
  CONFIRMED: 'bg-blue-500',
  ACTIVE: 'bg-green-500',
  COMPLETED: 'bg-gray-400',
  CANCELLED: 'bg-red-500',
}
```

- [ ] **Step 2: Point `CalendarSidebar` at the shared map**

In `CalendarSidebar.tsx`, delete the local `STATUS_DOT` const (lines 19-26) and import it instead. Add to the existing imports:

```ts
import { STATUS_DOT } from '@/lib/event-colors'
```

- [ ] **Step 3: Verify the move typechecks (no behavior change)**

There is no `CalendarSidebar.test.tsx`, and the web Vitest config has no `passWithNoTests`, so don't target a per-file test here. Just typecheck:

Run: `bunx tsc --noEmit -p packages/web/tsconfig.json`
Expected: clean — `CalendarSidebar` resolves the imported `STATUS_DOT`, no unused-const error. The map value is unchanged, so the sidebar render (exercised by `OperatorBookingsRoute.test.tsx`) is unaffected; the full suite in Task 7 confirms it.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/event-colors.ts \
        packages/web/src/vite/operator-bookings/CalendarSidebar.tsx
git commit -m "refactor(calendar): promote shared STATUS_DOT map to event-colors"
```

---

## Task 3: `BookingQuickView` card

**Files:**
- Create: `packages/web/src/vite/operator-bookings/BookingQuickView.tsx`
- Test: `packages/web/tests/vite/operator-bookings/BookingQuickView.test.tsx`

- [ ] **Step 1: Write the failing test (RED)**

```tsx
import { BookingQuickView } from '@/vite/operator-bookings/BookingQuickView'
import type { CalendarEvent } from '@/vite/operator-bookings/calendar-events'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'bk-1',
  title: 'Jane Doe',
  start: new Date('2026-07-01T01:00:00.000Z'), // 10:00 JST
  end: new Date('2026-07-03T02:00:00.000Z'), // 11:00 JST
  resourceId: 'veh-1',
  status: 'ACTIVE',
  bookingCode: 'ABCD2345',
  renterName: 'Jane Doe',
  renterEmail: 'jane@example.com',
  vehicleName: 'Toyota Aqua',
  totalPrice: 24000,
  ...over,
})

function renderCard(over: Partial<CalendarEvent> = {}) {
  render(
    <IntlProvider locale="en" messages={en}>
      <BookingQuickView event={event(over)} locale="en" />
    </IntlProvider>,
  )
}

describe('BookingQuickView', () => {
  it('shows status label, code, renter, vehicle, total, and the view-details affordance', () => {
    renderCard()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('ABCD2345')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
    expect(screen.getByText('¥24,000')).toBeInTheDocument()
    expect(screen.getByText(/View full details/)).toBeInTheDocument()
  })

  it('formats the time range in JST regardless of the host timezone', () => {
    renderCard()
    // 01:00Z..02:00Z render as 10:00..11:00 Asia/Tokyo (machine-independent).
    expect(screen.getByText(/10:00/)).toBeInTheDocument()
    expect(screen.getByText(/11:00/)).toBeInTheDocument()
  })

  it('falls back to renterEmail then "—" for the renter line', () => {
    renderCard({ renterName: null })
    expect(screen.getByText('jane@example.com')).toBeInTheDocument()
  })

  it('shows "—" for an unassigned vehicle and omits the total when null', () => {
    renderCard({ vehicleName: null, totalPrice: null })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/¥/)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest --root packages/web run tests/vite/operator-bookings/BookingQuickView.test.tsx`
Expected: FAIL — module `BookingQuickView` not found.

- [ ] **Step 3: Implement the card (GREEN)**

```tsx
import { STATUS_DOT } from '@/lib/event-colors'
import { formatDateTime, formatJpy } from '@/lib/format'
import type { CalendarEvent } from '@/vite/operator-bookings/calendar-events'
import { useTranslations } from 'use-intl'

interface BookingQuickViewProps {
  readonly event: CalendarEvent
  readonly locale: string
}

// Pure presentational card body for the calendar quick-view. No Popover, no Link
// (the chip wraps it) — so it renders standalone and tests with just an IntlProvider.
export function BookingQuickView({ event, locale }: BookingQuickViewProps) {
  const t = useTranslations('business.bookings.calendar')
  const renter = event.renterName ?? event.renterEmail ?? '—'

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block size-2 shrink-0 rounded-full ${STATUS_DOT[event.status]}`}
          aria-hidden
        />
        <span className="font-medium">{t(`sidebar.statuses.${event.status}`)}</span>
        <span className="ml-auto text-muted-foreground">{event.bookingCode}</span>
      </div>
      <div>{renter}</div>
      <div className="text-muted-foreground">{event.vehicleName ?? '—'}</div>
      <div className="text-muted-foreground">
        {formatDateTime(event.start, locale)} – {formatDateTime(event.end, locale)}
      </div>
      {event.totalPrice != null && <div className="font-medium">{formatJpy(event.totalPrice)}</div>}
      <div className="mt-1 font-medium text-primary">{t('viewFullDetails')} →</div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest --root packages/web run tests/vite/operator-bookings/BookingQuickView.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/operator-bookings/BookingQuickView.tsx \
        packages/web/tests/vite/operator-bookings/BookingQuickView.test.tsx
git commit -m "feat(calendar): BookingQuickView card (in-hand fields, JST, status dot)"
```

---

## Task 4: `CalendarEventChip` (Popover + reason-aware state machine)

**Files:**
- Create: `packages/web/src/vite/operator-bookings/CalendarEventChip.tsx`
- Test: `packages/web/tests/vite/operator-bookings/CalendarEventChip.test.tsx`

The single trickiest unit. The state machine (from the spec):
- `open = hovering || pinned`.
- `mouseenter` → after `HOVER_OPEN_DELAY_MS` → `hovering = true`; `mouseleave` → cancel + `hovering = false`.
- chip `onClick` → `pinned = true` (covers click + keyboard Enter/Space on the button). Pinning via `onClick`, **not** via `onOpenChange(true)`, so a hover-open card *pins* on click instead of base-ui toggling it shut.
- `onOpenChange(false, reason)` → dismiss (clear both) **only** when `reason ∈ {outside-press, escape-key, focus-out}`; a `trigger-press` close is ignored.
- The popup keeps its own `role="dialog"`; a **block `<Link>` inside** it wraps the card (do NOT render the popup itself as the Link — base-ui puts `role="dialog"` + `tabIndex={-1}` on the popup element, and `render` would clone those onto the `<Link>`, so it would neither expose as a link nor be tabbable). `initialFocus={false}` on the popup so a hover-open never steals focus; the inner `<Link>` stays keyboard-reachable by Tab.

- [ ] **Step 1: Write the failing test (RED)**

```tsx
import { CalendarEventChip } from '@/vite/operator-bookings/CalendarEventChip'
import type { CalendarEvent } from '@/vite/operator-bookings/calendar-events'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Stub the TanStack Link as a plain anchor exposing its target + carried params,
// so the chip renders without a RouterProvider (mirrors SearchResultRow.test.tsx).
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')),
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: { locale?: string; bookingId?: string }
    children: ReactNode
  }) => (
    <a href={to} data-to={to} data-locale={params?.locale} data-bookingid={params?.bookingId} {...rest}>
      {children}
    </a>
  ),
}))

const event: CalendarEvent = {
  id: 'bk-1',
  title: 'Jane Doe',
  start: new Date('2026-07-01T01:00:00.000Z'),
  end: new Date('2026-07-03T02:00:00.000Z'),
  resourceId: 'veh-1',
  status: 'ACTIVE',
  bookingCode: 'ABCD2345',
  renterName: 'Jane Doe',
  renterEmail: 'jane@example.com',
  vehicleName: 'Toyota Aqua',
  totalPrice: 24000,
}

// rbc passes EventProps; the chip only reads `event` + the injected `locale`.
function renderChip() {
  render(
    <IntlProvider locale="en" messages={en}>
      {/* biome-ignore lint/suspicious/noExplicitAny: rbc EventProps stub */}
      <CalendarEventChip {...({ event } as any)} locale="en" />
    </IntlProvider>,
  )
  return screen.getByRole('button', { name: /Jane Doe/ })
}

const card = () => screen.queryByText('Toyota Aqua') // unique to the open card

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('CalendarEventChip', () => {
  it('opens a transient card on hover after the delay', () => {
    const trigger = renderChip()
    expect(card()).toBeNull()
    fireEvent.mouseEnter(trigger)
    act(() => vi.advanceTimersByTime(120))
    expect(card()).toBeInTheDocument()
  })

  it('does not open if the pointer leaves before the delay', () => {
    const trigger = renderChip()
    fireEvent.mouseEnter(trigger)
    act(() => vi.advanceTimersByTime(60))
    fireEvent.mouseLeave(trigger)
    act(() => vi.advanceTimersByTime(120))
    expect(card()).toBeNull()
  })

  it('closes a hover-opened card when the pointer leaves (not pinned)', () => {
    const trigger = renderChip()
    fireEvent.mouseEnter(trigger)
    act(() => vi.advanceTimersByTime(120))
    fireEvent.mouseLeave(trigger)
    expect(card()).toBeNull()
  })

  it('pins on click so the card survives a subsequent mouseleave', () => {
    const trigger = renderChip()
    fireEvent.click(trigger)
    expect(card()).toBeInTheDocument()
    fireEvent.mouseLeave(trigger)
    expect(card()).toBeInTheDocument()
  })

  it('does not close a pinned card on a second chip click (reason-aware guard)', () => {
    const trigger = renderChip()
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(card()).toBeInTheDocument()
  })

  it('dismisses a pinned card on Escape', () => {
    const trigger = renderChip()
    fireEvent.click(trigger)
    expect(card()).toBeInTheDocument()
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' }))
    expect(card()).toBeNull()
  })

  it('dismisses a pinned card on an outside click', () => {
    const trigger = renderChip()
    fireEvent.click(trigger)
    expect(card()).toBeInTheDocument()
    // base-ui's mouse outsidePress defaults to `intentional` — it dismisses on a
    // real outside *click*, not a bare pointerdown, so drive a click on the body.
    act(() => fireEvent.click(document.body))
    expect(card()).toBeNull()
  })

  it('renders the card as a Link (inside the popup) to the booking detail route', () => {
    const trigger = renderChip()
    fireEvent.click(trigger)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('data-to', '/$locale/manage/bookings/$bookingId')
    expect(link).toHaveAttribute('data-bookingid', 'bk-1')
    expect(link).toHaveAttribute('data-locale', 'en')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest --root packages/web run tests/vite/operator-bookings/CalendarEventChip.test.tsx`
Expected: FAIL — module `CalendarEventChip` not found.

- [ ] **Step 3: Implement the chip (GREEN)**

```tsx
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { BookingQuickView } from '@/vite/operator-bookings/BookingQuickView'
import type { CalendarEvent } from '@/vite/operator-bookings/calendar-events'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EventProps } from 'react-big-calendar'

const HOVER_OPEN_DELAY_MS = 120
// base-ui v1.3.0 onOpenChange reasons that mean "the user dismissed the card".
// A `trigger-press` close (toggle) is deliberately NOT here: a chip click only pins.
const DISMISS_REASONS = new Set(['outside-press', 'escape-key', 'focus-out'])

type ChipProps = EventProps<CalendarEvent> & { readonly locale: string }

// rbc custom event component. Renders the event title as a Popover trigger and a
// BookingQuickView card as the popup. Owns a local hover/pin state machine; the card
// is a Link so clicking it (or pressing Enter on it) opens the full detail page.
export function CalendarEventChip({ event, locale }: ChipProps) {
  const [hovering, setHovering] = useState(false)
  const [pinned, setPinned] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
  }, [])

  const handleEnter = useCallback(() => {
    clearTimer()
    openTimer.current = setTimeout(() => setHovering(true), HOVER_OPEN_DELAY_MS)
  }, [clearTimer])

  const handleLeave = useCallback(() => {
    clearTimer()
    setHovering(false)
  }, [clearTimer])

  useEffect(() => clearTimer, [clearTimer])

  const handleOpenChange = useCallback((next: boolean, details: { reason: string }) => {
    if (!next && DISMISS_REASONS.has(details.reason)) {
      setPinned(false)
      setHovering(false)
    }
  }, [])

  return (
    <Popover open={hovering || pinned} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        type="button"
        className="block h-full w-full truncate text-left"
        onClick={() => setPinned(true)}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {event.title}
      </PopoverTrigger>
      <PopoverContent initialFocus={false} className="p-0">
        <Link
          to="/$locale/manage/bookings/$bookingId"
          params={{ locale, bookingId: event.id }}
          className="block rounded-lg p-2.5 text-inherit no-underline hover:bg-muted"
        >
          <BookingQuickView event={event} locale={locale} />
        </Link>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest --root packages/web run tests/vite/operator-bookings/CalendarEventChip.test.tsx`
Expected: PASS (7 tests).

If the Escape or pin tests are flaky under jsdom + base-ui portals: confirm the card text is queried from `document.body` (portal target) — `screen.queryByText` already searches the whole document, so no change is usually needed. Do NOT weaken assertions to `toBeTruthy`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/operator-bookings/CalendarEventChip.tsx \
        packages/web/tests/vite/operator-bookings/CalendarEventChip.test.tsx
git commit -m "feat(calendar): CalendarEventChip hover-peek/click-pin quick-view popover"
```

---

## Task 5: Wire the chip into `BookingsCalendar`

**Files:**
- Modify: `packages/web/src/vite/operator-bookings/BookingsCalendar.tsx`
- Test: `packages/web/tests/vite/operator-bookings/BookingsCalendar.test.tsx`

- [ ] **Step 1: Update the test (RED)**

In `BookingsCalendar.test.tsx`, remove `onSelectEvent={vi.fn()}` from the `renderCalendar` JSX (the prop is gone). Then add to the `describe` block:

```ts
it('hands rbc a custom event component (the quick-view chip)', () => {
  renderCalendar(vi.fn())
  expect(typeof (calendarProps.components as { event?: unknown }).event).toBe('function')
})

it('no longer wires a navigate-on-click handler to rbc', () => {
  renderCalendar(vi.fn())
  expect(calendarProps.onSelectEvent).toBeUndefined()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest --root packages/web run tests/vite/operator-bookings/BookingsCalendar.test.tsx`
Expected: FAIL — `onSelectEvent` still passed; `components.event` undefined; and a TS error on the removed prop once Step 3 lands.

- [ ] **Step 3: Implement the wiring (GREEN)**

In `BookingsCalendar.tsx`:

1. Add imports:
```ts
import { CalendarEventChip } from '@/vite/operator-bookings/CalendarEventChip'
import { Calendar, type EventProps, type SlotInfo } from 'react-big-calendar'
```
(extend the existing `react-big-calendar` import to include `EventProps`.)

2. Delete the module-level `CALENDAR_COMPONENTS` const (line 20).

3. In `BookingsCalendarProps`, delete the `onSelectEvent` member (lines 31-33).

4. Delete `onSelectEvent` from the destructured params and delete `handleSelectEvent` (lines 92-95).

5. After `eventPropGetter`, add the memoized components map:
```ts
const components = useMemo(
  () => ({
    toolbar: () => null,
    event: (props: EventProps<CalendarEvent>) => <CalendarEventChip {...props} locale={locale} />,
  }),
  [locale],
)
```

6. On `<Calendar>`, delete `onSelectEvent={handleSelectEvent}` and change `components={CALENDAR_COMPONENTS}` to `components={components}`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest --root packages/web run tests/vite/operator-bookings/BookingsCalendar.test.tsx`
Expected: PASS (slot-selection tests + the 2 new wiring tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/operator-bookings/BookingsCalendar.tsx \
        packages/web/tests/vite/operator-bookings/BookingsCalendar.test.tsx
git commit -m "feat(calendar): render quick-view chip as rbc event; drop navigate-on-click"
```

---

## Task 6: Wire the route (enrich events; drop navigation)

**Files:**
- Modify: `packages/web/src/routes/$locale/_business/manage/bookings/index.tsx:108,134-139,165-175`
- Test: `packages/web/tests/vite/operator-bookings/OperatorBookingsRoute.test.tsx`

- [ ] **Step 1: Add the enrichment-wiring test (RED)**

In `OperatorBookingsRoute.test.tsx`, add inside the existing `describe`:

```ts
it('enriches calendar events with the assigned vehicle name (transform wiring)', () => {
  const booking: api.CalendarBookingRow = {
    id: 'bk-1',
    bookingCode: 'ABCD2345',
    status: 'CONFIRMED',
    startAt: '2026-07-01T01:00:00.000Z',
    effectiveEndAt: '2026-07-03T02:00:00.000Z',
    vehicleId: 'veh-1',
    renterName: 'Jane',
    renterEmail: null,
    totalPrice: 24000,
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  queryClient.setQueryData(['session'], operatorSession)
  queryClient.setQueryData(api.operatorCalendarQueryOptions(from, to).queryKey, [booking])
  queryClient.setQueryData(api.operatorCalendarVehiclesQueryOptions().queryKey, [
    { id: 'veh-1', name: 'Toyota Aqua' },
  ])
  queryClient.setQueryData(operatorLocationsQueryOptions().queryKey, [])
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <OperatorBookingsRoute />
      </IntlProvider>
    </QueryClientProvider>,
  )
  const events = calendarProps.events as Array<{ id: string; vehicleName: string | null }>
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ id: 'bk-1', vehicleName: 'Toyota Aqua' })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest --root packages/web run tests/vite/operator-bookings/OperatorBookingsRoute.test.tsx`
Expected: FAIL — events lack `vehicleName` (route still calls `toCalendarEvents(bookings)`), and a TS error on the removed `onSelectEvent` prop after Step 3.

- [ ] **Step 3: Implement the route changes (GREEN)**

In `index.tsx`:

1. Line 108 — pass the fleet to the transform:
```ts
const events = useMemo(() => toCalendarEvents(bookings, vehicles), [bookings, vehicles])
```

2. Delete `handleSelectEvent` (lines 134-139).

3. In the `<BookingsCalendar …>` JSX, delete the `onSelectEvent={handleSelectEvent}` prop (line 173). Leave `locale`, `events`, `resources`, view/date handlers, and `onSelectSlot` unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest --root packages/web run tests/vite/operator-bookings/OperatorBookingsRoute.test.tsx`
Expected: PASS (existing manual-booking tests + the new enrichment test).

- [ ] **Step 5: Commit**

```bash
# Single-quote the path: an unquoted $locale is expanded away by the shell.
git add 'packages/web/src/routes/$locale/_business/manage/bookings/index.tsx' \
        packages/web/tests/vite/operator-bookings/OperatorBookingsRoute.test.tsx
git commit -m "feat(calendar): enrich events with fleet in route; click pins instead of navigating"
```

---

## Task 7: Full verification

- [ ] **Step 1: Typecheck the web package**

Run: `bunx tsc --noEmit -p packages/web/tsconfig.json`
Expected: no errors. (Watch for any other caller of `toCalendarEvents` — there should be only the route and the test.)

- [ ] **Step 2: Run the full operator-bookings suite**

Run: `bunx vitest --root packages/web run tests/vite/operator-bookings`
Expected: all green (transform, card, chip, calendar wiring, route wiring).

- [ ] **Step 3: Lint + format**

Run: `bun run lint && bun run format`
Expected: exit 0. (Biome may reorder imports — re-read files before any further edit.)

- [ ] **Step 4: Build the web package (catches route-tree / bundler issues)**

Run: `bun run --filter @kuruma/web build`
Expected: build succeeds. No `routeTree.gen.ts` change is expected (no route added).

- [ ] **Step 5: Manual smoke (browser)**

Run `bun run dev`, open `/<locale>/manage/bookings`. Verify: hovering an event shows the card after ~120ms; it disappears on mouse-out; clicking pins it; clicking the pinned card opens the detail page; clicking elsewhere / Esc closes a pinned card; times read in JST.

- [ ] **Step 6: Final commit (if lint/format changed anything)**

Do NOT use `git add -A` — the worktree carries an untracked `tmp/`. Inspect, then stage only the feature paths:

```bash
git status --short
# Single-quote the $locale route path; include it since Task 6 modifies it and
# format may have touched it after that commit.
git add packages/web/src/vite/operator-bookings packages/web/src/lib/event-colors.ts \
        packages/web/tests/vite/operator-bookings \
        'packages/web/src/routes/$locale/_business/manage/bookings/index.tsx'
git commit -m "chore(calendar): lint/format quick-view"
```

---

## Self-review notes (coverage check)

- Spec interaction model (hover-peek / click-pin / dismiss / card-as-Link) → Tasks 3, 4.
- Spec P1 reason-aware state machine → Task 4 (`DISMISS_REASONS`, `onClick` pins, second-click regression test).
- Spec P2 renter fallback → Task 1 (`renterEmail`) + Task 3 (renter line + test).
- Spec P2 JST formatting → Task 3 (`formatDateTime`) + test.
- Spec P2 wiring tests → Tasks 5 (`components.event`) + 6 (route enrichment).
- Spec P3 no context module → Task 5 (memoized inline wrapper).
- Spec "no new API/i18n keys" → reuses `viewFullDetails` + `sidebar.statuses.*` (verified present in en/ja/zh).
