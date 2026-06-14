import { notificationKindEnum } from '@kuruma/shared/db/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryNotificationLogRepository } from '../../src/repositories/in-memory/notification-log'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { MAX_NOTIFICATION_ATTEMPTS, SEND_LEASE_MS } from '../../src/repositories/types'
import type { LocationRepository, VehicleRepository } from '../../src/repositories/types'
import type { EmailSender } from '../../src/services/email/email-sender'
import {
  type LifecycleTrigger,
  NotificationDispatcher,
  TRIGGER_KINDS,
} from '../../src/services/notification-dispatcher'
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
  opts: {
    now?: () => Date
    sender?: EmailSender
    owners?: User[]
    fallback?: string
    renterEmail?: string | null
    logRepo?: InMemoryNotificationLogRepository
  } = {},
) {
  const logRepo =
    opts.logRepo ?? new InMemoryNotificationLogRepository(undefined, opts.now ?? (() => new Date()))
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
        email: opts.renterEmail === undefined ? 'jane@example.com' : opts.renterEmail,
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

  // #681: a phone-only renter (or an operator with no contact) has no resolvable
  // email. Instead of silently skipping, persist a terminal NO_RECIPIENT row so
  // the skip is countable for observability — never queued, never sent.
  describe('no resolvable recipient (#681)', () => {
    it('persists a terminal NO_RECIPIENT row for a phone-only renter, sending nothing', async () => {
      const { dispatcher, logRepo, sender } = build({ renterEmail: null })
      const outcome = await dispatcher.processOne(booking, 'RENTER_BOOKING_CONFIRM')

      expect(outcome.result).toBe('no_recipient')
      const rows = await logRepo.findAll({ userId: 'x', role: 'PLATFORM_ADMIN', bypassScope: true })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        kind: 'RENTER_BOOKING_CONFIRM',
        status: 'NO_RECIPIENT',
        recipient: '',
        bookingId: booking.id,
        operatorId: OP,
      })
      expect(sender.send as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
    })

    it('keys the NO_RECIPIENT row separately so a later real send is never blocked', async () => {
      const { dispatcher, logRepo } = build({ renterEmail: null })
      await dispatcher.processOne(booking, 'RENTER_BOOKING_CONFIRM')
      const rows = await logRepo.findAll({ userId: 'x', role: 'PLATFORM_ADMIN', bypassScope: true })
      expect(rows[0]!.idempotencyKey).toBe(
        `notify:${booking.id}:RENTER_BOOKING_CONFIRM:no_recipient`,
      )
    })

    it('is idempotent — repeated no-recipient dispatches keep exactly one row', async () => {
      const { dispatcher, logRepo } = build({ renterEmail: null })
      await dispatcher.processOne(booking, 'RENTER_BOOKING_CONFIRM')
      await dispatcher.processOne(booking, 'RENTER_BOOKING_CONFIRM')
      const rows = await logRepo.findAll({ userId: 'x', role: 'PLATFORM_ADMIN', bypassScope: true })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.status).toBe('NO_RECIPIENT')
    })

    // The invariant the separate key buys (architect review): a skip must not
    // poison a LATER real send once the renter supplies an email — the two rows
    // coexist and the send path stays idempotent against its own bare key.
    it('a later real send coexists with the skip and stays idempotent (separate keys, no poison)', async () => {
      const logRepo = new InMemoryNotificationLogRepository()
      // 1. Phone-only at first dispatch -> NO_RECIPIENT record (`:no_recipient` key).
      await build({ renterEmail: null, logRepo }).dispatcher.processOne(
        booking,
        'RENTER_BOOKING_CONFIRM',
      )
      // 2. Renter adds an email -> the real send lands on the bare key, unblocked.
      const send = build({ renterEmail: 'jane@example.com', logRepo })
      expect((await send.dispatcher.processOne(booking, 'RENTER_BOOKING_CONFIRM')).result).toBe(
        'sent',
      )
      // 3. A resend is idempotent against the SENT row, NOT the parallel skip —
      //    no fresh skip, no double-send.
      expect((await send.dispatcher.processOne(booking, 'RENTER_BOOKING_CONFIRM')).result).toBe(
        'already_sent',
      )

      const rows = await logRepo.findAll({ userId: 'x', role: 'PLATFORM_ADMIN', bypassScope: true })
      expect(rows.map((r) => r.status).sort()).toEqual(['NO_RECIPIENT', 'SENT'])
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

    // #710: every kind the dispatcher can emit must be a value of the
    // notification_kind pgEnum, and every enum value must be reachable from some
    // trigger. The write path passes `kind` straight to the enum column, so a
    // kind that drifts from the enum is a runtime 22P02 invalid_enum_value on
    // insert. Asserting set-equality here (against the enum single source) makes
    // that drift fail in CI instead of in production.
    it('emits exactly the notification_kind enum value set across all triggers (#710)', async () => {
      const triggers = ['CREATED', 'SUBSTITUTED', 'CANCELLED', 'ACTIVATED', 'COMPLETED'] as const
      const emitted = new Set<string>()
      for (const trigger of triggers) {
        const { rows } = await kindsFor(trigger)
        for (const row of rows) emitted.add(row.kind)
      }
      expect([...emitted].sort()).toEqual([...notificationKindEnum.enumValues].sort())
    })

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

// #720: TRIGGER_KINDS is a hand-map from lifecycle event -> notification kinds.
// Adding a NEW trigger fails to compile via the Record<LifecycleTrigger, Kind[]>
// type, so that vector is already guarded. The vectors NOT caught by the compiler
// are (a) the hand-mirror going stale and (b) a kind literal that drifts from the
// DB enum after a rename — both surface only in prod as a missing renter email.
// These parity tests close that gap against the single source of truth
// (notificationKindEnum.enumValues from @kuruma/shared/db/schema).
describe('TRIGGER_KINDS parity (#720)', () => {
  // Runtime oracle for the LifecycleTrigger union. The `satisfies` keeps every
  // member a real trigger; the round-trip type below makes OMITTING a trigger a
  // COMPILE error — so the oracle itself can never silently drift out of sync,
  // which is what would otherwise make the key-set assertion vacuous.
  const ALL_TRIGGERS = [
    'CREATED',
    'SUBSTITUTED',
    'CANCELLED',
    'ACTIVATED',
    'COMPLETED',
  ] as const satisfies readonly LifecycleTrigger[]
  // If a trigger is added to the union but not to ALL_TRIGGERS above, `Missing`
  // becomes a non-`never` union and this line fails `tsc` — forcing the oracle
  // (and thus the test) to stay exhaustive.
  type Missing = Exclude<LifecycleTrigger, (typeof ALL_TRIGGERS)[number]>
  const _exhaustive: Missing extends never ? true : never = true
  void _exhaustive

  const enumKinds: readonly string[] = notificationKindEnum.enumValues

  it('key set equals the full LifecycleTrigger union exhaustively', () => {
    expect([...Object.keys(TRIGGER_KINDS)].sort()).toEqual([...ALL_TRIGGERS].sort())
  })

  it('every flattened kind is a member of notificationKindEnum.enumValues', () => {
    const usedKinds = [...new Set(Object.values(TRIGGER_KINDS).flat())]
    const strays = usedKinds.filter((kind) => !enumKinds.includes(kind))
    // Assert the offending values, not a bare boolean, so a failure names the
    // stale kind(s) directly.
    expect(strays).toEqual([])
  })

  it('maps each trigger to at least one kind (a trigger mapping to [] sends nothing)', () => {
    for (const trigger of ALL_TRIGGERS) {
      expect(TRIGGER_KINDS[trigger].length).toBeGreaterThan(0)
    }
  })
})
