import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { type QueryClient, queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// #611: operator in-app "new order" red-dot badge. There is no server-side
// unread/seen state (`/notifications` is an email-delivery log, not an inbox),
// so "new" is defined client-side as: CONFIRMED bookings whose `createdAt` is
// after the operator last opened the orders list. `lastSeenAt` lives in
// localStorage (per-device, no migration) and is mirrored into the React Query
// cache so the Navbar badge and the orders-route clear-on-visit stay in sync.

export const LAST_SEEN_STORAGE_KEY = 'kuruma_bookings_last_seen_at'

// #1230 slice 5a keyed the scan per operator; #1324 keys the watermark to match, so a
// picker admin switching operators measures each operator's badge against ITS OWN
// last-seen instant instead of whichever operator's was advanced last. No-pick (tenant
// sessions) keeps the bare base storage key and a `null` query slot — a single stable
// watermark, no migration/reset. markBookingsSeen and lastSeenQueryOptions both derive
// from these, so clear-on-visit and the badge read always share one key per pick.
export function lastSeenStorageKey(pickedOperatorId?: string): string {
  return pickedOperatorId ? `${LAST_SEEN_STORAGE_KEY}:${pickedOperatorId}` : LAST_SEEN_STORAGE_KEY
}

export function lastSeenQueryKey(pickedOperatorId?: string) {
  return ['operator-bookings', 'last-seen-at', pickedOperatorId ?? null] as const
}

// #1230 slice 5a: the scan is keyed by the picked operator (null = no pick) so a
// picker admin switching operators gets that operator's own count instead of a
// stale cross-operator cache hit. All entries share the `operator-bookings` prefix,
// so a booking write's OPERATOR_BOOKINGS_KEY invalidation still cascades to every
// per-operator scan. markBookingsSeen reads the SAME key, so the clear-on-visit
// advances the right entry.
export function newOrderScanQueryKey(pickedOperatorId: string | undefined) {
  return ['operator-bookings', 'new-order-scan', pickedOperatorId ?? null] as const
}

// The badge only needs to count, so it pulls the newest page (the list is
// ordered createdAt DESC, so recent orders are always on page 1) and reads just
// the timestamp. 50 comfortably exceeds any realistic since-last-visit burst for
// a 40-50 car operator; a higher true count is fine to display as "9+".
const NEW_ORDER_SCAN_LIMIT = 50
// The operator portal is low-traffic — a slow poll plus refetch-on-focus is
// plenty; a tight loop would hammer the API for a cosmetic dot.
const NEW_ORDER_REFETCH_MS = 60_000

/** Minimal row the badge needs: just the creation timestamp (ISO JSON). The
 *  /bookings rows carry ~25 other fields; this non-strict schema validates only
 *  createdAt (always a non-null timestamptz) and strips the rest (#711). */
const newOrderBookingSchema = z.object({
  createdAt: z.string(),
})

export type NewOrderBooking = z.infer<typeof newOrderBookingSchema>

/** Pure: how many bookings were created strictly after the last-seen instant. */
export function countNewBookings(bookings: readonly NewOrderBooking[], lastSeenAt: string): number {
  const threshold = new Date(lastSeenAt).getTime()
  return bookings.filter((b) => new Date(b.createdAt).getTime() > threshold).length
}

export async function fetchNewOrderBookings(pickedOperatorId?: string): Promise<NewOrderBooking[]> {
  // Operator-scoped server-side via the session cookie (CallerContext). A picker
  // admin (bypass) may narrow to one operator via `operatorId`; the API drops it
  // for any non-bypass caller, so a cross-tenant read stays impossible (#1230 H2).
  const sp = new URLSearchParams({ status: 'CONFIRMED', limit: String(NEW_ORDER_SCAN_LIMIT) })
  if (pickedOperatorId) sp.set('operatorId', pickedOperatorId)
  const res = await fetch(`${getApiBaseUrl()}/bookings?${sp.toString()}`, {
    credentials: 'include',
  })
  // The schema strips every field but createdAt, so the parsed rows already are
  // the minimal NewOrderBooking shape — no post-map narrowing needed.
  return unwrap(res, newOrderBookingSchema.array())
}

export function newOrderBookingsQueryOptions(enabled: boolean, pickedOperatorId?: string) {
  return queryOptions({
    queryKey: newOrderScanQueryKey(pickedOperatorId),
    queryFn: () => fetchNewOrderBookings(pickedOperatorId),
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
export function getStoredLastSeenAt(pickedOperatorId?: string): string {
  const storageKey = lastSeenStorageKey(pickedOperatorId)
  const stored = window.localStorage.getItem(storageKey)
  if (stored) return stored
  const now = new Date().toISOString()
  window.localStorage.setItem(storageKey, now)
  return now
}

export function lastSeenQueryOptions(pickedOperatorId?: string) {
  return queryOptions({
    queryKey: lastSeenQueryKey(pickedOperatorId),
    queryFn: () => getStoredLastSeenAt(pickedOperatorId),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * Mark the orders list as seen: advance `lastSeenAt` in both storage and the
 * query cache so the nav badge re-derives its count to 0 immediately.
 *
 * It anchors to the newest order actually scanned (a server-minted `createdAt`)
 * rather than the client clock: `createdAt` is compared against `lastSeenAt`, so
 * mixing a client `Date.now()` with server timestamps would mis-clear (clock
 * behind) or bury new orders (clock ahead) under any skew. The scan is ordered
 * createdAt DESC, so the head is the newest seen order; fall back to now only
 * when nothing has been scanned (no orders, or the scan hasn't loaded).
 */
export function markBookingsSeen(queryClient: QueryClient, pickedOperatorId?: string): void {
  const scanned = queryClient.getQueryData<NewOrderBooking[]>(
    newOrderScanQueryKey(pickedOperatorId),
  )
  const seenAt = scanned?.[0]?.createdAt ?? new Date().toISOString()
  window.localStorage.setItem(lastSeenStorageKey(pickedOperatorId), seenAt)
  queryClient.setQueryData(lastSeenQueryKey(pickedOperatorId), seenAt)
}
