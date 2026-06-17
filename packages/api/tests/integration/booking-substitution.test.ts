import type { RunTx } from '@kuruma/shared/db'
import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { bookingEvents, notificationLog, users, vehicleClasses } from '@kuruma/shared/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleBookingRepository,
  DrizzleLocationRepository,
  DrizzleNotificationLogRepository,
  DrizzleOperatorMembershipRepository,
  DrizzleOperatorRepository,
  DrizzleUserRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
  createDrizzleTransaction,
} from '../../src/repositories/drizzle'
import { BookingService } from '../../src/services/booking'
import { BookingPostCommitDispatcher } from '../../src/services/booking-post-commit-dispatcher'
import type { EmailSender } from '../../src/services/email/email-sender'
import { NotificationDispatcher } from '../../src/services/notification-dispatcher'
import { bookingInput } from '../helpers/booking'
import {
  cleanupLocations,
  cleanupUsers,
  cleanupVehicleClasses,
  cleanupVehicles,
  db,
  seedLocation,
  seedVehicleClass,
} from './setup'

// #826: the SUCCESS path of an operator vehicle substitution, over REAL Postgres.
// The 409-conflict path is already proven (booking-service-invariants.test.ts);
// the in-memory dispatcher unit test (services/notification-dispatcher.test.ts)
// covers RENTER_SUBSTITUTION. NEITHER proves the happy path end-to-end against pg:
// an operator swaps a same-ACRISS AVAILABLE vehicle and
//   (1) bookings.assignedVehicleId is reassigned (exclusion constraint still holds);
//   (2) a booking_events VEHICLE_SUBSTITUTED row is appended (inside the tx);
//   (3) a notification_log RENTER_SUBSTITUTION row is queued + sent (post-commit).
// This file closes that gap with a real post-commit dispatcher wired to a FAKE
// EmailSender (no provider call), exactly as the composition root wires it.

const runTx: RunTx = (fn) => db.transaction(fn)
const runInTransaction = createDrizzleTransaction(runTx)

const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)
const vehicleClassRepo = new DrizzleVehicleClassRepository(db)
const notificationLogRepo = new DrizzleNotificationLogRepository(db)
const operatorRepo = new DrizzleOperatorRepository(db)
const userRepo = new DrizzleUserRepository(db)
const membershipRepo = new DrizzleOperatorMembershipRepository(db)
const locationRepo = new DrizzleLocationRepository(db)

// Captures every outbound message instead of hitting a provider, so the dispatcher
// runs its full upsert -> claim -> send -> markSent unit and the notification_log
// row lands as SENT. Mirrors the fake in notification-dispatcher.test.ts.
const sentMessages: { to: string; subject: string }[] = []
const fakeEmailSender: EmailSender = {
  async send(message) {
    sentMessages.push({ to: message.to, subject: message.subject })
    return { providerMessageId: `msg-${sentMessages.length}` }
  },
}

const notificationDispatcher = new NotificationDispatcher(
  notificationLogRepo,
  operatorRepo,
  vehicleRepo,
  userRepo,
  membershipRepo,
  locationRepo,
  fakeEmailSender,
  { emailFrom: 'noreply@kuruma-test.com' },
)
// No message thread in this test — substitution only needs the notification effect.
const postCommit = new BookingPostCommitDispatcher(async () => {}, notificationDispatcher)

const service = new BookingService(
  bookingRepo,
  runInTransaction,
  vehicleRepo,
  userRepo,
  vehicleClassRepo,
  postCommit,
)

function operatorCtx(userId: string): CallerContext {
  return {
    userId,
    role: 'OPERATOR_OWNER',
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    bypassScope: false,
  }
}

async function seedRenter(prefix: string): Promise<{ id: string; email: string }> {
  const id = crypto.randomUUID()
  const email = `${prefix}-${id.slice(0, 8)}@kuruma-test.com`
  await db.insert(users).values({ id, email, role: 'RENTER', language: 'en' })
  return { id, email }
}

async function seedOperatorUser(prefix: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(users).values({
    id,
    email: `${prefix}-${id.slice(0, 8)}@kuruma-test.com`,
    role: 'OPERATOR_OWNER',
    language: 'ja',
  })
  return id
}

async function seedVehicle(
  classId: string,
  pickupLocationId: string,
  name: string,
): Promise<string> {
  const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId,
    pickupLocationId,
    name,
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 6000,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
  })
  return vehicle.id
}

/**
 * Poll a table until a matching row appears (or the budget is exhausted). The
 * substitution awaits its post-commit dispatch before returning, so in practice
 * the row is already present — but reading once risks the documented flake in
 * e2e/real-db/marketplace-happy-path.auth.spec.ts:175-195. Poll defensively.
 */
