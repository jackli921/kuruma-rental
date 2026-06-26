import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { notificationLog, users } from '@kuruma/shared/db/schema'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { pgErrorCode } from '../../src/pg-errors'
import {
  DrizzleBookingRepository,
  DrizzleNotificationLogRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { MAX_NOTIFICATION_ATTEMPTS } from '../../src/repositories/types'
import type { Vehicle } from '../../src/stores'
import { bookingInput } from '../helpers/booking'
import {
  DEFAULT_DAILY_RATE_JPY,
  cleanupBookings,
  cleanupLocations,
  cleanupUsers,
  cleanupVehicleClasses,
  cleanupVehicles,
  db,
  seedLocation,
  seedVehicleClass,
} from './setup'

// §3 / §7: notification_log is the durable outbound-email ledger. This proves the
// DB-level invariants the dispatcher relies on: every row is sealed to a real
// booking + operator (FK 23503), and the (booking, kind) idempotency key is unique
// (23505) so a post-commit replay can never create a duplicate row to double-send.

const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)

let testUser: { id: string }
let testVehicle: Vehicle
let testClassId: string
let testLocationId: string
let testBookingId: string
const createdBookingIds: string[] = []
const createdVehicleIds: string[] = []
const createdClassIds: string[] = []
const createdLocationIds: string[] = []

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `notif-${Date.now()}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  testUser = user

  const klass = await seedVehicleClass('notif')
  testClassId = klass.id
  createdClassIds.push(klass.id)

  const location = await seedLocation('notif', 120)
  testLocationId = location.id
  createdLocationIds.push(location.id)

  testVehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: testClassId,
    name: 'Notif Test Car',
    description: null,
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
  })
  createdVehicleIds.push(testVehicle.id)

  const booking = await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      renterId: testUser.id,
      classId: testClassId,
      requestedVehicleId: testVehicle.id,
      assignedVehicleId: testVehicle.id,
      pickupLocationId: testLocationId,
      dropoffLocationId: testLocationId,
    }),
  )
  testBookingId = booking.id
  createdBookingIds.push(booking.id)
})

afterAll(async () => {
  await db.delete(notificationLog).where(eq(notificationLog.bookingId, testBookingId))
  await cleanupBookings(createdBookingIds)
  await cleanupVehicles(createdVehicleIds)
  await cleanupUsers([testUser.id])
  await cleanupVehicleClasses(createdClassIds)
  await cleanupLocations(createdLocationIds)
})

const row = (overrides: Record<string, unknown> = {}) => ({
  bookingId: testBookingId,
  operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
  kind: 'RENTER_BOOKING_CONFIRM' as const,
  recipient: 'renter@example.com',
  locale: 'en',
  idempotencyKey: `notify:${testBookingId}:RENTER_BOOKING_CONFIRM`,
  ...overrides,
})

describe('notification_log schema invariants', () => {
  it('inserts a QUEUED row by default and seals it to the booking + operator', async () => {
    const [inserted] = await db.insert(notificationLog).values(row()).returning()
    expect(inserted.status).toBe('QUEUED')
    expect(inserted.channel).toBe('EMAIL')
    expect(inserted.attempts).toBe(0)
    expect(inserted.bookingId).toBe(testBookingId)
  })

  it('rejects a duplicate idempotencyKey with 23505 (idempotency seal)', async () => {
    const dupe = row({ idempotencyKey: `notify:${testBookingId}:OPERATOR_BOOKING_ALERT` })
    await db.insert(notificationLog).values(dupe)
    const err = await db
      .insert(notificationLog)
      .values(dupe)
      .catch((e: unknown) => e)
    expect(pgErrorCode(err)).toBe('23505')
  })

  it('rejects a non-existent bookingId with FK violation 23503', async () => {
    const err = await db
      .insert(notificationLog)
      .values(row({ bookingId: 'missing-booking', idempotencyKey: 'notify:bad-booking:x' }))
      .catch((e: unknown) => e)
    expect(pgErrorCode(err)).toBe('23503')
  })

  it('rejects a non-existent operatorId with FK violation 23503', async () => {
    const err = await db
      .insert(notificationLog)
      .values(row({ operatorId: 'missing-operator', idempotencyKey: 'notify:bad-operator:x' }))
      .catch((e: unknown) => e)
    expect(pgErrorCode(err)).toBe('23503')
  })
})

// Proves the §3 atomic claim predicate against REAL Postgres — the InMemory unit
// tests cover the contract, but only this exercises the SQL `status IN (...) OR
// (SENDING AND updatedAt < now() - lease)` and the RETURNING-no-row guard.
describe('DrizzleNotificationLogRepository claim lease (§3)', () => {
  const repo = new DrizzleNotificationLogRepository(db)
  const keyFor = (kind: string) => `notify:${testBookingId}:claim-${kind}`

  it('claims a QUEUED row to SENDING, then refuses to re-claim a LIVE lease', async () => {
    const queued = await repo.upsertQueued(row({ idempotencyKey: keyFor('live') }))
    const first = await repo.claim(queued.id)
    expect(first?.status).toBe('SENDING')
    expect(first?.attempts).toBe(1)
    expect(await repo.claim(queued.id)).toBeUndefined() // live lease held
  })

  it('reclaims a SENDING row whose lease has EXPIRED', async () => {
    const queued = await repo.upsertQueued(row({ idempotencyKey: keyFor('expired') }))
    await repo.claim(queued.id)
    await db
      .update(notificationLog)
      .set({ updatedAt: sql`now() - interval '10 minutes'` })
      .where(eq(notificationLog.id, queued.id))
    const reclaimed = await repo.claim(queued.id)
    expect(reclaimed?.status).toBe('SENDING')
    expect(reclaimed?.attempts).toBe(2)
  })

  it('upsertQueued leaves a terminal SENT row unchanged on idempotency conflict', async () => {
    const first = await repo.upsertQueued(
      row({ idempotencyKey: keyFor('idem'), recipient: 'sent@op.com' }),
    )
    await repo.claim(first.id)
    await repo.markSent(first.id, 'msg-x')
    const replay = await repo.upsertQueued(
      row({ idempotencyKey: keyFor('idem'), recipient: 'changed@op.com', locale: 'ja' }),
    )
    expect(replay.id).toBe(first.id)
    expect(replay.status).toBe('SENT') // setWhere skips the update; lifecycle frozen
    expect(replay.recipient).toBe('sent@op.com') // audit reflects who was actually sent
    expect(replay.locale).toBe('en')
  })

  // #878: the operator-alert recipient set is recomputed at each send, so a row that
  // has not yet sent must refresh its audit recipient/locale to match the resend.
  it('upsertQueued refreshes recipient/locale on a re-sendable FAILED row', async () => {
    const first = await repo.upsertQueued(
      row({ idempotencyKey: keyFor('refresh'), recipient: 'owner@op.com', locale: 'en' }),
    )
    await repo.claim(first.id)
    await repo.markFailed(first.id, 'transient') // non-terminal, still reclaimable
    const refreshed = await repo.upsertQueued(
      row({
        idempotencyKey: keyFor('refresh'),
        recipient: 'owner@op.com, staff@op.com',
        locale: 'ja',
      }),
    )
    expect(refreshed.id).toBe(first.id)
    expect(refreshed.status).toBe('FAILED') // lifecycle untouched
    expect(refreshed.attempts).toBe(1) // attempts NOT reset
    expect(refreshed.recipient).toBe('owner@op.com, staff@op.com')
    expect(refreshed.locale).toBe('ja')
  })
})

