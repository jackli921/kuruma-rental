import { parseJstDateTimeLocal } from '@/lib/datetime'

export interface SearchRange {
  from: Date
  to: Date
}

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

/** Normalize the repeatable `class` search param to an array (TanStack gives string | string[]). */
export function normalizeClassFilter(value?: string | string[]): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}
