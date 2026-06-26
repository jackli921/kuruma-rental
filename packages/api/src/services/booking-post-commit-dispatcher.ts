import type { CallerContext } from '../middleware/auth'
import type { Booking } from '../stores'
import type { LifecycleTrigger } from './notification-dispatcher'

type EnsureThread = (ctx: CallerContext, booking: Booking) => Promise<void>
interface NotificationDispatch {
  dispatch(booking: Booking, trigger?: LifecycleTrigger): Promise<void>
}

/**
 * Runs a booking's post-commit side effects, in order: (1) ensure the message
 * thread, (2) dispatch notifications. Invoked from booking-creation (fresh
 * create + both idempotency-replay paths) and, since #664, booking-lifecycle
 * (SUBSTITUTED, dynamic status triggers, CANCELLED).
 *
 * Every effect is idempotent (thread keys on booking:<id>; notifications upsert
 * + skip SENT), and two heal paths cover a half-completed first attempt:
 *   - create path: a client idempotency replay re-runs this and REPAIRS the
 *     missing thread / notification inline.
 *   - ALL paths (incl. one-shot lifecycle emails that have no replay): the
 *     #1125 daily retry sweep re-drives any reclaimable notification_log row
 *     back through the same processOne machinery.
 *
 * Each effect is caught-and-logged: the booking is authoritative, so a failed
 * thread or send NEVER propagates back into the booking write path.
 */
export class BookingPostCommitDispatcher {
  constructor(
    private readonly ensureThread: EnsureThread,
    private readonly notifications: NotificationDispatch,
  ) {}

  async run(
    ctx: CallerContext,
    booking: Booking,
    trigger: LifecycleTrigger = 'CREATED',
  ): Promise<void> {
    // Defense-in-depth: makeEnsureThread already self-catches (incl. the benign
    // concurrent-create race), so this wrapper is a belt-and-braces backstop.
    await this.safely('thread', () => this.ensureThread(ctx, booking))
    // Load-bearing: dispatch -> processOne THROWS on infra errors (resolveRecipient
    // / upsertQueued), so this catch is what keeps a notification outage from
    // propagating back into — and rolling back — the already-committed booking.
    await this.safely('notifications', () => this.notifications.dispatch(booking, trigger))
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
