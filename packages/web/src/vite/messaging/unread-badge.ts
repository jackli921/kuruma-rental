import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { type ThreadSummaryDto, threadsQueryOptions } from './api'

// #1032: the renter's in-app unread-message nav badge. Unlike the operator
// "new order" badge (#611, derived from a client-side localStorage lastSeenAt),
// unread state is tracked server-side per participant — the API increments my
// participant row on a counterpart's send and zeroes it on /read. So the count
// is simply the sum of *my* participant `unreadCount` across every thread; no
// device-local seen-state to keep in sync.

/** Pure: total unread messages addressed to `userId` across their threads. */
export function countUnread(threads: readonly ThreadSummaryDto[], userId: string): number {
  return threads.reduce((sum, thread) => {
    const mine = thread.participants.find((p) => p.userId === userId)
    return sum + (mine?.unreadCount ?? 0)
  }, 0)
}

/**
 * The count behind the renter's Messages nav badge. Shares the inbox threads
 * cache entry (threadsQueryOptions), so opening the inbox — which marks threads
 * read and refetches — re-derives the badge to 0 with no extra request.
 * `enabled` is false outside renter view so the query never fires there.
 */
export function useUnreadBadge({
  userId,
  enabled,
}: { userId: string | undefined; enabled: boolean }): { count: number } {
  const { data: threads } = useQuery({ ...threadsQueryOptions(), enabled })

  const count = useMemo(
    () => (enabled && userId ? countUnread(threads ?? [], userId) : 0),
    [enabled, userId, threads],
  )

  return { count }
}

// #1205 slice 3: the operator-side twin. Operator unread is tenant-level (one
// shared inbox), so it lives on the thread (operatorUnreadCount) rather than on a
// per-user participant row — the operator viewing isn't a thread participant.

/** Pure: total operator-side unread across the tenant's threads (the `/threads`
 *  list is already operator-scoped server-side, so this is just a sum). */
export function countOperatorUnread(threads: readonly ThreadSummaryDto[]): number {
  return threads.reduce((sum, thread) => sum + thread.operatorUnreadCount, 0)
}

/**
 * The count behind the operator's Messages nav badge. Reuses the same threads
 * cache as the operator inbox (the `/threads` endpoint scopes to the caller's
 * tenant), so opening a thread — which marks it read and invalidates the cache —
 * re-derives the badge with no extra request. `enabled` is false outside business
 * view so the query never fires there.
 */
export function useOperatorUnreadBadge({ enabled }: { enabled: boolean }): { count: number } {
  const { data: threads } = useQuery({ ...threadsQueryOptions(), enabled })

  const count = useMemo(
    () => (enabled ? countOperatorUnread(threads ?? []) : 0),
    [enabled, threads],
  )

  return { count }
}
