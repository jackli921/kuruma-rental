import { SYSTEM_CONTEXT } from '../middleware/auth'
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
      // The idempotency probe is infrastructure, not a caller-scoped read: it
      // asks "does this booking's thread already exist?", so it MUST run under
      // SYSTEM_CONTEXT. A caller who isn't a thread participant — a PARTNER
      // (Trip.com) booking, or an operator manual booking, neither of which is
      // in [renterId, staffUserId] — would otherwise miss an existing thread on
      // replay and re-fire the insert into a benign-but-noisy UNIQUE_VIOLATION
      // (worsened once #1168 dropped PARTNER from PRIVILEGED_ROLES). The create
      // stays on the caller ctx; participants are fixed below regardless.
      const existing = await threading.threadRepo.findByIdempotencyKey(SYSTEM_CONTEXT, threadKey)
      if (existing) return
      await threading.threadRepo.create(
        ctx,
        booking.id,
        [booking.renterId, threading.staffUserId],
        threadKey,
        // Tenant owner (#1205), server-derived from the authoritative booking so
        // the operator portal can read-scope this thread by operatorId.
        booking.operatorId,
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
