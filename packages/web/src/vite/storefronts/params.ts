import { formatJstDateTimeLocal, parseJstDateTimeLocal } from '@/lib/datetime'

export interface SearchRange {
  from: Date
  to: Date
}

const ONE_HOUR_MS = 60 * 60 * 1000
const HOURS_PER_DAY = 24
const DEFAULT_RANGE_DAYS = 3
const DEFAULT_RANGE_MS = DEFAULT_RANGE_DAYS * HOURS_PER_DAY * ONE_HOUR_MS

/**
 * Parse the `from`/`to` search params (wall-clock JST `datetime-local` strings)
 * into a valid Date range, or null when absent, malformed, or non-positive
 * (`to <= from`). The search route treats null as "show the date prompt"; the
 * detail route treats it as "redirect back to search to pick dates".
 */
export function parseSearchRange(from?: string, to?: string): SearchRange | null {
  if (!from || !to) return null
  try {
    const fromDate = parseJstDateTimeLocal(from)
    const toDate = parseJstDateTimeLocal(to)
    if (toDate <= fromDate) return null
    return { from: fromDate, to: toDate }
  } catch {
    return null
  }
}

/**
 * The pickup/return range to prefill when a renter hasn't chosen one yet: pickup
 * = the next whole JST hour (matches hourly booking granularity and is never in
 * the past), return = three days later. Returned as `datetime-local` strings so
 * both the hero widget and the search form drop them straight into their inputs.
 * `now` is injectable to keep the computation pure and testable.
 */
export function defaultSearchRange(now: Date = new Date()): { from: string; to: string } {
  const fromMs = Math.ceil(now.getTime() / ONE_HOUR_MS) * ONE_HOUR_MS
  return {
    from: formatJstDateTimeLocal(new Date(fromMs)),
    to: formatJstDateTimeLocal(new Date(fromMs + DEFAULT_RANGE_MS)),
  }
}

/**
 * Decide whether the search route needs its date range seeded: returns the
 * default range to inject when either bound is absent, or null when the URL
 * already carries both. Keeps the route's beforeLoad a thin redirect shell.
 */
export function searchRangeToSeed(
  search: { from?: string | undefined; to?: string | undefined },
  now: Date = new Date(),
): { from: string; to: string } | null {
  if (search.from && search.to) return null
  return defaultSearchRange(now)
}

/** Normalize the repeatable `class` search param to an array (TanStack gives string | string[]). */
export function normalizeClassFilter(value?: string | string[]): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * The active result filters to re-emit across every search -> detail -> back
 * navigation (#499). Without this, a future class / pickup-location filter UI
 * would silently lose state on the first card click, the back-to-search link,
 * or the invalid-range redirect. `from`/`to` are threaded separately (they key
 * the form remount and gate availability). Empty string / empty array / absent
 * filters are dropped so the URL stays clean and exactOptionalPropertyTypes is
 * satisfied.
 */
export function carryForwardFilters(filters: {
  class?: string | string[] | undefined
  pickupLocationId?: string | undefined
}): { class?: string | string[]; pickupLocationId?: string } {
  const cls = filters.class
  const keepClass = Array.isArray(cls) ? cls.length > 0 : Boolean(cls)
  return {
    ...(keepClass && cls !== undefined ? { class: cls } : {}),
    ...(filters.pickupLocationId ? { pickupLocationId: filters.pickupLocationId } : {}),
  }
}
