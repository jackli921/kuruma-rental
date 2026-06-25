import type { ThreadSummaryDto } from './api'

// Project the renter's thread list into a bookingId -> threadId lookup so a
// booking surface (confirmation, My Bookings) can deep-link to its conversation.
// Threads with no booking (none today, but the column is nullable) are skipped.
export function indexThreadIdsByBooking(
  threads: readonly ThreadSummaryDto[],
): Record<string, string> {
  return Object.fromEntries(
    threads.flatMap((thread) => (thread.bookingId ? [[thread.bookingId, thread.id] as const] : [])),
  )
}
