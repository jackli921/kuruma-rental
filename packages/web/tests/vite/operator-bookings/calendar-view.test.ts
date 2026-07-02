import { todayInJst } from '@/lib/datetime'
import {
  calendarRange,
  defaultCalendarView,
  formatCalendarDate,
  normalizeViewParam,
  operatorViews,
  parseCalendarDate,
  parseCalendarView,
} from '@/vite/operator-bookings/calendar-view'
import { describe, expect, it } from 'vitest'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

describe('calendarRange (JST-anchored, #1250)', () => {
  // 2026-07-15 is a Wednesday. Built from LOCAL fields so the anchor's calendar day is
  // July 15 in ANY runner TZ. The bounds are anchored to the JST day/week/month, not
  // the browser-local one, so an off-JST viewer's fetch window is the SAME instants a
  // Tokyo viewer gets — no booking near JST-midnight drops out of the query. Asserted
  // as exact UTC ISO (a JST wall clock is `wall - 9h`), so these hold under any TZ.
  const anchor = new Date(2026, 6, 15, 12)

  it('spans the JST day in day view (00:00–23:59:59.999 JST)', () => {
    expect(calendarRange('day', anchor)).toEqual({
      from: '2026-07-14T15:00:00.000Z', // JST 2026-07-15 00:00
      to: '2026-07-15T14:59:59.999Z', // JST 2026-07-15 23:59:59.999
    })
  })

  it('spans a fixed 14-day JST planning window from the anchor day in timeline view', () => {
    const { from, to } = calendarRange('timeline', anchor)
    expect(from).toBe('2026-07-14T15:00:00.000Z') // JST 2026-07-15 00:00
    expect(to).toBe('2026-07-28T15:00:00.000Z') // JST 2026-07-29 00:00 — exactly 14 days
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(14 * DAY_MS)
  })

  it('spans the Monday-start JST week in week view', () => {
    expect(calendarRange('week', anchor)).toEqual({
      from: '2026-07-12T15:00:00.000Z', // JST Mon 2026-07-13 00:00
      to: '2026-07-19T14:59:59.999Z', // JST Sun 2026-07-19 23:59:59.999
    })
  })

  it('covers the whole month grid in month view (Monday-aligned JST weeks enclosing July)', () => {
    expect(calendarRange('month', anchor)).toEqual({
      from: '2026-06-28T15:00:00.000Z', // JST Mon 2026-06-29 00:00 (grid start)
      to: '2026-08-02T14:59:59.999Z', // JST Sun 2026-08-02 23:59:59.999 (grid end)
    })
  })
})

describe('parseCalendarView (fleet timeline enabled)', () => {
  // The timeline board (#1100) is the operator default only while its flag is on; the
  // caller passes the effective value (#1322), so this is pure of the runtime env.
  it('keeps a valid view and defaults anything else to the timeline board', () => {
    expect(parseCalendarView('timeline', true)).toBe('timeline')
    expect(parseCalendarView('day', true)).toBe('day')
    expect(parseCalendarView('week', true)).toBe('week')
    expect(parseCalendarView('month', true)).toBe('month')
    expect(parseCalendarView('agenda', true)).toBe('timeline') // a real rbc view we do not offer
    expect(parseCalendarView(undefined, true)).toBe('timeline')
  })
})

describe('fleet-timeline view gating (#1100)', () => {
  it('enabled → timeline leads the switcher and is the landing default', () => {
    expect(operatorViews(true)).toEqual(['timeline', 'day', 'week', 'month'])
    expect(defaultCalendarView(true)).toBe('timeline')
  })

  it('gated off → the timeline view drops out and week becomes the default', () => {
    expect(operatorViews(false)).toEqual(['day', 'week', 'month'])
    expect(defaultCalendarView(false)).toBe('week')
  })

  it('gated off → a hand-typed ?view=timeline falls back to the week grid', () => {
    expect(parseCalendarView('timeline', false)).toBe('week')
    expect(parseCalendarView(undefined, false)).toBe('week')
    // The remaining grids still parse through untouched.
    expect(parseCalendarView('day', false)).toBe('day')
    expect(parseCalendarView('month', false)).toBe('month')
  })
})

describe('normalizeViewParam (flag-blind URL narrowing for validateSearch)', () => {
  it('keeps any KNOWN view string, including timeline (the flag decides later)', () => {
    expect(normalizeViewParam('timeline')).toBe('timeline')
    expect(normalizeViewParam('day')).toBe('day')
    expect(normalizeViewParam('week')).toBe('week')
    expect(normalizeViewParam('month')).toBe('month')
  })

  it('drops an unknown or non-string value to undefined', () => {
    expect(normalizeViewParam('agenda')).toBeUndefined()
    expect(normalizeViewParam(undefined)).toBeUndefined()
    expect(normalizeViewParam(42)).toBeUndefined()
  })
})

describe('formatCalendarDate / parseCalendarDate', () => {
  it('round-trips a local calendar day regardless of time of day', () => {
    const s = formatCalendarDate(new Date(2026, 6, 15, 9, 30)) // local Jul 15 2026
    expect(s).toBe('2026-07-15')
    const back = parseCalendarDate(s)
    expect([back.getFullYear(), back.getMonth(), back.getDate()]).toEqual([2026, 6, 15])
  })

  it('falls back to the JST calendar day (not the browser-local day) when missing/malformed', () => {
    // #1250: near midnight an off-JST browser's local day can differ from the Tokyo
    // day the operator works in; the fallback must anchor to JST so TODAY lands right.
    const jstToday = todayInJst()
    const ymd = (d: Date) => [d.getFullYear(), d.getMonth(), d.getDate()]
    for (const bad of [undefined, '', 'not-a-date', '2026-13-99', '2026-7-1']) {
      expect(ymd(parseCalendarDate(bad))).toEqual(ymd(jstToday))
    }
  })
})
