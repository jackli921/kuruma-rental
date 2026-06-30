import { describe, expect, it, vi } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import { InMemoryNotificationLogRepository } from '../../src/repositories/in-memory/notification-log'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import { InMemoryOperatorMembershipRepository } from '../../src/repositories/in-memory/operator-membership'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import {
  type BookingRepository,
  type LocationRepository,
  MAX_NOTIFICATION_ATTEMPTS,
  type VehicleRepository,
} from '../../src/repositories/types'
import type { EmailSender } from '../../src/services/email/email-sender'
import { NotificationService } from '../../src/services/notification'
import { NotificationDispatcher } from '../../src/services/notification-dispatcher'
import { makeResolveOperatorRecipients } from '../../src/services/operator-recipients'
import type { Booking, User } from '../../src/stores'
import { makeBooking as makeBookingFixture } from '../helpers/booking'

const OP1 = 'op-1'
const OP2 = 'op-2'
const RENTER = 'renter-1'
const op1Ctx: CallerContext = {
  userId: 'u1',
  role: 'OPERATOR_OWNER',
  operatorId: OP1,
  bypassScope: false,
}
const op2Ctx: CallerContext = {
  userId: 'u2',
  role: 'OPERATOR_OWNER',
  operatorId: OP2,
  bypassScope: false,
}

function makeBooking(): Booking {
  const now = new Date('2026-07-01T00:00:00Z')
  return makeBookingFixture({
    id: 'bk-1',
    operatorId: OP1,
    renterId: RENTER,
    classId: 'cls-1',
    dropoffLocationId: 'loc-2',
    startAt: now,
    endAt: now,
    effectiveEndAt: now,
    bookingCode: 'ABCD2345',
    totalPrice: 24000,
    createdAt: now,
    updatedAt: now,
  })
}

const fakeVehicleRepo = {
  findById: async () => ({ name: 'Aqua', make: null, model: null, licensePlate: null }),
} as unknown as VehicleRepository
const fakeLocationRepo = {
  findById: async (_c: unknown, id: string) => ({ id, name: id }),
} as unknown as LocationRepository

function build(sender?: EmailSender) {
  const booking = makeBooking()
  const logRepo = new InMemoryNotificationLogRepository()
  const ts = new Date('2026-06-01T00:00:00Z')
  const operatorRepo = new InMemoryOperatorRepository(
    new Map([
      [
        OP1,
        {
          id: OP1,
          slug: 'bcr',
          name: 'BCR',
          preAuthHandoffUrl: null,
          createdAt: ts,
          updatedAt: ts,
        },
      ],
    ]),
  )
  const userRepo = new InMemoryUserRepository(
    new Map<string, User>([
      [
        RENTER,
        {
          id: RENTER,
          name: 'Jane',
          email: 'jane@example.com',
          phone: null,
          language: 'en',
          country: null,
          role: 'RENTER',
          operatorId: null,
        },
      ],
      [
        'owner-1',
        {
          id: 'owner-1',
          name: 'Op',
          email: 'owner@op.com',
          phone: null,
          language: 'ja',
          country: null,
          role: 'OPERATOR_OWNER',
          operatorId: OP1,
        },
      ],
    ]),
  )
  const okSender: EmailSender = sender ?? {
    send: vi.fn(async () => ({ providerMessageId: 'msg-1' })),
  }
  // #878: the operator alert resolves recipients from the membership ledger — seed
  // owner-1 as an ACTIVE member so dispatch produces a real operator-alert row.
  const membershipRepo = new InMemoryOperatorMembershipRepository(
    new Map([
      [
        'mem-owner-1',
        {
          id: 'mem-owner-1',
          userId: 'owner-1',
          operatorId: OP1,
          role: 'OPERATOR_OWNER' as const,
          status: 'ACTIVE' as const,
          createdAt: ts,
          updatedAt: ts,
        },
      ],
    ]),
  )
  const dispatcher = new NotificationDispatcher(
    logRepo,
    operatorRepo,
    fakeVehicleRepo,
    userRepo,
    makeResolveOperatorRecipients({ membershipRepo, userRepo }),
    fakeLocationRepo,
    okSender,
    { emailFrom: 'noreply@bcr.jp' },
  )
  const bookingRepo = {
    findById: async (_c: unknown, id: string) => (id === booking.id ? booking : undefined),
  } as unknown as BookingRepository
  const service = new NotificationService(logRepo, bookingRepo, dispatcher)
  return { service, dispatcher, logRepo, booking, sender: okSender }
}

