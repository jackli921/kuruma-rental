import {
  bookingEvents,
  bookings,
  consentAcceptances,
  consentDocuments,
  notificationLog,
  operators,
  paymentEvents,
  users,
} from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DrizzleBookingRepository,
  DrizzleVehicleRepository,
  createDrizzleTransaction,
} from '../../src/repositories/drizzle'
import { BookingService } from '../../src/services/booking'
import { renterCtx } from '../helpers/context'
import { seedRenter, seedVehicle } from './booking-factory'
import {
  cleanupLocations,
  cleanupUsers,
  cleanupVehicleClasses,
  cleanupVehicles,
  db,
  seedLocation,
  seedVehicleClass,
} from './setup'

// #877 Slice B (real pg): the DARK server writer that mints an OPERATOR_RENTAL_TERMS
// acceptance INSIDE the booking tx. Every service-double (in-memory) test in the
// suite runs the flag OFF, so the write path — resolve the operator's published doc,
// version-pin, HMAC-sign the fresh bookingId, INSERT the ledger row atomically — is
// only provable against Postgres. This file wires a BookingService with the two
// thunks the composition root injects at GA: getSigningKey (a real key) and
// isOperatorTermsEnabled → true. Each test owns a FRESH operator so the operator-
// scoped "latest published version" query never collides with a parallel file.

const runInTransaction = createDrizzleTransaction((fn) => db.transaction(fn))
const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)

// The GA wiring: flag on + a deterministic signing key so recordSignature is a real
// 64-hex HMAC we can pin. positional args mirror the facade ctor (getSigningKey is
// arg 12, isOperatorTermsEnabled arg 13); the intervening seams are unused here.
const SIGNING_KEY = { key: 'operator-terms-test-key', keyId: 'test' }
const service = new BookingService(
  bookingRepo,
  runInTransaction,
  vehicleRepo,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  () => SIGNING_KEY,
  async () => true,
)

const START = new Date('2027-03-05T09:00:00Z')
const END = new Date('2027-03-07T09:00:00Z')

interface World {
  operatorId: string
  classId: string
  locationId: string
  vehicleId: string
  renterId: string
}

// Deferred teardown: each test registers what it created; FK-safe order runs after.
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    if (fn) await fn()
  }
})

async function seedOperator(prefix: string): Promise<string> {
  const id = crypto.randomUUID()
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await db.insert(operators).values({ id, slug: `op-${prefix}-${uniq}`, name: `Op ${prefix}` })
  return id
}

/** Insert a PUBLISHED, already-effective operator rental-terms doc for one (version, locale). */
async function seedPublishedTerms(
  operatorId: string,
  version: string,
  locale: string,
): Promise<void> {
  await db.insert(consentDocuments).values({
    id: crypto.randomUUID(),
    operatorId,
    type: 'OPERATOR_RENTAL_TERMS',
    version,
    locale,
    title: `Terms ${version} ${locale}`,
    body: `Body ${version} ${locale}`,
    acceptanceLabel: 'I agree',
    contentHash: crypto.randomUUID(),
    status: 'PUBLISHED',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    publishedAt: new Date('2026-01-02T00:00:00Z'),
  })
}

/** Fresh operator + class + location + vehicle + renter, registered for teardown. */
async function makeWorld(prefix: string): Promise<World> {
  const operatorId = await seedOperator(prefix)
  const klass = await seedVehicleClass(prefix, operatorId, 'CCAR')
  const location = await seedLocation(prefix, 2880, operatorId)
  const renterId = await seedRenter(prefix)
  const vehicleId = await seedVehicle({
    operatorId,
    classId: klass.id,
    pickupLocationId: location.id,
    name: `${prefix} car`,
    dailyRateJpy: 8000,
  })
  cleanups.push(async () => {
    await db.delete(consentDocuments).where(eq(consentDocuments.operatorId, operatorId))
    await cleanupVehicles([vehicleId])
    await cleanupVehicleClasses([klass.id])
    await cleanupLocations([location.id])
    await cleanupUsers([renterId])
    await db.delete(operators).where(eq(operators.id, operatorId))
  })
  return { operatorId, classId: klass.id, locationId: location.id, vehicleId, renterId }
}

/** Delete a booking and everything that FK-references it (children + the acceptance). */
function registerBookingCleanup(bookingId: string, mintedUserId?: string): void {
  cleanups.push(async () => {
    await db.delete(consentAcceptances).where(eq(consentAcceptances.bookingId, bookingId))
    await db.delete(bookingEvents).where(eq(bookingEvents.bookingId, bookingId))
    await db.delete(paymentEvents).where(eq(paymentEvents.bookingId, bookingId))
    await db.delete(notificationLog).where(eq(notificationLog.bookingId, bookingId))
    await db.delete(bookings).where(eq(bookings.id, bookingId))
    if (mintedUserId) await db.delete(users).where(eq(users.id, mintedUserId))
  })
}

function selfServeInput(w: World, over: Record<string, unknown>) {
  return {
    fulfillmentMode: 'SPECIFIC' as const,
    requestedVehicleId: w.vehicleId,
    pickupLocationId: w.locationId,
    dropoffLocationId: w.locationId,
    insuranceOptionId: null,
    addOnIds: [],
    renterId: w.renterId,
    startAt: START,
    endAt: END,
    source: 'DIRECT' as const,
    ...over,
  }
}

async function acceptancesFor(bookingId: string) {
  return db.select().from(consentAcceptances).where(eq(consentAcceptances.bookingId, bookingId))
}

