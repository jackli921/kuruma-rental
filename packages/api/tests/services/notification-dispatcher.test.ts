import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryNotificationLogRepository } from '../../src/repositories/in-memory/notification-log'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { MAX_NOTIFICATION_ATTEMPTS, SEND_LEASE_MS } from '../../src/repositories/types'
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
    fulfillmentMode: 'SPECIFIC',
    bookingCode: 'ABCD2345',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
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

  it('stops re-sending once a row hits the DEAD cap, returning an abandoned outcome (#483)', async () => {
    const sender = {
      send: vi.fn(async () => {
        throw new Error('SMTP 550 hard bounce')
      }),
    }
    const { dispatcher } = build({ sender })
    // Drive the renter-confirm row to the attempt cap; each attempt claims + sends + fails.
    let lastFailure: Awaited<ReturnType<typeof dispatcher.processOne>> | undefined
    for (let i = 0; i < MAX_NOTIFICATION_ATTEMPTS; i++) {
      lastFailure = await dispatcher.processOne(booking, 'RENTER_BOOKING_CONFIRM')
    }
    const sendMock = sender.send as ReturnType<typeof vi.fn>
    expect(sendMock).toHaveBeenCalledTimes(MAX_NOTIFICATION_ATTEMPTS)
    // The cap-crossing failure reports a truthful terminal status (the DB row is
    // now DEAD), not a stale FAILED echo.
    expect(lastFailure).toMatchObject({ result: 'failed', row: { status: 'DEAD' } })

    // The row is now terminal DEAD: a replay must NOT invoke the provider again.
    const outcome = await dispatcher.processOne(booking, 'RENTER_BOOKING_CONFIRM')
    expect(outcome.result).toBe('abandoned')
    expect(sendMock).toHaveBeenCalledTimes(MAX_NOTIFICATION_ATTEMPTS) // unchanged — no re-send
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

  // #664: the SAME dispatch path, fanned out by lifecycle trigger. CREATED keeps
  // the original two kinds; each operator action maps to exactly one renter kind.
  describe('lifecycle triggers (#664)', () => {
    async function kindsFor(trigger: Parameters<typeof dispatcher.dispatch>[1]) {
      const { dispatcher, logRepo, sender } = build()
      await dispatcher.dispatch(booking, trigger)
      const rows = await logRepo.findAll({ userId: 'x', role: 'PLATFORM_ADMIN', bypassScope: true })
      return { rows, sender }
    }

    it('SUBSTITUTED dispatches exactly RENTER_SUBSTITUTION, sent once', async () => {
      const { rows, sender } = await kindsFor('SUBSTITUTED')
      expect(rows.map((r) => r.kind)).toEqual(['RENTER_SUBSTITUTION'])
      expect(rows[0]!.status).toBe('SENT')
      expect(sender.send as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
    })

    it('maps each trigger to its kind set; CREATED stays the original pair', async () => {
      expect((await kindsFor('CREATED')).rows.map((r) => r.kind).sort()).toEqual(
        ['OPERATOR_BOOKING_ALERT', 'RENTER_BOOKING_CONFIRM'].sort(),
      )
      expect((await kindsFor('CANCELLED')).rows.map((r) => r.kind)).toEqual(['RENTER_CANCELLATION'])
      expect((await kindsFor('ACTIVATED')).rows.map((r) => r.kind)).toEqual(['RENTER_TRIP_STARTED'])
      expect((await kindsFor('COMPLETED')).rows.map((r) => r.kind)).toEqual([
        'RENTER_TRIP_COMPLETED',
      ])
    })

    it('defaults to CREATED when no trigger is passed (back-compat with create + resend)', async () => {
      const { dispatcher, logRepo } = build()
      await dispatcher.dispatch(booking)
      const rows = await logRepo.findAll({ userId: 'x', role: 'PLATFORM_ADMIN', bypassScope: true })
      expect(rows).toHaveLength(2)
    })

    // The reason distinct kinds exist: ACTIVATED then COMPLETED on ONE booking must
    // BOTH send. A single generic kind would share notify:<id>:<kind> and the second
    // would be swallowed as already_sent.
    it('ACTIVATED then COMPLETED on the same booking both send (distinct keys)', async () => {
      const { dispatcher, logRepo, sender } = build()
      await dispatcher.dispatch(booking, 'ACTIVATED')
      await dispatcher.dispatch(booking, 'COMPLETED')
      const rows = await logRepo.findAll({ userId: 'x', role: 'PLATFORM_ADMIN', bypassScope: true })
      expect(rows.map((r) => r.kind).sort()).toEqual([
        'RENTER_TRIP_COMPLETED',
        'RENTER_TRIP_STARTED',
      ])
      expect(rows.map((r) => r.idempotencyKey).sort()).toEqual([
        `notify:${booking.id}:RENTER_TRIP_COMPLETED`,
        `notify:${booking.id}:RENTER_TRIP_STARTED`,
      ])
      expect(sender.send as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2)
    })

    it('substitution email renders the new vehicle and leaks no internal ids', async () => {
      const sent: Array<{ to: string; subject: string; html: string; text: string }> = []
      const sender = {
        send: vi.fn(async (m: (typeof sent)[number]) => {
          sent.push(m)
          return { providerMessageId: 'msg-1' }
        }),
      }
      const { dispatcher } = build({ sender: sender as unknown as EmailSender })
      await dispatcher.dispatch(booking, 'SUBSTITUTED')
      const msg = sent[0]!
      expect(msg.to).toBe('jane@example.com')
      expect(msg.html).toContain('Toyota Aqua') // fakeVehicleRepo name
      expect(msg.html).toContain('X 12-34') // plate
      const blob = `${msg.subject}\n${msg.html}\n${msg.text}`
      expect(blob).not.toContain('veh-1') // assignedVehicleId never rendered
      expect(blob).not.toContain(OP) // operatorId never rendered
    })
  })
})
