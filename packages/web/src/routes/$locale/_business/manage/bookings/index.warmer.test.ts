import {
  calendarRange,
  parseCalendarDate,
  parseCalendarView,
} from '@/vite/operator-bookings/calendar-view'
import type { FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import { describe, expect, it, vi } from 'vitest'
import { Route } from './index'

// #1486: the calendar warmer must read the fleet-timeline flag via fetchQuery, not
// ensureQueryData. The overrides map is seeded with a STALE empty override; ensureQueryData
// returns that seed unchanged on a hard load, so the warmer would pick its range from the
// build-time default while the component (via the refetching provider) renders from the live
// override -> a wasted warm of the wrong range. fetchQuery honors the stale seed and pulls the
// real override first, so the warmer keeps its "warm the SAME range the component renders"
// contract. These pin that method choice and its observable effect on the warmed range.
function runLoader(flagOverride: FeatureFlagOverrides) {
  // fetchQuery returns the live override for the flags key; anything else resolves empty.
  const fetchQuery = vi.fn(async (opts: { queryKey: readonly unknown[] }) =>
    opts.queryKey[0] === 'feature-flags' ? flagOverride : [],
  )
  // The stale seed a wrong (ensureQueryData) impl would read for the flags: an EMPTY map,
  // i.e. build-time default. If the loader ever reads flags here, the range goes wrong.
  const ensureQueryData = vi.fn(async () => ({}) as unknown)
  const context = { queryClient: { fetchQuery, ensureQueryData } }
  const loader = Route.options.loader as (arg: unknown) => Promise<unknown>
  const result = loader({
    context,
    deps: { view: undefined, date: undefined, operator: undefined },
  })
  return { result, fetchQuery, ensureQueryData }
}

// The calendar range warmed by the loader: ['operator-bookings','calendar',from,to,operator].
function warmedRange(ensureQueryData: ReturnType<typeof vi.fn>): { from: unknown; to: unknown } {
  const key = ensureQueryData.mock.calls
    .map((call) => (call[0] as { queryKey?: readonly unknown[] } | undefined)?.queryKey)
    .find(
      (k): k is readonly unknown[] =>
        Array.isArray(k) && k[1] === 'calendar' && k[2] !== 'vehicles',
    )
  if (!key) throw new Error('calendar query was not warmed')
  return { from: key[2], to: key[3] }
}

describe('operator bookings calendar warmer (runtime flag)', () => {
  it('reads the fleet-timeline override live via fetchQuery, never through ensureQueryData', async () => {
    const { result, fetchQuery, ensureQueryData } = runLoader({ FLEET_TIMELINE: true })
    await result
    expect(fetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['feature-flags'] }),
    )
    expect(ensureQueryData).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['feature-flags'] }),
    )
  })

  it('warms the timeline range when a runtime override enables it despite the build default off', async () => {
    const { result, ensureQueryData } = runLoader({ FLEET_TIMELINE: true })
    await result
    // The live override (true) must drive the range to the 14-day timeline span, not the
    // build-default week grid a stale-seed read would produce.
    const expected = calendarRange(parseCalendarView(undefined, true), parseCalendarDate(undefined))
    expect(warmedRange(ensureQueryData)).toEqual(expected)
  })

  it('warms a different range once the timeline override is turned off', async () => {
    const on = runLoader({ FLEET_TIMELINE: true })
    await on.result
    const off = runLoader({ FLEET_TIMELINE: false })
    await off.result
    // A flipped override reaches the range decision: timeline span != week grid.
    expect(warmedRange(on.ensureQueryData)).not.toEqual(warmedRange(off.ensureQueryData))
  })
})
