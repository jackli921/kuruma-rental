import { SYSTEM_CONTEXT } from '../middleware/auth'
import {
  type LocationRepository,
  MAX_NOTIFICATION_ATTEMPTS,
  type NotificationLogRepository,
  type OperatorRepository,
  type UserRepository,
  type VehicleRepository,
} from '../repositories/types'
import type { Booking, NotificationLog } from '../stores'
import type { EmailSender } from './email/email-sender'
import { renderOperatorAlert } from './email/templates/operator-alert'
import { renderRenterCancellation } from './email/templates/renter-cancellation'
import { renderRenterConfirmation } from './email/templates/renter-confirmation'
import { renderRenterStatusUpdate } from './email/templates/renter-status-update'
import { renderRenterSubstitution } from './email/templates/renter-substitution'

type Kind = NotificationLog['kind']

/**
 * #664: the booking lifecycle event that triggered a dispatch. `CREATED` fans
 * out to the original renter-confirm + operator-alert pair; each operator action
 * maps to exactly ONE renter kind. Distinct kinds (not a generic status change)
 * keep the `notify:<booking>:<kind>` idempotency key collision-free across a
 * sequence like ACTIVATED-then-COMPLETED on the same booking.
 */
export type LifecycleTrigger = 'CREATED' | 'SUBSTITUTED' | 'CANCELLED' | 'ACTIVATED' | 'COMPLETED'

const TRIGGER_KINDS: Record<LifecycleTrigger, Kind[]> = {
  CREATED: ['RENTER_BOOKING_CONFIRM', 'OPERATOR_BOOKING_ALERT'],
  SUBSTITUTED: ['RENTER_SUBSTITUTION'],
  CANCELLED: ['RENTER_CANCELLATION'],
  ACTIVATED: ['RENTER_TRIP_STARTED'],
  COMPLETED: ['RENTER_TRIP_COMPLETED'],
}
const DEFAULT_OPERATOR_LOCALE = 'ja' // §12.2

export interface NotificationDispatcherConfig {
  emailFrom: string
  emailReplyTo?: string | undefined
  // Operator-alert recipient of last resort when an operator has no owner user.
  fallbackOperatorEmail?: string | undefined
}

interface Resolved {
  recipient: string
  locale: string
}

/**
 * Explicit result of one processOne attempt, so callers (notably the operator
 * resend) never have to re-derive "did a send actually happen?" from a status
 * that conflates a fresh send with a no-op. `claim()` returns null only for a
 * terminal SENT row or a live (non-expired) SENDING lease, which is exactly the
 * already_sent / in_progress split.
 */
export type DispatchOutcome =
  | { result: 'sent'; row: NotificationLog }
  | { result: 'failed'; row: NotificationLog }
  | { result: 'already_sent'; row: NotificationLog }
  | { result: 'in_progress'; row: NotificationLog }
  // #483: the row is terminal DEAD (failed MAX_NOTIFICATION_ATTEMPTS times); claim()
  // never re-arms it, so neither a replay nor a resend will invoke the provider.
  | { result: 'abandoned'; row: NotificationLog }
  | { result: 'no_recipient' }

/**
 * Turns a committed booking into outbound email. Owns the upsert -> atomic claim
 * -> render -> send -> mark unit (processOne), reused by both the post-commit
 * dispatch and the operator-portal resend. Never throws to its caller — a send
 * failure is logged + recorded FAILED; the booking stays authoritative.
 */
export class NotificationDispatcher {
  constructor(
    private readonly notificationLogRepo: NotificationLogRepository,
    private readonly operatorRepo: OperatorRepository,
    private readonly vehicleRepo: VehicleRepository,
    private readonly userRepo: UserRepository,
    private readonly locationRepo: LocationRepository,
    private readonly emailSender: EmailSender,
    private readonly config: NotificationDispatcherConfig,
  ) {}

  async dispatch(booking: Booking, trigger: LifecycleTrigger = 'CREATED'): Promise<void> {
    for (const kind of TRIGGER_KINDS[trigger]) {
      await this.processOne(booking, kind)
    }
  }

  /**
   * Idempotent send unit for one (booking, kind). Upserts a QUEUED row, atomically
   * claims it, renders + sends, and records the terminal state. A null claim is a
   * no-op — already_sent (terminal SENT) or in_progress (a live SENDING lease held
   * by another sender). Returns an explicit DispatchOutcome so callers don't infer
   * "did we send?" from a status.
   */
  async processOne(booking: Booking, kind: Kind): Promise<DispatchOutcome> {
    const resolved = await this.resolveRecipient(booking, kind)
    if (!resolved) {
      console.error('[notification] no recipient', { bookingId: booking.id, kind })
      return { result: 'no_recipient' }
    }

    const row = await this.notificationLogRepo.upsertQueued({
      bookingId: booking.id,
      operatorId: booking.operatorId,
      kind,
      recipient: resolved.recipient,
      locale: resolved.locale,
      idempotencyKey: `notify:${booking.id}:${kind}`,
    })

    const claimed = await this.notificationLogRepo.claim(row.id)
    if (!claimed) {
      // claim() only declines a terminal SENT row, a terminal DEAD row (#483), or a
      // live (non-expired) SENDING lease — QUEUED/FAILED/expired-SENDING are always
      // claimable. So the un-claimed status disambiguates the three terminal cases.
      if (row.status === 'SENT') return { result: 'already_sent', row }
      if (row.status === 'DEAD') return { result: 'abandoned', row }
      return { result: 'in_progress', row }
    }

    try {
      const message = await this.buildMessage(booking, kind, claimed.recipient, claimed.locale)
      const { providerMessageId } = await this.emailSender.send(message)
      await this.notificationLogRepo.markSent(claimed.id, providerMessageId)
      return { result: 'sent', row: { ...claimed, status: 'SENT', providerMessageId } }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      await this.notificationLogRepo.markFailed(claimed.id, reason.slice(0, 500))
      // claim() already bumped attempts, so this is the cap predicate markFailed
      // applied — mirror it here for a truthful outcome status + a distinct
      // abandonment signal (a silently-DEAD notification is a booking nobody acts on).
      const status = claimed.attempts >= MAX_NOTIFICATION_ATTEMPTS ? 'DEAD' : 'FAILED'
      if (status === 'DEAD') {
        console.error('[notification] abandoned after max attempts', {
          id: claimed.id,
          kind,
          attempts: claimed.attempts,
          reason,
        })
      } else {
        console.error('[notification] send failed', { id: claimed.id, kind, reason })
      }
      return { result: 'failed', row: { ...claimed, status, error: reason } }
    }
  }

