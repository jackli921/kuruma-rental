import { parseJstDateTimeLocal } from '@/lib/datetime'

export interface SearchRange {
  from: Date
  to: Date
}

/**
 * Parse the `from`/`to` URL params (wall-clock JST `datetime-local` strings)
 * into a valid Date range, or null when absent, malformed, or non-positive
 * (`to <= from`). The search page treats null as "show the date prompt"; the
 * detail page treats it as "redirect back to search to pick dates".
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

/** Normalize the repeatable `class` query param to an array (Next gives string | string[]). */
export function normalizeClassFilter(value?: string | string[]): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}
