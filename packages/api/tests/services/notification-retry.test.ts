import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryNotificationLogRepository } from '../../src/repositories/in-memory/notification-log'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import type { OperatorRepository, VehicleRepository } from '../../src/repositories/types'
import type { LocationRepository } from '../../src/repositories/types'
import type { EmailSender } from '../../src/services/email/email-sender'
import type { DispatchOutcome } from '../../src/services/notification-dispatcher'
import { NotificationDispatcher } from '../../src/services/notification-dispatcher'
import {
  type NotificationRedriver,
  NotificationRetryService,
} from '../../src/services/notification-retry'
import type { Booking, NotificationLog, User } from '../../src/stores'
import { makeBooking as makeBookingFixture } from '../helpers/booking'

const OP = 'op-1'

function makeBooking(id: string, over: Partial<Booking> = {}): Booking {
  const now = new Date('2026-07-01T00:00:00Z')
  return makeBookingFixture({
    id,
    operatorId: OP,
    renterId: 'renter-1',
    assignedVehicleId: null,
    startAt: now,
    endAt: now,
    effectiveEndAt: now,
    status: 'CANCELLED',
    bookingCode: 'ABCD2345',
    cancellationFee: 30_000,
    ...over,
  })
}

async function seedFailed(
  repo: InMemoryNotificationLogRepository,
  bookingId: string,
  kind: NotificationLog['kind'] = 'RENTER_CANCELLATION',
): Promise<NotificationLog> {
  const r = await repo.upsertQueued({
    bookingId,
    operatorId: OP,
    kind,
    recipient: 'renter@example.com',
    locale: 'en',
    idempotencyKey: `notify:${bookingId}:${kind}`,
  })
  await repo.claim(r.id)
  await repo.markFailed(r.id, 'transient') // FAILED, below cap -> retryable
  return r
}

type Behavior = DispatchOutcome['result'] | 'throw'

class RoutingRedriver implements NotificationRedriver {
  calls: string[] = []
  behaviorByBooking = new Map<string, Behavior>()
  async processOne(booking: Booking, _kind: NotificationLog['kind']): Promise<DispatchOutcome> {
    this.calls.push(booking.id)
    const b = this.behaviorByBooking.get(booking.id) ?? 'sent'
    if (b === 'throw') throw new Error('infra blip')
    return { result: b, row: {} as NotificationLog }
  }
}

describe('NotificationRetryService.run (#1125 sweep)', () => {
  let logRepo: InMemoryNotificationLogRepository
  let bookings: Map<string, Booking>
  let bookingRepo: InMemoryBookingRepository
  let redriver: RoutingRedriver
  let service: NotificationRetryService

  beforeEach(() => {
    logRepo = new InMemoryNotificationLogRepository()
    bookings = new Map()
    bookingRepo = new InMemoryBookingRepository(bookings)
    redriver = new RoutingRedriver()
    service = new NotificationRetryService({
      notificationLogRepo: logRepo,
      bookingRepo,
      redriver,
    })
  })

  it('re-drives every retryable row and tallies by outcome — a thrown redrive never aborts the batch', async () => {
    for (const id of ['ok', 'fail', 'poison', 'already']) {
      bookings.set(id, makeBooking(id))
      await seedFailed(logRepo, id)
    }
    redriver.behaviorByBooking.set('fail', 'failed')
    redriver.behaviorByBooking.set('poison', 'throw')
    redriver.behaviorByBooking.set('already', 'already_sent')

    const summary = await service.run({ limit: 10 })

    // The poison throw did NOT abort the sweep — all four were attempted.
    expect(redriver.calls.sort()).toEqual(['already', 'fail', 'ok', 'poison'])
    expect(summary).toEqual({ attempted: 4, sent: 1, failed: 2, skipped: 1 })
  })

  it('skips a retryable row whose booking has vanished, without calling the redriver for it', async () => {
    bookings.set('ok', makeBooking('ok'))
    await seedFailed(logRepo, 'ok')
    await seedFailed(logRepo, 'ghost') // no booking seeded for "ghost"

    const summary = await service.run({ limit: 10 })

    expect(redriver.calls).toEqual(['ok']) // ghost never reached the redriver
    expect(summary).toEqual({ attempted: 2, sent: 1, failed: 0, skipped: 1 })
  })

  it('forwards the limit to findRetryable (only the oldest N are swept)', async () => {
    for (const id of ['a', 'b', 'c']) {
      bookings.set(id, makeBooking(id))
      await seedFailed(logRepo, id)
    }

    const summary = await service.run({ limit: 2 })

    expect(summary.attempted).toBe(2)
    expect(redriver.calls).toHaveLength(2)
  })

  // The finding-#1 regression proof: a FAILED lifecycle notification (no client
  // replay path) is re-sent by the sweep through the REAL dispatcher — the exact
  // gap that previously left a renter's cancellation email lost-but-logged.
  it('re-sends a stuck FAILED lifecycle row to SENT via the real dispatcher (no double-send on re-run)', async () => {
    const booking = makeBooking('bk-1')
    bookings.set('bk-1', booking)
    const failed = await seedFailed(logRepo, 'bk-1', 'RENTER_CANCELLATION')

    const send = vi.fn(async () => ({ providerMessageId: 'msg-redrive' }))
    const dispatcher = buildDispatcher(logRepo, { send })
    const realService = new NotificationRetryService({
      notificationLogRepo: logRepo,
      bookingRepo,
      redriver: dispatcher,
    })

    const first = await realService.run({ limit: 10 })

    expect(send).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ attempted: 1, sent: 1, failed: 0, skipped: 0 })
    const row = await logRepo.findById(SYSTEM_CONTEXT, failed.id)
    expect(row).toMatchObject({ status: 'SENT', providerMessageId: 'msg-redrive' })

    // Second sweep finds nothing — the SENT row is excluded; never re-sent.
    const second = await realService.run({ limit: 10 })
    expect(second.attempted).toBe(0)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

// Compact real NotificationDispatcher: a RENTER_CANCELLATION resolves only the
// renter's email, but buildMessage still reads operator/vehicle/locations, so the
// fakes must answer. Mirrors the wiring in notification-dispatcher.test.ts.
function buildDispatcher(
  logRepo: InMemoryNotificationLogRepository,
  opts: { send: EmailSender['send'] },
): NotificationDispatcher {
  const userRepo = new InMemoryUserRepository(
    new Map<string, User>([
      [
        'renter-1',
        {
          id: 'renter-1',
          name: 'Jane',
          email: 'jane@example.com',
          phone: null,
          language: 'en',
          country: null,
          role: 'RENTER',
          operatorId: null,
        },
      ],
    ]),
  )
  const operatorRepo = {
    findById: async () => ({ id: OP, slug: 'bcr', name: 'BCR' }),
  } as unknown as OperatorRepository
  const vehicleRepo = { findById: async () => undefined } as unknown as VehicleRepository
  const locationRepo = {
    findById: async (_ctx: unknown, id: string) => ({ id, name: 'Namba Lot' }),
  } as unknown as LocationRepository

  return new NotificationDispatcher(
    logRepo,
    operatorRepo,
    vehicleRepo,
    userRepo,
    async () => [], // no operator members needed for a RENTER_* kind
    locationRepo,
    { send: opts.send },
    { emailFrom: 'noreply@bcr.jp' },
  )
}
