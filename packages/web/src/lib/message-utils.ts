import type { ThreadSummaryData } from '@/lib/message-api'

/**
 * For 1-on-1 threads, return the other participant's user id.
 * For group threads or when caller is not a participant, return null.
 */
export function getCounterpartyId(
  thread: Pick<ThreadSummaryData, 'participants'>,
  currentUserId: string,
): string | null {
  const others = thread.participants.filter((p) => p.userId !== currentUserId)
  return others[0]?.userId ?? null
}

export function getMyUnreadCount(
  thread: Pick<ThreadSummaryData, 'participants'>,
  currentUserId: string,
): number {
  const me = thread.participants.find((p) => p.userId === currentUserId)
  return me?.unreadCount ?? 0
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  const diff = now.getTime() - then
  if (diff < MINUTE) return 'now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
