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
import type { EmailMessage, EmailSender } from './email/email-sender'
import { renderOperatorAlert } from './email/templates/operator-alert'
import { renderOperatorNewMessage } from './email/templates/operator-new-message'
import { renderRenterCancellation } from './email/templates/renter-cancellation'
import { renderRenterConfirmation } from './email/templates/renter-confirmation'
import { renderRenterReviewPrompt } from './email/templates/renter-review-prompt'
import { renderRenterStatusUpdate } from './email/templates/renter-status-update'
import { renderRenterSubstitution } from './email/templates/renter-substitution'
import type { ResolveOperatorRecipients } from './operator-recipients'

type Kind = NotificationLog['kind']

// #1205 slice 4: every kind EXCEPT the operator new-message alert is driven by the
// booking lifecycle (TRIGGER_KINDS -> processOne -> buildMessage). OPERATOR_NEW_MESSAGE
// is dispatched separately by dispatchOperatorNewMessage (keyed msg:<id>, off the
// message path), so excluding it here keeps the booking switch exhaustive (the
// `satisfies never` still holds) and leaves RELATIONS_BY_KIND / EXPECTED_RENDERED a
// clean 1:1 with the lifecycle templates — no "n/a" relation row for a non-booking kind.
type BookingNotificationKind = Exclude<Kind, 'OPERATOR_NEW_MESSAGE'>

/**
 * #664: the booking lifecycle event that triggered a dispatch. `CREATED` fans
 * out to the original renter-confirm + operator-alert pair; each operator action
 * maps to exactly ONE renter kind. Distinct kinds (not a generic status change)
 * keep the `notify:<booking>:<kind>` idempotency key collision-free across a
 * sequence like ACTIVATED-then-COMPLETED on the same booking.
 */
export type LifecycleTrigger = 'CREATED' | 'SUBSTITUTED' | 'CANCELLED' | 'ACTIVATED' | 'COMPLETED'

// Exported for the parity test (#720): a renamed enum can leave this hand-map
// stale, surfacing only as a missing renter notification in prod. Adding a new
// trigger fails to compile via the Record type; the test guards the rename vector.
export const TRIGGER_KINDS: Record<LifecycleTrigger, BookingNotificationKind[]> = {
  CREATED: ['RENTER_BOOKING_CONFIRM', 'OPERATOR_BOOKING_ALERT'],
  SUBSTITUTED: ['RENTER_SUBSTITUTION'],
  CANCELLED: ['RENTER_CANCELLATION'],
  ACTIVATED: ['RENTER_TRIP_STARTED'],
  // #1083: completion sends the trip-completed notice AND the review prompt.
  COMPLETED: ['RENTER_TRIP_COMPLETED', 'RENTER_REVIEW_PROMPT'],
}

// The booking relations a notification email can render. Everything else a
// template needs lives on the booking snapshot (codes, dates, prices, *_Snapshot).
export type NotificationRelation = 'operator' | 'vehicle' | 'pickup' | 'dropoff'

// #1151: each kind declares EXACTLY which relations its template renders, and
// `loadRelations` reads only those — a snapshot-only kind pays zero repo reads.
// The exhaustive `Record<Kind, ...>` makes a NEW kind compile-fail until it
// declares its needs, so it can't silently default back to "load all four" and
// re-create the wasted-read leak (#1114). The conformance test asserts these
// sets stay equal to what each branch of `buildMessage` actually consumes.
// `operator` is read only by the confirmation; the operator alert and the
// renter status/substitution emails render from snapshot + vehicle/location only.
export const RELATIONS_BY_KIND: Record<
  BookingNotificationKind,
  ReadonlySet<NotificationRelation>
> = {
  RENTER_CANCELLATION: new Set(),
  RENTER_BOOKING_CONFIRM: new Set(['operator', 'vehicle', 'pickup', 'dropoff']),
  RENTER_SUBSTITUTION: new Set(['vehicle', 'pickup', 'dropoff']),
  RENTER_TRIP_STARTED: new Set(['vehicle', 'pickup', 'dropoff']),
  RENTER_TRIP_COMPLETED: new Set(['vehicle', 'pickup', 'dropoff']),
  OPERATOR_BOOKING_ALERT: new Set(['vehicle', 'pickup', 'dropoff']),
  // Snapshot-only: booking code + period + a CTA back to My Bookings. Zero reads.
  RENTER_REVIEW_PROMPT: new Set(),
}

