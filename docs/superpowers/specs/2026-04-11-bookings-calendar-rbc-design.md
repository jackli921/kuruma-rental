# Bookings Calendar: Day/Week/Month Views via react-big-calendar

**Date:** 2026-04-11
**Status:** Approved for planning
**Supersedes:** Issue #26 (`feat/calendar-week-day-grid`) — closed without merging per spike conclusion
**References:** `docs/2026-04-11-calendar-library-spike.md`, `docs/2026-04-02-kuruma-mvp-design.md` lines 293-305

## Summary

Replace `/manage/bookings` calendar with a react-big-calendar implementation offering three views (Day, Week, Month), a sidebar filter for vehicles and booking status, and click-through to the existing `BookingDetailDialog` with a stub link to a future booking detail page.

## Context

The `/manage/bookings` page on `main` currently renders a hand-rolled `WeeklyTimeline` (vehicles as rows, 7 days × 24 hours as columns). Issue #26 built a custom replacement (`feat/calendar-week-day-grid`) with cluster-based lane packing and Day/Week views — 170 tests green, unmerged.

Owner requirements clarified during brainstorming (2026-04-10 / 2026-04-11):

1. **Day view**: cars as column headers, hours as rows. Events are blocks inside vehicle columns, positioned by time.
2. **Week view**: standard Google Calendar week layout. Days as columns, hours as rows. Events from all vehicles overlaid, color-coded by status.
3. **Month view**: standard month grid. Events in day cells. Overflow stacked with a "+N more" indicator that expands to show all bookings for that day on click.
4. **Click event** → popup with details → stub "View full details" link (detail page is a separate slice).
5. **Sidebar filters**: vehicle multi-select + booking-status multi-select.

This description maps 1:1 to react-big-calendar's default behavior. The `feat/calendar-week-day-grid` branch's cluster-packing engine was solving a problem the owner no longer asks for (vehicle lane packing in day view). That code is retired.

## Library Decision

**react-big-calendar@1.19.x**, locked.

Justification from the bake-off spike (`docs/2026-04-11-calendar-library-spike.md`):

- **Technical fit**: passes `tsc` on React 19, `next build` on Turbopack, and `build:worker` on opennextjs-cloudflare. Measured bundle cost +80 KB gzipped first-load, comfortably under the 150 KB budget.
- **Feature fit**: Day resource view, standard Week view, standard Month view with `showMore` overflow are all stock behavior. Zero custom layout math needed for the requirements above.
- **Roadmap fit**: MVP design doc lists drag-to-create, resize, recurring maintenance, buffer hatching, source badges — all built-in to rbc or trivially wired via `eventPropGetter` / event handlers. Each feature that would be a from-scratch build in custom is one config line here.
- **Alternative ruled out**: `@schedule-x/react` paywalls drag-to-reschedule, recurring, resource view, and sidebar (spike finding). Disqualified.

**Dependency bloat caveat acknowledged**: rbc lists `moment`, `moment-timezone`, `luxon`, `dayjs`, `lodash`, `globalize` as runtime deps. In practice the `date-fns` localizer tree-shakes cleanly and the measured bundle cost (+80 KB gzipped) is the source of truth, not the `package.json` dep list.

## Goals

1. Ship Day / Week / Month views via `react-big-calendar` with `date-fns` localizer.
2. Day view uses rbc `resources` — one column per visible vehicle.
3. Week and Month views are standard rbc layouts (no resources).
4. Sidebar panel with two filter groups:
   - Vehicle multi-select (default: all)
   - Booking status multi-select (default: all four statuses)
5. Event click opens existing `BookingDetailDialog`; dialog has a "View full details" button linking to `/manage/bookings/[id]` (stub route — shows placeholder page).
6. Events color-coded by booking status, matching existing semantic: CONFIRMED green / ACTIVE blue / COMPLETED gray / CANCELLED red.
7. URL state for view and date (deep-linkable, survives refresh). Filter state is client-only.
8. All rbc-visible strings localized via next-intl `messages` prop in en/ja/zh.

## Non-Goals (explicit)

- Drag-to-reschedule bookings
- Click-and-drag to create maintenance blocks
- Event resize
- Buffer-time hatched extension
- Booking source badges (DIRECT / TRIP_COM / MANUAL)
- Trip.com sync
- Real booking detail page (stub only — separate slice)
- Vehicle type/category filter (schema has no `category` column; add when schema does)
- Dashboard page (`/dashboard`) calendar
- Print layout / export

## Architecture

### Branch strategy

