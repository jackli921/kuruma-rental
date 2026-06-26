import { SYSTEM_CONTEXT } from '../middleware/auth'
import type { BookingRepository, NotificationLogRepository } from '../repositories/types'
import type { Booking, NotificationLog } from '../stores'
import type { DispatchOutcome } from './notification-dispatcher'

/**
 * Per-run tally, logged like the other crons so a glance at the worker log answers
 * "did the sweep re-drive anything, and how did it land?". `sent` = a delivery
 * happened this run; `failed` = the re-attempt failed (retried next run unless it
 * hit the DEAD cap); `skipped` = nothing to do (already SENT, a live lease, a
 * terminal DEAD/NO_RECIPIENT row, or a vanished booking).
 */
export interface NotificationRetrySummary {
  attempted: number
  sent: number
  failed: number
  skipped: number
}

/**
 * The single entry point the sweep drives — the idempotent send unit shared with
 * the post-commit dispatch and the operator resend (NotificationDispatcher
 * satisfies this). Narrow by design (ISP): the backstop only re-drives one
 * (booking, kind), never the dispatcher's fan-out `dispatch`.
 */
export interface NotificationRedriver {
  processOne(booking: Booking, kind: NotificationLog['kind']): Promise<DispatchOutcome>
}

export interface NotificationRetryServiceDeps {
  notificationLogRepo: Pick<NotificationLogRepository, 'findRetryable'>
  bookingRepo: Pick<BookingRepository, 'findById'>
  redriver: NotificationRedriver
}

const DEFAULT_LIMIT = 200

/**
 * #1125: the daily notification retry backstop — structural sibling of the #851
 * refund reconciler. A bounded, failure-isolated sweep over notification_log rows
 * durably stuck retryable (QUEUED / FAILED / a crashed-SENDING lease) re-enters the
 * SAME idempotent send unit (processOne): claim re-arms the row, the provider is
 * retried, and the attempts cap still flips a poison recipient to terminal DEAD.
 *
 * Without it, a one-shot LIFECYCLE notification (cancellation / substitution / trip
 * status — kinds with no client-replay path) that failed its first send was lost
 * until a human spotted the FAILED row in the operator portal: the attempts/MAX
 * machinery only ever fired on a manual resend, never automatically.
 */
export class NotificationRetryService {
  constructor(private readonly deps: NotificationRetryServiceDeps) {}

  async run(opts: { limit?: number } = {}): Promise<NotificationRetrySummary> {
    const limit = opts.limit ?? DEFAULT_LIMIT
    const rows = await this.deps.notificationLogRepo.findRetryable(limit)

    let sent = 0
    let failed = 0
    let skipped = 0
    for (const row of rows) {
      try {
        const booking = await this.deps.bookingRepo.findById(SYSTEM_CONTEXT, row.bookingId)
        if (!booking) {
          // A retryable row whose booking vanished can never resolve a recipient —
          // log once and skip so it can't wedge the batch (bookings aren't hard-
          // deleted today; this is a defensive guard, not an expected path).
          console.error('[cron:notification-retry] booking missing; skipping', {
            id: row.id,
            bookingId: row.bookingId,
          })
          skipped++
          continue
        }
        const outcome = await this.deps.redriver.processOne(booking, row.kind)
        if (outcome.result === 'sent') sent++
        else if (outcome.result === 'failed') failed++
        else skipped++ // already_sent | in_progress | abandoned | no_recipient — no action
      } catch (err) {
        // processOne can throw on an INFRA error (the recipient read, the claim) —
        // one poison row must never abort the sweep. The row stays retryable for
        // the next run.
        console.error('[cron:notification-retry] redrive threw; left for next run', {
          id: row.id,
          error: err instanceof Error ? err.message : String(err),
        })
        failed++
      }
    }
    return { attempted: rows.length, sent, failed, skipped }
  }
}