const DEFAULT_OPERATOR_LOCALE = 'ja' // §12.2

export interface NotificationDispatcherConfig {
  emailFrom: string
  emailReplyTo?: string | undefined
  // Operator-alert recipient of last resort when an operator has no owner user.
  fallbackOperatorEmail?: string | undefined
  // #960: WEB_ORIGIN, used to build the operator-alert deep link to the booking.
  // Absent -> no link (the operator email still sends, just without the CTA).
  webBaseUrl?: string | undefined
}

interface Resolved {
  // Envelope `To` — a single visible address. For the operator alert this is the
  // platform `from` (send-to-self), never a member, so members stay undisclosed.
  to: string
  // #878: blind-copied recipients (the operator's active members). Carried only
  // in-memory — the notification_log row persists one `recipient` audit string.
  bcc?: string[] | undefined
  // The value persisted to notification_log.recipient (single text column, no
  // migration): the renter email, the joined member list, or the fallback inbox.
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
  // #681: carries the persisted terminal NO_RECIPIENT row (countable skip).
  | { result: 'no_recipient'; row: NotificationLog }

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
    // #889: the operator-alert recipient set, injected as a single function so the
    // dispatcher no longer depends on the membership ledger (ISP). Wired in the
    // composition root from membershipRepo + userRepo via makeResolveOperatorRecipients.
    private readonly resolveOperatorRecipients: ResolveOperatorRecipients,
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
  async processOne(booking: Booking, kind: BookingNotificationKind): Promise<DispatchOutcome> {
    const resolved = await this.resolveRecipient(booking, kind)
    if (!resolved) {
      // #681: persist a terminal NO_RECIPIENT row under a SEPARATE key so the skip
      // is countable for observability, and a later real send (e.g. the renter
      // adds an email) is never blocked by this record. Never queued, never sent.
      const row = await this.notificationLogRepo.recordNoRecipient({
        bookingId: booking.id,
        operatorId: booking.operatorId,
        kind,
        idempotencyKey: `notify:${booking.id}:${kind}:no_recipient`,
      })
      console.error('[notification] no recipient', { bookingId: booking.id, kind })
      return { result: 'no_recipient', row }
    }

    const row = await this.notificationLogRepo.upsertQueued({
      bookingId: booking.id,
      operatorId: booking.operatorId,
      kind,
      recipient: resolved.recipient,
      locale: resolved.locale,
      idempotencyKey: `notify:${booking.id}:${kind}`,
    })
    // Address from the in-memory `resolved` (it carries the Bcc list the single-column
    // log row can't); the render thunk runs only after the claim is won.
    return this.claimAndSend(row, () => this.buildMessage(booking, kind, resolved))
  }

  /**
   * #1205 slice 4: fire the operator "a renter messaged you" alert. NOT a booking
   * lifecycle kind — keyed by `msg:<messageId>` so it is idempotent per message and
   * re-arms on the next one, and recipient-resolved against the operator member set
   * (bcc, send-to-self), reusing resolveOperatorEnvelope + claimAndSend. The caller
   * (MessageService) only invokes this on the unread 0->1 transition; the dispatcher
   * stays idempotent if it ever sees the same messageId twice. Never throws — a send
   * failure is logged + recorded FAILED, exactly like the lifecycle path.
   */
  async dispatchOperatorNewMessage(args: {
    threadId: string
    bookingId: string
    operatorId: string
    messageId: string
    senderUserId: string
  }): Promise<DispatchOutcome> {
    const resolved = await this.resolveOperatorEnvelope(args.operatorId)
    if (!resolved) {
      const row = await this.notificationLogRepo.recordNoRecipient({
        bookingId: args.bookingId,
        operatorId: args.operatorId,
        kind: 'OPERATOR_NEW_MESSAGE',
        idempotencyKey: `msg:${args.messageId}:no_recipient`,
      })
      console.error('[notification] no recipient', {
        messageId: args.messageId,
        kind: 'OPERATOR_NEW_MESSAGE',
      })
      return { result: 'no_recipient', row }
    }

    const row = await this.notificationLogRepo.upsertQueued({
      bookingId: args.bookingId,
      operatorId: args.operatorId,
      kind: 'OPERATOR_NEW_MESSAGE',
      recipient: resolved.recipient,
      locale: resolved.locale,
      idempotencyKey: `msg:${args.messageId}`,
    })
    return this.claimAndSend(row, () => this.buildOperatorNewMessage(args, resolved))
  }