- **Close issue #26** without merging `feat/calendar-week-day-grid`. Comment on the issue pointing at the spike and this spec.
- **New branch** `feat/calendar-rbc` off `main`.
- **Cherry-pick from retired branch**: nothing — rbc owns view/date state, so `calendar-view.ts` URL parsers are not reused. (If the plan discovers value in reusing them, revisit.)

### File map

**Delete (from `main`):**
- `packages/web/src/components/calendar/WeeklyTimeline.tsx`
- `packages/web/src/components/calendar/CalendarHeader.tsx`
- `packages/web/src/components/calendar/BookingBlock.tsx`

**Keep (unchanged or near-unchanged):**
- `packages/web/src/components/calendar/BookingDetailDialog.tsx` — add a "View full details" link inside
- `packages/web/src/lib/calendar.ts` — `CalendarBooking` type and `fetchCalendarBookings`
- `packages/web/src/lib/vehicle-api.ts`

**New:**
- `packages/web/src/components/calendar/BookingsCalendar.tsx` — rbc wrapper. Owns localizer, culture, messages, event renderer.
- `packages/web/src/components/calendar/CalendarSidebar.tsx` — left-panel filter UI.
- `packages/web/src/components/calendar/CalendarToolbar.tsx` — custom toolbar via rbc `components.toolbar` slot.
- `packages/web/src/components/calendar/calendar-theme.css` — scoped overrides mapping rbc class names to design tokens.
- `packages/web/src/components/calendar/event-colors.ts` — status → Tailwind class map.
- `packages/web/src/lib/rbc-localizer.ts` — `dateFnsLocalizer` instance configured with our locale.
- `packages/web/src/hooks/useCalendarFilters.ts` — client-state hook for `{ vehicleIds: Set, statuses: Set }`.
- `packages/web/src/hooks/useCalendarBookings.ts` — React Query hook keyed on visible range.
- `packages/web/src/app/[locale]/(business)/manage/bookings/[id]/page.tsx` — stub detail page (placeholder copy + back link).

**Rewrite:**
- `packages/web/src/app/[locale]/(business)/manage/bookings/BookingsCalendarView.tsx` — host sidebar + calendar, pipe filter state into events.
- `packages/web/src/app/[locale]/(business)/manage/bookings/page.tsx` — SSR initial fetch for today's range (Day view default).

### Data flow

```
page.tsx (server)
  ├─ fetchVehicles()
  └─ fetchCalendarBookings(today, endOfToday)    ← initial Day view range
       │
       ▼
BookingsCalendarView (client)
  ├─ URL: ?view=day|week|month & ?date=YYYY-MM-DD
  ├─ filter state: useCalendarFilters() → { vehicleIds, statuses }
  ├─ fetch: useCalendarBookings(visibleRange) via React Query
  │
  ├─ <CalendarSidebar>
  │    vehicles allVehicles
  │    filters
  │    onChange
  ├─ <BookingsCalendar>
  │    view, date, onView, onNavigate
  │    events = bookings filtered by (vehicleIds ∩ statuses)
  │    resources = view==='day' ? filtered vehicles : undefined
  │    onSelectEvent → setSelected(booking)
  └─ <BookingDetailDialog booking={selected} onClose />
```

### View → visible range

| View | Range |
|---|---|
| Day | `[startOfDay(date), endOfDay(date)]` |
| Week | `[startOfWeek(date, { weekStartsOn: 1 }), endOfWeek(date, { weekStartsOn: 1 })]` |
| Month | `[startOfMonth(date), endOfMonth(date)]` expanded to full weeks via `startOfWeek`/`endOfWeek` |

React Query key: `['calendar-bookings', fromIso, toIso]`. Uses `keepPreviousData` so nav doesn't flash empty.

### Day view: resource mapping

```ts
const resources = view === 'day'
  ? visibleVehicles.map(v => ({ resourceId: v.id, resourceTitle: v.name }))
  : undefined

const events = bookings
  .filter(b => filters.vehicleIds.has(b.vehicleId))
  .filter(b => filters.statuses.has(b.status))
  .map(b => ({
    id: b.id,
    title: vehiclesById.get(b.vehicleId)?.name ?? '',
    start: new Date(b.startAt),
    end: new Date(b.effectiveEndAt),
    resourceId: b.vehicleId, // ignored in week/month, used in day
    raw: b,
  }))
```

### Event coloring (status-based, kept from feat branch)

