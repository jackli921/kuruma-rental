# Pickup/Return Date-Time Picker Redesign — Design

- **Date:** 2026-06-17
- **Author:** Jack (with Claude)
- **Status:** Approved design — pending implementation
- **Trunk:** branch off `develop`; one PR per slice
- **Scope:** Renter-facing pickup/return date+time selection on the landing hero and the search-results refine form. Replace the bare native controls with one shared, calendar-based picker modeled on the car-rental industry standard (Turo / Booking.com / Rentalcars).
- **Related:** #954 (gate past dates — this picker delivers its client layer); complements `docs/plans/2026-06-17-renter-booking-ux-improvements-design.md` (separate slices, same renter flow).

## Context

User-reported pain with picking pickup/return dates and times. All four confirmed:

1. The native `<input type="datetime-local">` is **clunky** — segment typing + tiny time spinner.
2. **No range feel** — two disconnected fields, no single calendar, no "N days" feedback.
3. **Time-of-day is awkward** — want fixed slots, not a free spinner.
4. **Bad on mobile** — tourists are on phones.

Explicit direction: **model the design on an established booking/rental website**, not invent it. Chosen paradigm (brainstorming): **car-rental standard** — date *and* time are first-class (range calendar + fixed time-slot dropdowns), because Kuruma books cars by the hour in JST. (Airbnb's stays paradigm was rejected: time-of-day is an afterthought there.)

## What exists today (verified 2026-06-17)

- **Landing hero** — `packages/web/src/vite/landing/SearchWidget.tsx:70-95`: two bare `datetime-local` inputs, React-state-backed, no `min`.
- **Refine form** — `packages/web/src/vite/storefronts/StorefrontSearchForm.tsx:93,97`: two **uncontrolled** `datetime-local` inputs (`name="from"`/`"to"`); the comment cites dodging the **#392 pre-hydration reconcile flake** — moot now that web is a pure Vite SPA (no SSR hydration).
- **JST helpers** — `packages/web/src/lib/datetime.ts`: `formatJstDateTimeLocal(date)` / `parseJstDateTimeLocal(str)` (JST = UTC+9, no DST). The wire format is JST wall-clock `YYYY-MM-DDTHH:mm`.
- **Range parse/prefill** — `packages/web/src/vite/storefronts/params.ts`: `parseSearchRange` (validates `to > from`), `defaultSearchRange` (next whole hour forward), `persistSearchRange` (sessionStorage).
- **UI primitives present:** `select.tsx`, `sheet.tsx`, `dialog.tsx`. **Absent:** calendar, popover. **Dep present:** `date-fns` ^4.1.0. **Absent:** `react-day-picker`, `@radix-ui/react-popover`.
- **Search-domain home:** `packages/web/src/vite/search/` already holds `flags.ts`, `result.ts`, `SearchResultRow.tsx`, etc.

## Decisions (from brainstorming)

- **Paradigm:** car-rental standard — range calendar + time-slot dropdowns.
- **Time granularity:** **30-minute** slots (`00:00`–`23:30`).
- **Scope:** **both** entry points, via **one shared component**.
- **Mobile:** responsive — **Popover** on desktop (`md+`), **bottom Sheet** on mobile (reuse `sheet.tsx`).
- **Build approach:** add shadcn `calendar` (`react-day-picker`, `mode="range"`, `disabled={{ before: today }}`) + `popover` (`@radix-ui/react-popover`); reuse `select.tsx` for slots, `sheet.tsx` for mobile. Hand-rolling the calendar was rejected (more code, no upside).
- **Output contract (critical):** the picker emits the **same** JST wall-clock `from`/`to` strings the native inputs produce today. `parseSearchRange`, `persistSearchRange`, URL params, and the API stay **untouched** — a true drop-in replacement.

## Design

### Component

`packages/web/src/vite/search/DateTimeRangePicker.tsx` — controlled.

```ts
type DateTimeRange = { from: string; to: string } // JST 'YYYY-MM-DDTHH:mm'

interface DateTimeRangePickerProps {
  value: DateTimeRange | null
  onChange: (next: DateTimeRange) => void
  minDate?: Date // defaults to JST "now"; disables earlier dates/slots
}
```

Internals:
- **Dates:** `react-day-picker` in `mode="range"`; `disabled={{ before: startOfTodayJst(minDate) }}`.
- **Times:** two `select.tsx` dropdowns (pickup, return) of 30-min slots; on the *current* day, past slots are filtered out.
- **Compose:** selected day + slot → JST string via `formatJstDateTimeLocal`. Show a "N days" summary derived from the range.
- **Responsive shell:** `useMediaQuery('(min-width: 768px)')` → `Popover` (desktop) vs `Sheet side="bottom"` (mobile), both wrapping the same inner panel.

### Consumers

- **SearchWidget** — replace the two inputs (`:70-95`) with `<DateTimeRangePicker>`, seeded from `defaultSearchRange()`. Submit path unchanged (still calls `persistSearchRange` + navigate).
- **StorefrontSearchForm** — replace the two uncontrolled inputs (`:93,97`) with the controlled picker; the form reads the controlled `value` on submit instead of FormData. (#392 hydration concern no longer applies in the SPA — verify in PR.)

### Files

- NEW `vite/search/DateTimeRangePicker.tsx`; NEW shadcn `components/ui/calendar.tsx`, `components/ui/popover.tsx`; NEW dep `react-day-picker`, `@radix-ui/react-popover`.
- NEW small `useMediaQuery` hook if none exists.
- EDIT `SearchWidget.tsx`, `StorefrontSearchForm.tsx`. i18n keys for labels (pickup/return/"N days").
- REUSE `select.tsx`, `sheet.tsx`, `lib/datetime.ts`, `params.ts`.

### Relationship to #954 (past-date gating)

This picker **subsumes #954's client layer**: disabling pre-today dates and past slots replaces the native-`min` approach. **#954 keeps only** the shared-validator + API `.refine(startAt >= now)` (the real, un-bypassable gate). Sequence either order; note the overlap so the native-`min` task in #954 is dropped if the picker lands first.

## Test plan

- **Unit:** day+slot → correct JST string; past dates disabled; past slots filtered on today; "N days" math; round-trip — `parseSearchRange(picker output)` is non-null and equals the inputs (proves the contract holds).
- **Component (testing-library):** pick start→end updates `value`; changing a time updates the string; mobile path renders the Sheet (mock `matchMedia`).
- **E2E:** booking flow still completes via the new picker; selecting yesterday is impossible.

## Slicing (vertical, one PR each)

- **Slice 1:** build `DateTimeRangePicker` + shadcn `calendar`/`popover` + wire into **StorefrontSearchForm** (range matters most here). Demoable.
- **Slice 2:** wire the same component into the **landing SearchWidget**. Demoable.

## Out of scope

- **Business-hours-aware time slots** (constrain to a location's `operatingHours`) — the landing hero has no store context; deferred enhancement.
- The server/validator half of #954 (tracked in #954).
- Any change to pricing, availability search, or the API contract.
