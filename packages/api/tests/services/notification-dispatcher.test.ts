import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryNotificationLogRepository } from '../../src/repositories/in-memory/notification-log'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { SEND_LEASE_MS } from '../../src/repositories/types'
import type { LocationRepository, VehicleRepository } from '../../src/repositories/types'
import type { EmailSender } from '../../src/services/email/email-sender'
import { NotificationDispatcher } from '../../src/services/notification-dispatcher'
import type { Booking, User } from '../../src/stores'

const OP = 'op-1'
const RENTER = 'renter-1'

function makeBooking(): Booking {
  const now = new Date('2026-07-01T00:00:00Z')
  return {
    id: 'bk-1',
    operatorId: OP,
    renterId: RENTER,
    classId: 'cls-1',
    requestedVehicleId: 'veh-1',
    assignedVehicleId: 'veh-1',
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-2',
    startAt: now,
    endAt: now,
    effectiveEndAt: now,
    status: 'CONFIRMED',
    source: 'DIRECT',
    bookingCode: 'ABCD2345',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 24000,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    createdAt: now,
    updatedAt: now,
  }
}

const fakeVehicleRepo = {
  findById: async () => ({
    name: 'Toyota Aqua',
    make: 'Toyota',
    model: 'Aqua',
    licensePlate: 'X 12-34',
  }),
} as unknown as VehicleRepository

const fakeLocationRepo = {
  findById: async (_ctx: unknown, id: string) => ({
    id,
    name: id === 'loc-1' ? 'Namba Lot' : 'KIX Lot',
  }),
} as unknown as LocationRepository

function build(
  opts: { now?: () => Date; sender?: EmailSender; owners?: User[]; fallback?: string } = {},
) {
  const logRepo = new InMemoryNotificationLogRepository(undefined, opts.now ?? (() => new Date()))
  const ts = new Date('2026-06-01T00:00:00Z')
  const operatorRepo = new InMemoryOperatorRepository(
    new Map([
      [
        OP,
        {
          id: OP,
          slug: 'bcr',
          name: 'BCR',
          preAuthHandoffUrl: 'https://pay/h',
          createdAt: ts,
          updatedAt: ts,
        },
      ],
    ]),
  )
  const userStore = new Map<string, User>([
    [
      RENTER,
      {
        id: RENTER,
        name: 'Jane',
        email: 'jane@example.com',
        phone: null,
        language: 'ja',
        country: null,
        role: 'RENTER',
        operatorId: null,
      },
    ],
    ...(
      opts.owners ?? [
        {
          id: 'owner-1',
          name: 'Op',
          email: 'owner@op.com',
          phone: null,
          language: 'ja',
          country: null,
          role: 'OPERATOR_OWNER',
          operatorId: OP,
        } as User,
      ]
    ).map((u): [string, User] => [u.id, u]),
  ])
  const userRepo = new InMemoryUserRepository(userStore)
  const sender = opts.sender ?? { send: vi.fn(async () => ({ providerMessageId: 'msg-1' })) }
  const dispatcher = new NotificationDispatcher(
    logRepo,
    operatorRepo,
    fakeVehicleRepo,
    userRepo,
    fakeLocationRepo,
    sender,
    {
      emailFrom: 'noreply@bcr.jp',
      fallbackOperatorEmail: opts.fallback,
    },
  )
  return { dispatcher, logRepo, sender }
}

describe('NotificationDispatcher', () => {
  let booking: Booking
  beforeEach(() => {
    booking = makeBooking()
  })

  it('dispatches both kinds: QUEUED -> claim -> SENT with provider id, persisting operatorId', async () => {
    const { dispatcher, logRepo, sender } = build()
    await dispatcher.dispatch(booking)

    const rows = await logRepo.findAll({ userId: 'x', role: 'PLATFORM_ADMIN', bypassScope: true })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'SENT')).toBe(true)
    expect(rows.every((r) => r.providerMessageId === 'msg-1')).toBe(true)
    expect(rows.every((r) => r.operatorId === OP)).toBe(true)
    expect(sender.send as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2)
  })

  it('records FAILED + error when the sender throws, and dispatch never throws', async () => {
    const sender = {
      send: vi.fn(async () => {
        throw new Error('SMTP 550 bad address')
      }),
    }
    const { dispatcher, logRepo } = build({ sender })
    await expect(dispatcher.dispatch(booking)).resolves.toBeUndefined()
    const rows = await logRepo.findAll({ userId: 'x', role: 'PLATFORM_ADMIN', bypassScope: true })
    expect(rows.every((r) => r.status === 'FAILED')).toBe(true)
    expect(rows[0]!.error).toContain('SMTP 550')
  })

  it('is idempotent on replay — a second dispatch does not resend a SENT row', async () => {
    const { dispatcher, sender } = build()
    await dispatcher.dispatch(booking)
    await dispatcher.dispatch(booking)
    expect(sender.send as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2) // not 4
  })

  it('two concurrent dispatches send each kind exactly once (claim race)', async () => {
    const { dispatcher, sender } = build()
    await Promise.all([dispatcher.dispatch(booking), dispatcher.dispatch(booking)])
    expect(sender.send as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2)
  })

  it('processOne skips a row held by a LIVE SENDING lease, but resends after it EXPIRES', async () => {
    let now = new Date('2026-07-01T00:00:00Z')
    const sender = { send: vi.fn(async () => ({ providerMessageId: 'msg-1' })) }
    const { dispatcher, logRepo } = build({ now: () => now, sender })
    // First claim leaves a live SENDING lease (sender hangs -> we simulate by claiming manually).
    const row = await logRepo.upsertQueued({
      bookingId: booking.id,
      operatorId: OP,
      kind: 'RENTER_BOOKING_CONFIRM',
      recipient: 'jane@example.com',
      locale: 'ja',
      idempotencyKey: `notify:${booking.id}:RENTER_BOOKING_CONFIRM`,
    })
    await logRepo.claim(row.id) // live lease held by an external sender
    await dispatcher.processOne(booking, 'RENTER_BOOKING_CONFIRM')
    expect(sender.send as ReturnType<typeof vi.fn>).not.toHaveBeenCalled() // skipped

    now = new Date(now.getTime() + SEND_LEASE_MS + 1000)
    await dispatcher.processOne(booking, 'RENTER_BOOKING_CONFIRM')
    expect(sender.send as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1) // reclaimed + sent
  })

  describe('recipient resolution', () => {
    it('renter confirm goes to the renter email; operator alert to the first OPERATOR_OWNER', async () => {
      const { dispatcher, logRepo } = build()
      await dispatcher.dispatch(booking)
      const rows = await logRepo.findAll({ userId: 'x', role: 'PLATFORM_ADMIN', bypassScope: true })
      const renterRow = rows.find((r) => r.kind === 'RENTER_BOOKING_CONFIRM')
      const opRow = rows.find((r) => r.kind === 'OPERATOR_BOOKING_ALERT')
      expect(renterRow?.recipient).toBe('jane@example.com')
      expect(opRow?.recipient).toBe('owner@op.com')
    })

    it('falls back to OPERATOR_ALERT_FALLBACK_EMAIL when the operator has no owner', async () => {
      const { dispatcher, logRepo } = build({ owners: [], fallback: 'ops@platform.com' })
      await dispatcher.dispatch(booking)
      const rows = await logRepo.findAll({ userId: 'x', role: 'PLATFORM_ADMIN', bypassScope: true })
      const opRow = rows.find((r) => r.kind === 'OPERATOR_BOOKING_ALERT')
      expect(opRow?.recipient).toBe('ops@platform.com')
    })
  })
})