// Proves the #483 attempt cap against REAL Postgres — exercises the markFailed
// `CASE WHEN attempts >= cap THEN 'DEAD' ELSE 'FAILED' END::notification_status`
// expression (the InMemory test covers the contract; only this runs the SQL).
describe('DrizzleNotificationLogRepository DEAD cap (#483)', () => {
  const repo = new DrizzleNotificationLogRepository(db)
  const keyFor = (suffix: string) => `notify:${testBookingId}:dead-${suffix}`

  it('markFailed flips to terminal DEAD at the cap, and claim never re-arms it', async () => {
    const queued = await repo.upsertQueued(row({ idempotencyKey: keyFor('cap') }))
    // Drive attempts to the cap; FAILED is always reclaimable, so no lease wait.
    for (let i = 0; i < MAX_NOTIFICATION_ATTEMPTS; i++) {
      await repo.claim(queued.id)
      await repo.markFailed(queued.id, 'hard bounce')
    }
    const dead = await repo.findById(SYSTEM_CONTEXT, queued.id)
    expect(dead).toMatchObject({ status: 'DEAD', attempts: MAX_NOTIFICATION_ATTEMPTS })

    // Even with no live lease (updatedAt far in the past), DEAD is never reclaimed.
    await db
      .update(notificationLog)
      .set({ updatedAt: sql`now() - interval '1 hour'` })
      .where(eq(notificationLog.id, queued.id))
    expect(await repo.claim(queued.id)).toBeUndefined()
  })

  it('markFailed stays FAILED below the cap (still reclaimable)', async () => {
    const queued = await repo.upsertQueued(row({ idempotencyKey: keyFor('below') }))
    await repo.claim(queued.id)
    await repo.markFailed(queued.id, 'transient')
    const failed = await repo.findById(SYSTEM_CONTEXT, queued.id)
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 1 })
    expect((await repo.claim(queued.id))?.status).toBe('SENDING')
  })
})