describe('operator-terms acceptance sealed inside the booking tx (#877 Slice B, real pg)', () => {
  it('seals a signed acceptance row when the renter accepts the pinned latest version', async () => {
    const w = await makeWorld('accept')
    await seedPublishedTerms(w.operatorId, 'v1', 'en')
    await seedPublishedTerms(w.operatorId, 'v1', 'ja')

    const res = await service.create(
      renterCtx(w.renterId),
      selfServeInput(w, {
        operatorRentalTermsAccepted: true,
        operatorRentalTermsAcceptedVersion: 'v1',
        locale: 'ja',
      }),
    )
    expect(res.ok, res.ok ? '' : JSON.stringify(res.error)).toBe(true)
    if (!res.ok) return
    registerBookingCleanup(res.booking.id)

    const rows = await acceptancesFor(res.booking.id)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row).toMatchObject({
      consentType: 'OPERATOR_RENTAL_TERMS',
      bookingId: res.booking.id,
      operatorId: null,
      operatorMembershipId: null,
      userId: w.renterId,
      actorRole: 'RENTER',
      method: 'CLICKWRAP',
      signingKeyId: 'test',
    })
    // The exact locale the renter rendered (ja) is sealed — not the en fallback.
    expect(row?.documentSnapshot).toMatchObject({ version: 'v1', locale: 'ja' })
    expect(row?.recordSignature).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects the booking with 422 OPERATOR_TERMS_REQUIRED when the renter did not accept', async () => {
    const w = await makeWorld('required')
    await seedPublishedTerms(w.operatorId, 'v1', 'en')

    const res = await service.create(
      renterCtx(w.renterId),
      selfServeInput(w, { operatorRentalTermsAccepted: false }),
    )
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(422)
    expect(res.code).toBe('OPERATOR_TERMS_REQUIRED')
    // Early return BEFORE the insert: no booking row was minted.
    const booked = await db.select().from(bookings).where(eq(bookings.renterId, w.renterId))
    expect(booked).toHaveLength(0)
  })

  it('rejects the booking with 422 OPERATOR_TERMS_CHANGED when the pinned version is stale', async () => {
    const w = await makeWorld('changed')
    await seedPublishedTerms(w.operatorId, 'v1', 'en')
    await seedPublishedTerms(w.operatorId, 'v1', 'ja')
    // v2 is now the latest published version; a v1 pin is out of date.
    await seedPublishedTerms(w.operatorId, 'v2', 'en')
    await seedPublishedTerms(w.operatorId, 'v2', 'ja')

    const res = await service.create(
      renterCtx(w.renterId),
      selfServeInput(w, {
        operatorRentalTermsAccepted: true,
        operatorRentalTermsAcceptedVersion: 'v1',
        locale: 'ja',
      }),
    )
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(422)
    expect(res.code).toBe('OPERATOR_TERMS_CHANGED')
  })

  it('books normally with no acceptance row when the operator has no published terms', async () => {
    const w = await makeWorld('no-doc')
    // No seedPublishedTerms — the operator has nothing effective to seal.

    const res = await service.create(
      renterCtx(w.renterId),
      selfServeInput(w, { operatorRentalTermsAccepted: false }),
    )
    expect(res.ok, res.ok ? '' : JSON.stringify(res.error)).toBe(true)
    if (!res.ok) return
    registerBookingCleanup(res.booking.id)

    expect(await acceptancesFor(res.booking.id)).toHaveLength(0)
  })

  it('skips the acceptance entirely for a non-RENTER (operator manual) booking even with the flag on', async () => {
    const w = await makeWorld('manual')
    await seedPublishedTerms(w.operatorId, 'v1', 'en')

    // A real owner user: the BOOKING_CREATED event stamps actorId = ctx.userId (an
    // FK to users), so the operator ctx must name an existing user, not the helper's
    // placeholder 'owner'.
    const ownerId = crypto.randomUUID()
    await db.insert(users).values({
      id: ownerId,
      email: `owner-${ownerId.slice(0, 8)}@kuruma-877w.test`,
      role: 'OPERATOR_OWNER',
      operatorId: w.operatorId,
      language: 'en',
    })
    cleanups.push(async () => {
      await db.delete(users).where(eq(users.id, ownerId))
    })
    const ownerCtx = {
      userId: ownerId,
      role: 'OPERATOR_OWNER' as const,
      operatorId: w.operatorId,
      bypassScope: false,
    }

    // An operator walk-in books its own vehicle: ctx.role !== 'RENTER', so the gate
    // in create() floors active=false — the §9b fix that keeps operator/PARTNER
    // creates out of the renter-only consent path. The booking still succeeds.
    const res = await service.create(ownerCtx, {
      fulfillmentMode: 'SPECIFIC',
      requestedVehicleId: w.vehicleId,
      pickupLocationId: w.locationId,
      dropoffLocationId: w.locationId,
      insuranceOptionId: null,
      addOnIds: [],
      walkInCustomer: { name: 'Manual Taro', phone: '+81-90-0000-0000' },
      startAt: START,
      endAt: END,
      source: 'MANUAL',
    })
    expect(res.ok, res.ok ? '' : JSON.stringify(res.error)).toBe(true)
    if (!res.ok) return
    registerBookingCleanup(res.booking.id, res.booking.renterId)

    expect(await acceptancesFor(res.booking.id)).toHaveLength(0)
  })
})