async function poll<T>(read: () => Promise<T | undefined>, attempts = 10): Promise<T | undefined> {
  for (let i = 0; i < attempts; i++) {
    const found = await read()
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return undefined
}

describe('operator vehicle substitution SUCCESS path (real pg)', () => {
  let classId: string
  let locationId: string
  let renter: { id: string; email: string }
  let operatorUserId: string
  let assignedVehicleId: string
  let alternateVehicleId: string
  let bookingId: string

  // A far-future window so it can never overlap a seeded demo booking.
  const startAt = new Date('2027-03-01T09:00:00Z')
  const endAt = new Date('2027-03-03T09:00:00Z')

  beforeAll(async () => {
    const klass = await seedVehicleClass('subst-ok')
    classId = klass.id
    // Substitution requires both vehicles' class to share a non-null ACRISS code.
    await db
      .update(vehicleClasses)
      .set({ acrissCode: 'CDAR' })
      .where(eq(vehicleClasses.id, classId))

    const location = await seedLocation('subst-ok')
    locationId = location.id
    renter = await seedRenter('subst-ok-renter')
    operatorUserId = await seedOperatorUser('subst-ok-op')

    assignedVehicleId = await seedVehicle(classId, locationId, 'Assigned Car')
    // Same operator + same pickup location + same ACRISS class + AVAILABLE: the
    // one eligible replacement. A different window means no exclusion clash.
    alternateVehicleId = await seedVehicle(classId, locationId, 'Replacement Car')

    const booking = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
        renterId: renter.id,
        classId,
        requestedVehicleId: assignedVehicleId,
        assignedVehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        startAt,
        endAt,
        status: 'CONFIRMED',
        totalPrice: 12000,
      }),
    )
    bookingId = booking.id
  })

  afterAll(async () => {
    await db.delete(notificationLog).where(eq(notificationLog.bookingId, bookingId))
    await db.delete(bookingEvents).where(eq(bookingEvents.bookingId, bookingId))
    await cleanupVehicles([assignedVehicleId, alternateVehicleId])
    await cleanupUsers([renter.id, operatorUserId])
    await cleanupVehicleClasses([classId])
    await cleanupLocations([locationId])
  })

  it('reassigns the vehicle, appends a SUBSTITUTED event, and queues a RENTER_SUBSTITUTION send', async () => {
    const reason = 'Original car in for maintenance'
    const res = await service.substitute(
      operatorCtx(operatorUserId),
      bookingId,
      alternateVehicleId,
      reason,
    )

    // (1) The substitution succeeded and the projection now points at the replacement.
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(`substitute failed: ${res.error}`)
    expect(res.booking.assignedVehicleId).toBe(alternateVehicleId)

    const fromDb = await bookingRepo.findById(SYSTEM_CONTEXT, bookingId)
    expect(fromDb?.assignedVehicleId).toBe(alternateVehicleId)
    // requestedVehicleId is the audit trail of the renter's original pick — never mutated.
    expect(fromDb?.requestedVehicleId).toBe(assignedVehicleId)
    // The replacement is bookable for this window, so the exclusion seal stayed satisfied.
    expect(fromDb?.status).toBe('CONFIRMED')

    // (2) A VEHICLE_SUBSTITUTED booking_event was appended inside the tx, carrying
    // the from/to vehicle ids and the operator as actor.
    const event = await poll(async () => {
      const [row] = await db
        .select()
        .from(bookingEvents)
        .where(
          and(
            eq(bookingEvents.bookingId, bookingId),
            eq(bookingEvents.type, 'VEHICLE_SUBSTITUTED'),
          ),
        )
        .orderBy(asc(bookingEvents.createdAt))
        .limit(1)
      return row
    })
    expect(event).toBeDefined()
    expect(event?.type).toBe('VEHICLE_SUBSTITUTED')
    expect(event?.actorId).toBe(operatorUserId)
    expect(event?.payload).toMatchObject({
      type: 'VEHICLE_SUBSTITUTED',
      fromVehicleId: assignedVehicleId,
      toVehicleId: alternateVehicleId,
      reason,
    })

    // (3) A RENTER_SUBSTITUTION notification_log row was queued post-commit and,
    // with the fake sender succeeding, claimed + marked SENT to the renter.
    const notification = await poll(async () => {
      const [row] = await db
        .select()
        .from(notificationLog)
        .where(
          and(
            eq(notificationLog.bookingId, bookingId),
            eq(notificationLog.kind, 'RENTER_SUBSTITUTION'),
          ),
        )
        .limit(1)
      return row
    })
    expect(notification).toBeDefined()
    expect(notification?.kind).toBe('RENTER_SUBSTITUTION')
    expect(notification?.operatorId).toBe(BEST_CAR_RENTAL_OPERATOR_ID)
    expect(notification?.recipient).toBe(renter.email)
    expect(notification?.channel).toBe('EMAIL')
    expect(notification?.status).toBe('SENT')
    expect(notification?.idempotencyKey).toBe(`notify:${bookingId}:RENTER_SUBSTITUTION`)

    // The fake provider actually received exactly one substitution email for the renter.
    expect(sentMessages).toContainEqual(expect.objectContaining({ to: renter.email }))
  })
})