// #1125: the daily retry sweep's read. Proves against REAL Postgres that the SQL
// predicate returns EXACTLY the set claim() accepts (QUEUED / FAILED / expired
// SENDING) and excludes terminal SENT/DEAD and a live SENDING lease — the InMemory
// test covers the contract; only this runs the `OR (SENDING AND updatedAt < now()
// - lease)` SQL + ORDER BY. Isolated by idempotency-key prefix since sibling
// describes share this booking's rows.
describe('DrizzleNotificationLogRepository findRetryable (#1125 sweep)', () => {
  const repo = new DrizzleNotificationLogRepository(db)
  const expireLease = (id: string) =>
    db
      .update(notificationLog)
      .set({ updatedAt: sql`now() - interval '10 minutes'` })
      .where(eq(notificationLog.id, id))

  it('returns QUEUED / FAILED / expired-SENDING and excludes SENT / DEAD / live-SENDING', async () => {
    const P = `notify:${testBookingId}:retryable-`
    await repo.upsertQueued(row({ idempotencyKey: `${P}queued` })) // QUEUED

    const failed = await repo.upsertQueued(row({ idempotencyKey: `${P}failed` }))
    await repo.claim(failed.id)
    await repo.markFailed(failed.id, 'transient') // FAILED (below cap)

    const expired = await repo.upsertQueued(row({ idempotencyKey: `${P}expired` }))
    await repo.claim(expired.id)
    await expireLease(expired.id) // SENDING, lease lapsed -> reclaimable

    const live = await repo.upsertQueued(row({ idempotencyKey: `${P}live` }))
    await repo.claim(live.id) // SENDING, live lease -> excluded

    const sent = await repo.upsertQueued(row({ idempotencyKey: `${P}sent` }))
    await repo.claim(sent.id)
    await repo.markSent(sent.id, 'm') // SENT -> excluded

    const dead = await repo.upsertQueued(row({ idempotencyKey: `${P}dead` }))
    for (let i = 0; i < MAX_NOTIFICATION_ATTEMPTS; i++) {
      await repo.claim(dead.id)
      await repo.markFailed(dead.id, 'x') // -> terminal DEAD -> excluded
    }

    const mine = (await repo.findRetryable(1000)).filter((r) => r.idempotencyKey.startsWith(P))
    expect(mine.map((r) => r.idempotencyKey.slice(P.length)).sort()).toEqual([
      'expired',
      'failed',
      'queued',
    ])
  })
})

// #681: a phone-only renter / contactless operator yields a terminal NO_RECIPIENT
// row instead of a silent skip. Proves the enum value + empty address/locale write
// against real pg, and that the separate key never poisons a later real send.
describe('DrizzleNotificationLogRepository recordNoRecipient (#681)', () => {
  const repo = new DrizzleNotificationLogRepository(db)
  const KIND = 'RENTER_TRIP_STARTED' as const
  const skipKey = `notify:${testBookingId}:${KIND}:no_recipient`

  it('persists a terminal NO_RECIPIENT row with empty address/locale, idempotently', async () => {
    const a = await repo.recordNoRecipient({
      bookingId: testBookingId,
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      kind: KIND,
      idempotencyKey: skipKey,
    })
    expect(a).toMatchObject({ status: 'NO_RECIPIENT', recipient: '', locale: '', attempts: 0 })

    const b = await repo.recordNoRecipient({
      bookingId: testBookingId,
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      kind: KIND,
      idempotencyKey: skipKey,
    })
    expect(b.id).toBe(a.id) // conflict path returns the existing row, unchanged
  })

  it('does not block a later real send for the same (booking, kind) — separate key', async () => {
    const sendRow = await repo.upsertQueued({
      bookingId: testBookingId,
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      kind: KIND,
      recipient: 'renter@example.com',
      locale: 'en',
      idempotencyKey: `notify:${testBookingId}:${KIND}`,
    })
    expect(sendRow.status).toBe('QUEUED')
    expect((await repo.claim(sendRow.id))?.status).toBe('SENDING')
  })
})