describe('NotificationService', () => {
  it('findAll returns the operator-scoped rows', async () => {
    const { service, dispatcher, booking } = build()
    await dispatcher.dispatch(booking)
    const rows = await service.findAll(op1Ctx)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.operatorId === OP1)).toBe(true)
  })

  it('resend of a cross-operator id returns 404 (no tenant-existence leak)', async () => {
    const { service, dispatcher, booking, logRepo } = build()
    await dispatcher.dispatch(booking)
    const [row] = await logRepo.findAll({ userId: 'x', role: 'PLATFORM_ADMIN', bypassScope: true })
    const result = await service.resend(op2Ctx, row!.id)
    expect(result).toEqual({ ok: false, status: 404, error: 'Notification not found' })
  })

  it('resend re-sends a FAILED row to SENT', async () => {
    const { service, logRepo, booking } = build()
    const seeded = await logRepo.upsertQueued({
      bookingId: booking.id,
      operatorId: OP1,
      kind: 'RENTER_BOOKING_CONFIRM',
      recipient: 'jane@example.com',
      locale: 'en',
      idempotencyKey: `notify:${booking.id}:RENTER_BOOKING_CONFIRM`,
    })
    await logRepo.claim(seeded.id)
    await logRepo.markFailed(seeded.id, 'earlier failure')
    const result = await service.resend(op1Ctx, seeded.id)
    expect(result).toEqual({ ok: true, status: 'SENT', outcome: 'resent' })
  })

  it('reports a live SENDING lease as in_progress without re-sending (#485)', async () => {
    // Another sender holds a fresh (non-expired) lease: resend must NOT report a
    // green "sent" — the portal needs to say "already in progress".
    const sender = { send: vi.fn(async () => ({ providerMessageId: 'msg-1' })) }
    const { service, logRepo, booking } = build(sender)
    const seeded = await logRepo.upsertQueued({
      bookingId: booking.id,
      operatorId: OP1,
      kind: 'RENTER_BOOKING_CONFIRM',
      recipient: 'jane@example.com',
      locale: 'en',
      idempotencyKey: `notify:${booking.id}:RENTER_BOOKING_CONFIRM`,
    })
    await logRepo.claim(seeded.id) // live lease held elsewhere
    const result = await service.resend(op1Ctx, seeded.id)
    expect(result).toEqual({ ok: true, status: 'SENDING', outcome: 'in_progress' })
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('reports an already-SENT row as already_sent without re-sending (#485)', async () => {
    const sender = { send: vi.fn(async () => ({ providerMessageId: 'msg-1' })) }
    const { service, logRepo, booking } = build(sender)
    const seeded = await logRepo.upsertQueued({
      bookingId: booking.id,
      operatorId: OP1,
      kind: 'RENTER_BOOKING_CONFIRM',
      recipient: 'jane@example.com',
      locale: 'en',
      idempotencyKey: `notify:${booking.id}:RENTER_BOOKING_CONFIRM`,
    })
    await logRepo.claim(seeded.id)
    await logRepo.markSent(seeded.id, 'msg-earlier')
    const result = await service.resend(op1Ctx, seeded.id)
    expect(result).toEqual({ ok: true, status: 'SENT', outcome: 'already_sent' })
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('two concurrent resends of one row invoke the sender exactly once (atomic claim)', async () => {
    const sender = { send: vi.fn(async () => ({ providerMessageId: 'msg-1' })) }
    const { service, logRepo, booking } = build(sender)
    const seeded = await logRepo.upsertQueued({
      bookingId: booking.id,
      operatorId: OP1,
      kind: 'RENTER_BOOKING_CONFIRM',
      recipient: 'jane@example.com',
      locale: 'en',
      idempotencyKey: `notify:${booking.id}:RENTER_BOOKING_CONFIRM`,
    })
    await logRepo.claim(seeded.id)
    await logRepo.markFailed(seeded.id, 'earlier failure')
    await Promise.all([service.resend(op1Ctx, seeded.id), service.resend(op1Ctx, seeded.id)])
    expect(sender.send).toHaveBeenCalledTimes(1)
  })

  it('resend of a terminal DEAD row returns 422 without re-sending (#483 poison sink)', async () => {
    const sender = { send: vi.fn(async () => ({ providerMessageId: 'msg-1' })) }
    const { service, logRepo, booking } = build(sender)
    const seeded = await logRepo.upsertQueued({
      bookingId: booking.id,
      operatorId: OP1,
      kind: 'RENTER_BOOKING_CONFIRM',
      recipient: 'jane@example.com',
      locale: 'en',
      idempotencyKey: `notify:${booking.id}:RENTER_BOOKING_CONFIRM`,
    })
    // Drive the row to the cap so it is terminal DEAD.
    for (let i = 0; i < MAX_NOTIFICATION_ATTEMPTS; i++) {
      await logRepo.claim(seeded.id)
      await logRepo.markFailed(seeded.id, 'hard bounce')
    }
    const result = await service.resend(op1Ctx, seeded.id)
    expect(result).toEqual({
      ok: false,
      status: 422,
      error: 'Notification abandoned after max attempts',
    })
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('surfaces a send failure as 502', async () => {
    const sender = {
      send: vi.fn(async () => {
        throw new Error('SMTP down')
      }),
    }
    const { service, logRepo, booking } = build(sender)
    const seeded = await logRepo.upsertQueued({
      bookingId: booking.id,
      operatorId: OP1,
      kind: 'RENTER_BOOKING_CONFIRM',
      recipient: 'jane@example.com',
      locale: 'en',
      idempotencyKey: `notify:${booking.id}:RENTER_BOOKING_CONFIRM`,
    })
    const result = await service.resend(op1Ctx, seeded.id)
    expect(result).toMatchObject({ ok: false, status: 502 })
  })

  // #1205 slice 4: the operator new-message alert is keyed by msg:<messageId>, and
  // its resend args (thread/message/sender) live on no notification_log column — so
  // it cannot be reconstructed through the booking resend path. Resend must refuse
  // it (422) instead of mis-routing it through processOne (which would 500 on the
  // exhaustive booking switch). The alert re-arms on the renter's next message.
  it('refuses to resend an OPERATOR_NEW_MESSAGE row (not booking-reconstructable)', async () => {
    const sender = { send: vi.fn(async () => ({ providerMessageId: 'msg-1' })) }
    const { service, logRepo, booking } = build(sender)
    const seeded = await logRepo.upsertQueued({
      bookingId: booking.id,
      operatorId: OP1,
      kind: 'OPERATOR_NEW_MESSAGE',
      recipient: 'owner@op.com',
      locale: 'ja',
      idempotencyKey: 'msg:m-1',
    })
    await logRepo.claim(seeded.id)
    await logRepo.markFailed(seeded.id, 'earlier failure')
    const result = await service.resend(op1Ctx, seeded.id)
    expect(result).toEqual({ ok: false, status: 422, error: 'Notification is not resendable' })
    expect(sender.send).not.toHaveBeenCalled()
  })
})
