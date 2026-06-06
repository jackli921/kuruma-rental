import type { CallerContext } from '../middleware/auth'
import type { Booking } from '../stores'

type EnsureThread = (ctx: CallerContext, booking: Booking) => Promise<void>
interface NotificationDispatch {
  dispatch(booking: Booking): Promise<void>
}

/**
 * Runs a booking's post-commit side effects, in order: (1) ensure the message
 * thread, (2) dispatch notifications. Invoked at EVERY site where ensureThread
 * fired before (fresh create + both idempotency-replay paths) so a replay of a
 * booking whose first attempt half-completed REPAIRS it — every effect is
 * idempotent (thread keys on booking:<id>; notifications upsert + skip SENT).
 *
 * Each effect is caught-and-logged: the booking is authoritative, so a failed
 * thread or send NEVER propagates back into the booking write path.
 */
export class BookingPostCommitDispatcher {
  constructor(
    private readonly ensureThread: EnsureThread,
    private readonly notifications: NotificationDispatch,
  ) {}

  async run(ctx: CallerContext, booking: Booking): Promise<void> {
    await this.safely('thread', () => this.ensureThread(ctx, booking))
    await this.safely('notifications', () => this.notifications.dispatch(booking))
  }

  private async safely(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`[post-commit:${label}] failed`, { reason })
    }
  }
}
