import type { CallerContext } from '../middleware/auth'
import type { ThreadRepository } from '../repositories/types'
import type { Booking } from '../stores'

export interface BookingThreading {
  threadRepo: ThreadRepository
  staffUserId: string
}

export type EnsureThread = (ctx: CallerContext, booking: Booking) => Promise<void>

/**
 * Auto-create the booking's message thread (#335). Post-commit + idempotent on
 * `booking:<id>`, so a replay is a no-op (or repairs a thread that was never
 * created). The booking is authoritative — a thread failure is logged, never
 * thrown, so it cannot roll back the booking. Extracted from BookingService so
 * the BookingPostCommitDispatcher (#393, TODO #300) can compose it with the
 * notification dispatch at the single post-commit seam.
 */
export function makeEnsureThread(threading: BookingThreading): EnsureThread {
  return async (ctx, booking) => {
    const threadKey = `booking:${booking.id}`
    try {
      const existing = await threading.threadRepo.findByIdempotencyKey(ctx, threadKey)
      if (existing) return
      await threading.threadRepo.create(
        ctx,
        booking.id,
        [booking.renterId, threading.staffUserId],
        threadKey,
      )
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'thread_autocreate_failed',
          bookingId: booking.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }
}