  private async resolveRecipient(booking: Booking, kind: Kind): Promise<Resolved | undefined> {
    // Every renter-facing kind (#393 confirm + #664 lifecycle) goes to the renter.
    if (kind.startsWith('RENTER_')) {
      const [renter] = await this.userRepo.findByIds([booking.renterId])
      if (!renter?.email) return undefined
      return { recipient: renter.email, locale: renter.language || 'en' }
    }
    // OPERATOR_BOOKING_ALERT — first owner, else the platform ops fallback.
    const owners = await this.userRepo.findOperatorContacts(booking.operatorId)
    const recipient = owners[0]?.email ?? this.config.fallbackOperatorEmail
    if (!recipient) return undefined
    return { recipient, locale: DEFAULT_OPERATOR_LOCALE }
  }

  private async buildMessage(booking: Booking, kind: Kind, recipient: string, locale: string) {
    const [operator, vehicle, pickup, dropoff] = await Promise.all([
      this.operatorRepo.findById(booking.operatorId),
      this.vehicleRepo.findById(SYSTEM_CONTEXT, booking.assignedVehicleId),
      this.locationRepo.findById(SYSTEM_CONTEXT, booking.pickupLocationId),
      this.locationRepo.findById(SYSTEM_CONTEXT, booking.dropoffLocationId),
    ])
    const vehicleData = {
      name: vehicle?.name ?? 'Vehicle',
      make: vehicle?.make ?? null,
      model: vehicle?.model ?? null,
      licensePlate: vehicle?.licensePlate ?? null,
    }
    const pickupName = pickup?.name ?? booking.pickupLocationId
    const dropoffName = dropoff?.name ?? booking.dropoffLocationId
    const common = {
      bookingCode: booking.bookingCode,
      vehicle: vehicleData,
      pickupLocationName: pickupName,
      dropoffLocationName: dropoffName,
      startAt: booking.startAt,
      endAt: booking.endAt,
      totalPriceJpy: booking.totalPrice,
    }
    const replyTo = this.config.emailReplyTo
    const envelope = (r: { subject: string; html: string; text: string }) => ({
      to: recipient,
      from: this.config.emailFrom,
      subject: r.subject,
      html: r.html,
      text: r.text,
      ...(replyTo ? { replyTo } : {}),
    })

    switch (kind) {
      case 'RENTER_BOOKING_CONFIRM':
        return envelope(
          renderRenterConfirmation(
            {
              ...common,
              operatorName: operator?.name ?? '',
              insurance: booking.insuranceSnapshot
                ? {
                    name: booking.insuranceSnapshot.name,
                    dailyPriceJpy: booking.insuranceSnapshot.dailyPriceJpy,
                  }
                : null,
              fees: booking.feeSnapshot,
              preAuthHandoffUrl: operator?.preAuthHandoffUrl ?? null,
            },
            locale,
          ),
        )
      case 'RENTER_SUBSTITUTION':
        // The NEW assigned vehicle only — reason + actor id are never passed in.
        return envelope(
          renderRenterSubstitution(
            {
              bookingCode: booking.bookingCode,
              vehicle: vehicleData,
              pickupLocationName: pickupName,
              dropoffLocationName: dropoffName,
              startAt: booking.startAt,
              endAt: booking.endAt,
            },
            locale,
          ),
        )
      case 'RENTER_CANCELLATION':
        return envelope(
          renderRenterCancellation(
            {
              bookingCode: booking.bookingCode,
              startAt: booking.startAt,
              endAt: booking.endAt,
              cancellationFeeJpy: booking.cancellationFee,
            },
            locale,
          ),
        )
      case 'RENTER_TRIP_STARTED':
      case 'RENTER_TRIP_COMPLETED':
        return envelope(
          renderRenterStatusUpdate(
            {
              status: kind === 'RENTER_TRIP_STARTED' ? 'ACTIVE' : 'COMPLETED',
              bookingCode: booking.bookingCode,
              vehicle: vehicleData,
              pickupLocationName: pickupName,
              dropoffLocationName: dropoffName,
              startAt: booking.startAt,
              endAt: booking.endAt,
            },
            locale,
          ),
        )
      default: {
        // OPERATOR_BOOKING_ALERT
        const [renter] = await this.userRepo.findByIds([booking.renterId])
        return envelope(
          renderOperatorAlert({ ...common, renterName: renter?.name ?? null }, locale),
        )
      }
    }
  }
}
