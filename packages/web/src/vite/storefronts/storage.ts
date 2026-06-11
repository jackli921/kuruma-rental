const FROM_KEY = 'kuruma.search.from'
const TO_KEY = 'kuruma.search.to'

/**
 * Remember the renter's last search range for this browser session so the hero
 * widget can restore it on return instead of resetting to empty. Best-effort:
 * a disabled or throwing store (private mode, quota) silently no-ops, since
 * retention is a convenience, not load-bearing state.
 */
export function persistSearchRange(from: string, to: string): void {
  try {
    sessionStorage.setItem(FROM_KEY, from)
    sessionStorage.setItem(TO_KEY, to)
  } catch {
    // storage unavailable — skip retention
  }
}

/** The last persisted range, or null when absent, partial, or unavailable. */
export function readPersistedRange(): { from: string; to: string } | null {
  try {
    const from = sessionStorage.getItem(FROM_KEY)
    const to = sessionStorage.getItem(TO_KEY)
    return from && to ? { from, to } : null
  } catch {
    return null
  }
}
