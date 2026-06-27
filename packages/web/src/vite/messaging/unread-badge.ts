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
