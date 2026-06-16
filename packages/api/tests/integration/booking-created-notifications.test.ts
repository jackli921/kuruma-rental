import type { RunTx } from '@kuruma/shared/db'
import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import {
  bookingEvents,
  notificationLog,
  operatorMemberships,
  users,
} from '@kuruma/shared/db/schema'
import { and, eq } from 'drizzle-orm'
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
import {
  cleanupLocations,
  cleanupUsers,
  cleanupVehicleClasses,
  cleanupVehicles,
  db,
  seedLocation,
  seedVehicleClass,
} from './setup'

// #839: the CREATE fan-out over REAL Postgres. notification-dispatcher.ts:33 maps
// `CREATED` -> ['RENTER_BOOKING_CONFIRM', 'OPERATOR_BOOKING_ALERT'], but no real-pg
// test drives the booking-CREATE service path asserting BOTH rows land. The
// dispatcher unit test (services/notification-dispatcher.test.ts) drives `dispatch`
// directly over in-memory stores; the real-db e2e
// (e2e/real-db/marketplace-happy-path.auth.spec.ts:186) polls ONLY
// OPERATOR_BOOKING_ALERT. This file closes that gap: it runs the real
// BookingService.create -> BookingPostCommitDispatcher -> NotificationDispatcher
// over pg (fake EmailSender, no provider call), exactly as the composition root
// wires it, and proves the renter-confirm + operator-alert pair both persist SENT.

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
// runs its full upsert -> claim -> send -> markSent unit and each notification_log
// row lands as SENT. Mirrors the fake in booking-substitution.test.ts.
const sentMessages: { to: string; bcc?: string[]; subject: string }[] = []
const fakeEmailSender: EmailSender = {
  async send(message) {
    sentMessages.push({ to: message.to, bcc: message.bcc, subject: message.subject })
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
// No message thread in this test — the CREATE fan-out only needs the notification effect.
const postCommit = new BookingPostCommitDispatcher(async () => {}, notificationDispatcher)

const service = new BookingService(
  bookingRepo,
  runInTransaction,
  vehicleRepo,
  userRepo,
  vehicleClassRepo,
  postCommit,
)

function renterCtx(userId: string): CallerContext {
  // No operatorId for a renter — exactOptionalPropertyTypes forbids an explicit
  // `operatorId: undefined`, so omit the key entirely (mirrors toCallerContext).
  return { userId, role: 'RENTER', bypassScope: false }
}

async function seedRenter(prefix: string): Promise<{ id: string; email: string }> {
  const id = crypto.randomUUID()
  const email = `${prefix}-${id.slice(0, 8)}@kuruma-test.com`
  await db.insert(users).values({ id, email, role: 'RENTER', language: 'en' })
  return { id, email }
}

// #878: the OPERATOR_BOOKING_ALERT recipient is sourced from the operator_memberships
// ledger (status='ACTIVE'), not the users.role projection — so seed BOTH an owner
// user AND an ACTIVE membership, or the alert falls back to fallbackOperatorEmail
// (unset here). The membership is the authoritative grant; the user row carries the
// email findByIds resolves.
async function seedOperatorOwner(prefix: string): Promise<{ id: string; email: string }> {
  const id = crypto.randomUUID()
  const email = `${prefix}-${id.slice(0, 8)}@kuruma-test.com`
  await db.insert(users).values({
    id,
    email,
    role: 'OPERATOR_OWNER',
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    language: 'ja',
  })
  await db.insert(operatorMemberships).values({
    userId: id,
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    role: 'OPERATOR_OWNER',
    status: 'ACTIVE',
  })
  return { id, email }
}

async function seedVehicle(classId: string, pickupLocationId: string): Promise<string> {
  const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId,
    pickupLocationId,
    name: 'Created-Booking Car',
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
 * Poll a table until a matching row appears (or the budget is exhausted).
 * `create` awaits its post-commit dispatch before returning, so the rows are in
 * practice already present — but reading once risks the documented flake in
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

function readNotification(
  bookingId: string,
  kind: 'RENTER_BOOKING_CONFIRM' | 'OPERATOR_BOOKING_ALERT',
) {
  return poll(async () => {
    const [row] = await db
      .select()
      .from(notificationLog)
      .where(and(eq(notificationLog.bookingId, bookingId), eq(notificationLog.kind, kind)))
      .limit(1)
    return row
  })
}

describe('booking CREATE notification fan-out (real pg)', () => {
  let classId: string
  let locationId: string
  let vehicleId: string
  let renter: { id: string; email: string }
  let operatorOwner: { id: string; email: string }
  let bookingId: string

  // A far-future window so it can never overlap a seeded demo booking.
  const startAt = new Date('2027-05-01T09:00:00Z')
  const endAt = new Date('2027-05-03T09:00:00Z')

  beforeAll(async () => {
    const klass = await seedVehicleClass('create-notif')
    classId = klass.id
    const location = await seedLocation('create-notif')
    locationId = location.id
    renter = await seedRenter('create-notif-renter')
    operatorOwner = await seedOperatorOwner('create-notif-owner')
    vehicleId = await seedVehicle(classId, locationId)
  })

  afterAll(async () => {
    // Drop the booking's children FIRST: create() appends a BOOKING_CREATED row to
    // booking_events (FK -> bookings), so cleanupVehicles' booking delete would 23503.
    if (bookingId) {
      await db.delete(notificationLog).where(eq(notificationLog.bookingId, bookingId))
      await db.delete(bookingEvents).where(eq(bookingEvents.bookingId, bookingId))
    }
    await cleanupVehicles([vehicleId])
    // #878: operator_memberships FK -> users is ON DELETE restrict (#728), so drop
    // the membership before the owner user or cleanupUsers would 23503.
    await db.delete(operatorMemberships).where(eq(operatorMemberships.userId, operatorOwner.id))
    await cleanupUsers([renter.id, operatorOwner.id])
    await cleanupVehicleClasses([classId])
    await cleanupLocations([locationId])
  })

  it('fans out to BOTH a renter-confirm AND an operator-alert notification row', async () => {
    const res = await service.create(renterCtx(renter.id), {
      requestedVehicleId: vehicleId,
      pickupLocationId: locationId,
      dropoffLocationId: locationId,
      addOnIds: [],
      renterId: renter.id,
      startAt,
      endAt,
      source: 'DIRECT',
      disclaimerAccepted: true,
    })

    // The create succeeded and produced a real CONFIRMED booking.
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(`create failed: ${JSON.stringify(res.error)}`)
    expect(res.booking.status).toBe('CONFIRMED')
    expect(res.booking.assignedVehicleId).toBe(vehicleId)
    bookingId = res.booking.id

    // (1) RENTER_BOOKING_CONFIRM was queued post-commit, claimed + marked SENT to
    // the renter's email under the per-(booking,kind) idempotency key.
    const renterRow = await readNotification(bookingId, 'RENTER_BOOKING_CONFIRM')
    expect(renterRow).toBeDefined()
    expect(renterRow?.kind).toBe('RENTER_BOOKING_CONFIRM')
    expect(renterRow?.status).toBe('SENT')
    expect(renterRow?.recipient).toBe(renter.email)
    expect(renterRow?.operatorId).toBe(BEST_CAR_RENTAL_OPERATOR_ID)
    expect(renterRow?.channel).toBe('EMAIL')
    expect(renterRow?.idempotencyKey).toBe(`notify:${bookingId}:RENTER_BOOKING_CONFIRM`)

    // (2) OPERATOR_BOOKING_ALERT (#878) was queued for the SAME booking and SENT to
    // the operator's ACTIVE members. The dispatcher resolves them from the
    // operator_memberships ledger -> userRepo.findByIds -> emails. Re-resolve through
    // that exact production path so the assertion is deterministic even if another
    // file seeds a second member for this operator (the audit recipient lists all).
    const members = await membershipRepo.findActiveByOperator(BEST_CAR_RENTAL_OPERATOR_ID)
    const memberUsers = await userRepo.findByIds(members.map((m) => m.userId))
    const memberEmails = memberUsers.map((u) => u.email).filter((e): e is string => Boolean(e))
    expect(memberEmails).toContain(operatorOwner.email)

    const operatorRow = await readNotification(bookingId, 'OPERATOR_BOOKING_ALERT')
    expect(operatorRow).toBeDefined()
    expect(operatorRow?.kind).toBe('OPERATOR_BOOKING_ALERT')
    expect(operatorRow?.status).toBe('SENT')
    // The audit recipient lists every notified member; the seeded owner is among them.
    expect(operatorRow?.recipient).toContain(operatorOwner.email)
    // It is an operator member address — never the renter's.
    expect(operatorRow?.recipient).not.toBe(renter.email)
    expect(operatorRow?.operatorId).toBe(BEST_CAR_RENTAL_OPERATOR_ID)
    expect(operatorRow?.channel).toBe('EMAIL')
    expect(operatorRow?.idempotencyKey).toBe(`notify:${bookingId}:OPERATOR_BOOKING_ALERT`)

    // The two rows are distinct recipients — proves the fan-out actually split the
    // audience rather than double-sending one address.
    expect(renterRow?.recipient).not.toBe(operatorRow?.recipient)

    // The fake provider received exactly one email per audience, no more. The
    // renter mail is addressed in `to`; the operator alert (#878) Bcc's the member.
    expect(sentMessages.filter((m) => m.to === renter.email)).toHaveLength(1)
    expect(sentMessages.filter((m) => m.bcc?.includes(operatorOwner.email))).toHaveLength(1)
  })
})
