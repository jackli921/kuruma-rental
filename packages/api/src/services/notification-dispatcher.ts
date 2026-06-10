import { SYSTEM_CONTEXT } from '../middleware/auth'
import type {
  LocationRepository,
  NotificationLogRepository,
  OperatorRepository,
  UserRepository,
  VehicleRepository,
} from '../repositories/types'
import type { Booking, NotificationLog } from '../stores'
import type { EmailSender } from './email/email-sender'
import { renderOperatorAlert } from './email/templates/operator-alert'
import { renderRenterConfirmation } from './email/templates/renter-confirmation'

type Kind = NotificationLog['kind']
const KINDS: Kind[] = ['RENTER_BOOKING_CONFIRM', 'OPERATOR_BOOKING_ALERT']
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

  async dispatch(booking: Booking): Promise<void> {
    for (const kind of KINDS) {
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
      console.error('[notification] send failed', { id: claimed.id, kind, reason })
      await this.notificationLogRepo.markFailed(claimed.id, reason.slice(0, 500))
      return { result: 'failed', row: { ...claimed, status: 'FAILED', error: reason } }
    }
  }

  private async resolveRecipient(booking: Booking, kind: Kind): Promise<Resolved | undefined> {
    if (kind === 'RENTER_BOOKING_CONFIRM') {
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

    if (kind === 'RENTER_BOOKING_CONFIRM') {
      const { subject, html, text } = renderRenterConfirmation(
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
      )
      return {
        to: recipient,
        from: this.config.emailFrom,
        subject,
        html,
        text,
        ...(replyTo ? { replyTo } : {}),
      }
    }

    const [renter] = await this.userRepo.findByIds([booking.renterId])
    const { subject, html, text } = renderOperatorAlert(
      { ...common, renterName: renter?.name ?? null },
      locale,
    )
    return {
      to: recipient,
      from: this.config.emailFrom,
      subject,
      html,
      text,
      ...(replyTo ? { replyTo } : {}),
    }
  }
}