```ts
// event-colors.ts
const STATUS_CLASS: Record<BookingStatus, string> = {
  CONFIRMED: 'bg-green-200 border-green-400 text-green-900',
  ACTIVE:    'bg-blue-200 border-blue-400 text-blue-900',
  COMPLETED: 'bg-gray-200 border-gray-400 text-gray-700',
  CANCELLED: 'bg-red-200 border-red-400 text-red-900',
}
```

Applied via rbc's `eventPropGetter`:
```ts
eventPropGetter={(event) => ({
  className: STATUS_CLASS[event.raw.status],
})}
```

### Sidebar

- Left `w-64`, calendar `flex-1`. Collapses on narrow screens (hidden below `md`, available via drawer — drawer is Phase 2, MVP just hides).
- Two `<fieldset>` sections:
  - **Vehicles**: "All / None" buttons + scrollable checkbox list (name only; no color swatch since events are colored by status).
  - **Status**: four checkboxes, one per booking status, with a colored dot matching the event color.
- State in `useCalendarFilters` hook:
  ```ts
  type FilterState = {
    vehicleIds: Set<string>
    statuses: Set<BookingStatus>
  }
  ```
- Persisted to `localStorage` key `kuruma.calendar.filters`. Hydrate on mount; if storage empty or contains a vehicle id no longer in the fleet, fall back to "all".
- Does NOT live in the URL (too many ids, no share-use-case).

### Toolbar

rbc's `components.toolbar` slot is replaced with `CalendarToolbar`:

- Left: Prev / Next / Today (our `Button variant="outline"` + lucide chevrons)
- Center: date label (formatted per view — `EEEE, MMM d` / `MMM d - d, yyyy` / `MMMM yyyy`)
- Right: Day / Week / Month segmented control (three `Button`s, `variant="outline"` / `variant="default"` for active)

All labels via next-intl `business.bookings.calendar.*`.

### Localizer

Single `dateFnsLocalizer` instance configured with `ja`, `en-US`, `zh-CN` date-fns locales. Selected by current next-intl locale. First day of week = Monday (existing app convention).

### i18n keys (new, under `business.bookings.calendar.*`)

- `views.day`, `views.week`, `views.month`
- `previous`, `next`, `today`
- `allDay`, `noEventsInRange`
- `showMore` (with `{count}` interpolation)
- `sidebar.title`
- `sidebar.vehicles.title`, `sidebar.vehicles.all`, `sidebar.vehicles.none`
- `sidebar.statuses.title`
- `sidebar.statuses.CONFIRMED`, `.ACTIVE`, `.COMPLETED`, `.CANCELLED`
- `detailDialog.viewFullDetails`

Passed to rbc via `messages` prop:
```ts
<Calendar messages={{
  today: t('today'),
  previous: t('previous'),
  next: t('next'),
  day: t('views.day'),
  week: t('views.week'),
  month: t('views.month'),
  allDay: t('allDay'),
  noEventsInRange: t('noEventsInRange'),
  showMore: total => t('showMore', { count: total }),
}} />
```

Turbopack cache reset required after adding new top-level keys (known CLAUDE.md gotcha).

### Theming

Import rbc base CSS once inside `BookingsCalendar.tsx`:
```ts
import 'react-big-calendar/lib/css/react-big-calendar.css'
import './calendar-theme.css'
```

`calendar-theme.css` overrides scoped under `.rbc-calendar`:
- `.rbc-header`, `.rbc-time-header-content`: border and bg → `--border` / `--card`
- `.rbc-today`: subtle `--primary/5`
- `.rbc-event`: rounded, no default bg (classNames from `eventPropGetter` drive color)
- `.rbc-show-more`: text color → `--primary`, underline on hover
- `.rbc-time-slot` hour labels → `text-muted-foreground`, smaller font

No global leakage.

### Stub detail page

`app/[locale]/(business)/manage/bookings/[id]/page.tsx`:
```tsx
export default async function BookingDetailPage({ params }) {
  const { id } = await params
  const t = await getTranslations('business.bookings.detail')
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold">{t('stubTitle')}</h1>
      <p className="text-muted-foreground mt-2">
        {t('stubBody', { id })}
      </p>
      <Link href="/manage/bookings" className={cn(buttonVariants({ variant: 'outline' }), 'mt-6')}>
        {t('backToCalendar')}
      </Link>
    </div>
  )
}
```

No API fetch, no data. Unblocks the "View full details" link in the dialog.

### BookingDetailDialog changes

Add a `<Link>` at the bottom of the existing dialog:
```tsx
<Link
  href={`/manage/bookings/${booking.id}`}
  className={cn(buttonVariants({ variant: 'default' }), 'w-full mt-4')}
  onClick={onClose}
>
  {t('viewFullDetails')}
</Link>
```