  /**
   * Shared claim -> render -> send -> mark unit for an already-queued row, reused by
   * the booking-lifecycle path (processOne) and the operator new-message path
   * (dispatchOperatorNewMessage). A null claim is a no-op whose un-claimed status
   * disambiguates the three terminal cases: terminal SENT (#393), terminal DEAD
   * (#483), or a live (non-expired) SENDING lease held by another sender. `render`
   * runs ONLY after the claim is won, so a no-op never builds a message it won't send.
   */
  private async claimAndSend(
    row: NotificationLog,
    render: () => Promise<EmailMessage>,
  ): Promise<DispatchOutcome> {
    const claimed = await this.notificationLogRepo.claim(row.id)
    if (!claimed) {
      if (row.status === 'SENT') return { result: 'already_sent', row }
      if (row.status === 'DEAD') return { result: 'abandoned', row }
      return { result: 'in_progress', row }
    }

    try {
      const { providerMessageId } = await this.emailSender.send(await render())
      await this.notificationLogRepo.markSent(claimed.id, providerMessageId)
      return { result: 'sent', row: { ...claimed, status: 'SENT', providerMessageId } }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      await this.notificationLogRepo.markFailed(claimed.id, reason.slice(0, 500))
      // claim() already bumped attempts, so this is the cap predicate markFailed
      // applied — mirror it here for a truthful outcome status + a distinct
      // abandonment signal (a silently-DEAD notification is a row nobody acts on).
      const status = claimed.attempts >= MAX_NOTIFICATION_ATTEMPTS ? 'DEAD' : 'FAILED'
      if (status === 'DEAD') {
        console.error('[notification] abandoned after max attempts', {
          id: claimed.id,
          kind: claimed.kind,
          attempts: claimed.attempts,
          reason,
        })
      } else {
        console.error('[notification] send failed', {
          id: claimed.id,
          kind: claimed.kind,
          reason,
        })
      }
      return { result: 'failed', row: { ...claimed, status, error: reason } }
    }
  }

  private async resolveRecipient(
    booking: Booking,
    kind: BookingNotificationKind,
  ): Promise<Resolved | undefined> {
    // Every renter-facing kind (#393 confirm + #664 lifecycle) goes to the renter.
    if (kind.startsWith('RENTER_')) {
      const [renter] = await this.userRepo.findByIds([booking.renterId])
      if (!renter?.email) return undefined
      return { to: renter.email, recipient: renter.email, locale: renter.language ?? 'en' }
    }
    // OPERATOR_BOOKING_ALERT (#878) — every ACTIVE member (owner + staff) of the
    // operator. Same envelope the new-message alert uses (#1205), so it is shared.
    return this.resolveOperatorEnvelope(booking.operatorId)
  }

  /**
   * The operator-facing email envelope (#878): bcc every ACTIVE member, sourced from
   * the grant ledger so a revoked member never lingers; `to` is the platform `from`
   * (send-to-self) so no member's address is disclosed to the others, and the audit
   * `recipient` is the full joined list. With no active members it falls back to the
   * platform ops inbox of last resort, and `undefined` when even that is unset.
   * Shared by the booking alert (resolveRecipient) and the new-message alert (#1205).
   */
  private async resolveOperatorEnvelope(operatorId: string): Promise<Resolved | undefined> {
    const members = await this.resolveOperatorRecipients(operatorId)
    if (members.length > 0) {
      return {
        to: this.config.emailFrom,
        bcc: members,
        recipient: members.join(', '),
        locale: DEFAULT_OPERATOR_LOCALE,
      }
    }
    const fallback = this.config.fallbackOperatorEmail
    if (!fallback) return undefined
    return { to: fallback, recipient: fallback, locale: DEFAULT_OPERATOR_LOCALE }
  }

