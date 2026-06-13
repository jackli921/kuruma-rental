import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { type QueryClient, queryOptions } from '@tanstack/react-query'

// #611: operator in-app "new order" red-dot badge. There is no server-side
// unread/seen state (`/notifications` is an email-delivery log, not an inbox),
// so "new" is defined client-side as: CONFIRMED bookings whose `createdAt` is
// after the operator last opened the orders list. `lastSeenAt` lives in
// localStorage (per-device, no migration) and is mirrored into the React Query
// cache so the Navbar badge and the orders-route clear-on-visit stay in sync.

export const LAST_SEEN_STORAGE_KEY = 'kuruma_bookings_last_seen_at'
export const LAST_SEEN_QUERY_KEY = ['operator-bookings', 'last-seen-at'] as const

// The badge only needs to count, so it pulls the newest page (the list is
// ordered createdAt DESC, so recent orders are always on page 1) and reads just
// the timestamp. 50 comfortably exceeds any realistic since-last-visit burst for
// a 40-50 car operator; a higher true count is fine to display as "9+".
const NEW_ORDER_SCAN_LIMIT = 50
// The operator portal is low-traffic — a slow poll plus refetch-on-focus is
// plenty; a tight loop would hammer the API for a cosmetic dot.
const NEW_ORDER_REFETCH_MS = 60_000

/** Minimal row the badge needs: just the creation timestamp (ISO JSON). */
export interface NewOrderBooking {
  createdAt: string
}

/** Pure: how many bookings were created strictly after the last-seen instant. */
export function countNewBookings(bookings: readonly NewOrderBooking[], lastSeenAt: string): number {
  const threshold = new Date(lastSeenAt).getTime()
  return bookings.filter((b) => new Date(b.createdAt).getTime() > threshold).length
}

export async function fetchNewOrderBookings(): Promise<NewOrderBooking[]> {
  // Operator-scoped server-side via the session cookie (CallerContext) — no
  // operatorId is passed, so a cross-tenant read is impossible by construction.
  const sp = new URLSearchParams({ status: 'CONFIRMED', limit: String(NEW_ORDER_SCAN_LIMIT) })
  const res = await fetch(`${getApiBaseUrl()}/bookings?${sp.toString()}`, {
    credentials: 'include',
  })
  const data = await unwrap<NewOrderBooking[]>(res)
  return data.map((b) => ({ createdAt: b.createdAt }))
}

export function newOrderBookingsQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: ['operator-bookings', 'new-order-scan'],
    queryFn: fetchNewOrderBookings,
    enabled,
    refetchOnWindowFocus: true,
    refetchInterval: NEW_ORDER_REFETCH_MS,
    staleTime: 30_000,
  })
}

/**
 * Read `lastSeenAt` from localStorage. On a fresh device there is no record of
 * when the operator last looked, so initialize to *now* (and persist) rather
 * than the epoch — otherwise the badge would light up with the entire existing
 * backlog, which is not "new".
 */
export function getStoredLastSeenAt(): string {
  const stored = window.localStorage.getItem(LAST_SEEN_STORAGE_KEY)
  if (stored) return stored
  const now = new Date().toISOString()
  window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, now)
  return now
}

export function lastSeenQueryOptions() {
  return queryOptions({
    queryKey: LAST_SEEN_QUERY_KEY,
    queryFn: () => getStoredLastSeenAt(),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * Mark the orders list as seen: advance `lastSeenAt` to now in both storage and
 * the query cache. Writing to the cache makes the nav badge re-derive its count
 * to 0 immediately (every existing booking is now <= lastSeenAt).
 */
export function markBookingsSeen(queryClient: QueryClient): void {
  const now = new Date().toISOString()
  window.localStorage.setItem(LAST_SEEN_STORAGE_KEY, now)
  queryClient.setQueryData(LAST_SEEN_QUERY_KEY, now)
}