## Edge Cases

| Case | Handling |
|---|---|
| All vehicles unchecked | Day view shows empty columns placeholder; Week/Month show empty calendar with `noEventsInRange` message. |
| All statuses unchecked | Same as above. |
| No bookings in range | rbc's `noEventsInRange` (localized). |
| Booking crosses view boundary | rbc clamps to visible range natively. |
| DST | Japan has no DST. rbc + date-fns use browser local tz. One defensive test for a DST boundary to guard future markets. |
| localStorage unavailable | Fall back to all-checked, no crash. |
| Vehicle deleted after storage write | Prune unknown ids on hydration. |
| `?view=invalid` in URL | Fall back to `day` default. |
| Month view with many events per day | rbc's built-in `showMore` — click expands a popover with all events for that day. User clicks any → same `onSelectEvent` → dialog. |

## Testing Strategy

Vertical TDD. All tests mutation-resistant — specific assertions, not truthiness.

### Unit tests
- `rbc-localizer.test.ts` — format functions return correct strings for en/ja/zh locales.
- `event-colors.test.ts` — each status maps to the expected Tailwind classes.
- `useCalendarFilters.test.ts` — default state = all checked; toggle operations; localStorage hydrate with pruning of unknown vehicle ids.
- `useCalendarBookings.test.ts` — React Query called with the correct `from`/`to` for each view + date combination.

### Component tests (vitest + @testing-library/react)
- `CalendarSidebar`
  - Default: all vehicles + all statuses checked
  - Toggling a vehicle checkbox updates state and calls `onChange`
  - "All" / "None" shortcuts apply to the vehicle group only
  - Status row renders a colored dot matching `STATUS_CLASS`
- `CalendarToolbar`
  - Renders Prev/Next/Today + view switcher + date label
  - Clicking Day/Week/Month calls `onView` with the corresponding string
  - Clicking Prev/Next/Today calls `onNavigate` with the correct action
- `BookingsCalendar`
  - Day view with `resources` prop renders one column per visible vehicle
  - Switching to Week view does not pass `resources` prop (standard week)
  - Switching to Month view renders month layout
  - `eventPropGetter` assigns the status className
  - Clicking an event calls `onSelectEvent` with the raw booking
- `BookingsCalendarView` (integration)
  - Unchecking a vehicle in sidebar hides its events
  - Unchecking a status hides its events
  - URL param `?view=week` initializes week view
  - Clicking an event opens `BookingDetailDialog`
  - Dialog "View full details" link points to `/manage/bookings/[id]`

### What we don't test
- rbc internals
- React Query internals
- Pixel-perfect event positioning (rbc owns this)

## Migration / Rollout

Single PR. No feature flag (MVP pre-launch, near-zero production traffic on the bookings page).

Slice sequence (vertical TDD, each step one failing test → implementation → green):

1. Install `react-big-calendar` + `@types/react-big-calendar`.
2. `rbc-localizer.ts` + unit test.
3. `event-colors.ts` + unit test.
4. `useCalendarFilters` hook + tests.
5. `useCalendarBookings` hook + tests.
6. `CalendarToolbar` component + tests.
7. `BookingsCalendar` — Week view only (simplest, no resources) + tests.
8. Add Day view with resources + tests.
9. Add Month view + tests.
10. `CalendarSidebar` component + tests.
11. `BookingsCalendarView` rewrite — wire sidebar + calendar + dialog + tests.
12. Rewrite `page.tsx` — SSR initial Day range.
13. Add `[id]/page.tsx` stub + i18n strings.
14. Add "View full details" link to `BookingDetailDialog`.
15. `calendar-theme.css` — visual pass, manual check.
16. i18n strings in `en.json`, `ja.json`, `zh.json` — verify Turbopack cache reset.
17. Delete `WeeklyTimeline.tsx`, `CalendarHeader.tsx`, `BookingBlock.tsx`.
18. Lint + typecheck + test suite green.
19. Manual smoke: dev server, all three views, filters, dialog, detail stub.
20. Update `docs/2026-04-02-kuruma-mvp-design.md` line 305 — lock library choice.
21. Append any rbc-specific gotchas to `CLAUDE.md`.

## Documentation Updates (in this slice)

- `docs/2026-04-02-kuruma-mvp-design.md` line 305 — change "react-big-calendar or @schedule-x/react" to "react-big-calendar" with a link to the spike doc.
- `CLAUDE.md` — add any react-big-calendar + Next 16 + CF Workers gotchas discovered during implementation (currently none known; will fill in as they surface).

## Open Questions

None.