  // Reads ONLY the relations in `required` (RELATIONS_BY_KIND[kind]) — every other
  // entity stays undefined and its name field falls back to the snapshot id, which
  // is never rendered by a kind that didn't declare it. A snapshot-only kind passes
  // an empty set and issues zero repo reads (#1114, #1151).
  private async loadRelations(booking: Booking, required: ReadonlySet<NotificationRelation>) {
    const [operator, vehicle, pickup, dropoff] = await Promise.all([
      required.has('operator') ? this.operatorRepo.findById(booking.operatorId) : undefined,
      required.has('vehicle') && booking.assignedVehicleId
        ? this.vehicleRepo.findById(SYSTEM_CONTEXT, booking.assignedVehicleId)
        : undefined,
      required.has('pickup')
        ? this.locationRepo.findById(SYSTEM_CONTEXT, booking.pickupLocationId)
        : undefined,
      required.has('dropoff')
        ? this.locationRepo.findById(SYSTEM_CONTEXT, booking.dropoffLocationId)
        : undefined,
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
    return { operator, vehicleData, pickupName, dropoffName, common }
  }

  // Wraps a rendered template (subject/html/text) in the send envelope: `to`/`bcc`
  // from the resolved recipient, platform `from`, optional reply-to. Shared by the
  // booking-lifecycle templates (buildMessage) and the new-message alert (#1205).
  private toEmail(
    resolved: Resolved,
    rendered: { subject: string; html: string; text: string },
  ): EmailMessage {
    const { to, bcc } = resolved
    const replyTo = this.config.emailReplyTo
    return {
      to,
      ...(bcc?.length ? { bcc } : {}),
      from: this.config.emailFrom,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(replyTo ? { replyTo } : {}),
    }
  }

  // #1205 slice 4: render the operator "a renter messaged you" alert — the sender's
  // name (resolved from senderUserId) plus a deep link straight to the thread. A
  // trailing slash on WEB_ORIGIN is stripped so a misconfig can't emit `//{locale}`;
  // an unset WEB_ORIGIN drops the CTA (the email still alerts), mirroring the
  // operator-alert / review-prompt deep-link gating.
  private async buildOperatorNewMessage(
    args: { threadId: string; senderUserId: string },
    resolved: Resolved,
  ): Promise<EmailMessage> {
    const [sender] = await this.userRepo.findByIds([args.senderUserId])
    const base = this.config.webBaseUrl?.replace(/\/+$/, '')
    const manageUrl = base ? `${base}/${resolved.locale}/manage/messages/${args.threadId}` : null
    return this.toEmail(
      resolved,
      renderOperatorNewMessage({ renterName: sender?.name ?? null, manageUrl }, resolved.locale),
    )
  }

  private async buildMessage(
    booking: Booking,
    kind: BookingNotificationKind,
    resolved: Resolved,
  ): Promise<EmailMessage> {
    const { locale } = resolved
    const envelope = (r: { subject: string; html: string; text: string }) =>
      this.toEmail(resolved, r)

    // Reads only the relations this kind declares; a snapshot-only kind (e.g.
    // RENTER_CANCELLATION, with an empty set) issues zero reads here (#1151).
    const { operator, vehicleData, pickupName, dropoffName, common } = await this.loadRelations(
      booking,
      RELATIONS_BY_KIND[kind],
    )

    switch (kind) {
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
      case 'RENTER_REVIEW_PROMPT': {
        // Deep link to the renter's My Bookings list, where the review prompt lives.
        // Trailing slash stripped so a misconfigured WEB_ORIGIN can't emit `//{locale}`.
        const base = this.config.webBaseUrl?.replace(/\/+$/, '')
        const reviewUrl = base ? `${base}/${locale}/bookings` : null
        return envelope(
          renderRenterReviewPrompt(
            {
              bookingCode: booking.bookingCode,
              startAt: booking.startAt,
              endAt: booking.endAt,
              reviewUrl,
            },
            locale,
          ),
        )
      }
      case 'OPERATOR_BOOKING_ALERT': {
        const [renter] = await this.userRepo.findByIds([booking.renterId])
        // Strip a trailing slash so a misconfigured WEB_ORIGIN can't emit a
        // `//{locale}` path that fails the SPA's `/$locale/...` route match.
        const base = this.config.webBaseUrl?.replace(/\/+$/, '')
        const manageBookingUrl = base ? `${base}/${locale}/manage/bookings/${booking.id}` : null
        return envelope(
          renderOperatorAlert(
            {
              ...common,
              renterName: renter?.name ?? null,
              renterEmail: renter?.email ?? null,
              renterPhone: renter?.phone ?? null,
              insurance: booking.insuranceSnapshot
                ? {
                    name: booking.insuranceSnapshot.name,
                    dailyPriceJpy: booking.insuranceSnapshot.dailyPriceJpy,
                  }
                : null,
              addOns: booking.addOnSnapshot,
              source: booking.source,
              manageBookingUrl,
            },
            locale,
          ),
        )
      }
      default:
        // A new kind compile-fails here (and at RELATIONS_BY_KIND) until it
        // declares both its render branch and its relation needs.
        return kind satisfies never
    }
  }
}
