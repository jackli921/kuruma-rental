const FROM_KEY = 'kuruma.search.from'
const TO_KEY = 'kuruma.search.to'
const REGION_KEY = 'kuruma.search.region'

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

/**
 * Remember the renter's last region anchor so the hero widget restores it on
 * return instead of resetting to "Anywhere". A null region (the "Anywhere"
 * choice) clears the key so a stale region never resurfaces. Best-effort, same
 * as the range helpers.
 */
export function persistSearchRegion(region: string | null): void {
  try {
    if (region) sessionStorage.setItem(REGION_KEY, region)
    else sessionStorage.removeItem(REGION_KEY)
  } catch {
    // storage unavailable — skip retention
  }
}

/** The last persisted region slug, or null when absent or unavailable. */
export function readPersistedRegion(): string | null {
  try {
    return sessionStorage.getItem(REGION_KEY)
  } catch {
    return null
  }
}
