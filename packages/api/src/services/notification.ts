import { SYSTEM_CONTEXT } from '../middleware/auth'
import type {
  BookingRepository,
  CallerContext,
  NotificationLogFilters,
  NotificationLogRepository,
} from '../repositories/types'
import type { NotificationLog } from '../stores'
import type { NotificationDispatcher } from './notification-dispatcher'

export type ResendResult =
  | {
      ok: true
      status: NotificationLog['status']
      outcome: 'resent' | 'already_sent' | 'in_progress'
    }
  | { ok: false; status: number; error: string }

/**
 * Operator-portal surface for the notification ledger: a scoped list and a manual
 * resend. Resend runs the SAME claim->send->update path as the post-commit
 * dispatch (via NotificationDispatcher.processOne), so two concurrent resends of
 * one row send exactly once and a stuck SENDING is reclaimed only after its lease.
 */
export class NotificationService {
  constructor(
    private readonly notificationLogRepo: NotificationLogRepository,
    private readonly bookingRepo: BookingRepository,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  findAll(ctx: CallerContext, filters?: NotificationLogFilters): Promise<NotificationLog[]> {
    return this.notificationLogRepo.findAll(ctx, filters)
  }

  async resend(ctx: CallerContext, id: string): Promise<ResendResult> {
    // Scoped read: a cross-operator id resolves to undefined -> 404 (no leak).
    const row = await this.notificationLogRepo.findById(ctx, id)
    if (!row) return { ok: false, status: 404, error: 'Notification not found' }

    // Platform-internal reload — the booking already passed tenant checks at create.
    const booking = await this.bookingRepo.findById(SYSTEM_CONTEXT, row.bookingId)
    if (!booking) return { ok: false, status: 404, error: 'Booking not found' }

    const outcome = await this.dispatcher.processOne(booking, row.kind)
    switch (outcome.result) {
      case 'no_recipient':
        return { ok: false, status: 422, error: 'No resolvable recipient' }
      // #483: a DEAD row has exhausted its attempt cap — never re-send it.
      case 'abandoned':
        return { ok: false, status: 422, error: 'Notification abandoned after max attempts' }
      case 'failed':
        return { ok: false, status: 502, error: outcome.row.error ?? 'Send failed' }
      case 'sent':
        return { ok: true, status: 'SENT', outcome: 'resent' }
      case 'already_sent':
        return { ok: true, status: 'SENT', outcome: 'already_sent' }
      case 'in_progress':
        return { ok: true, status: 'SENDING', outcome: 'in_progress' }
    }
  }
}
