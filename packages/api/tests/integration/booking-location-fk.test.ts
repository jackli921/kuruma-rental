import { bookings, locations, operators, users, vehicleClasses } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, seedLocation, seedVehicleClass } from './setup'

// #3 (merged-PR review follow-up): bookings.pickupLocationId / dropoffLocationId
// were single-column FKs to locations.id, while every sibling reference (class,
// requested/assigned vehicle, insurance) is a COMPOSITE tenant seal
// (operatorId, x) -> ...(operatorId, id). The service validates locations on the
// normal submit path, but a direct repo/SQL write could still pair a booking's
// operatorId with ANOTHER operator's location. These composite FKs make that a
// DB invariant, mirroring vehicles_operatorId_pickupLocationId_fk (#412 part 3).
//
// Direct db.insert bypasses the service on purpose — that is the exact
// "direct write" hole the DB constraint has to close.
describe('bookings pickup/dropoff location composite FK (real pg)', () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_locfk_a_${uniq}`
  const opBId = `op_locfk_b_${uniq}`
  const renterId = crypto.randomUUID()
  let classAId: string
  let locationAId: string
  let locationBId: string

  // Enough of a CLASS_COMBO booking to reach the location FKs: no assigned/
  // requested vehicle (so the SPECIFIC CHECKs stay satisfied and no vehicle
  // seeding is needed), a valid same-tenant class, and a unique booking code.
  const bookingRow = (pickupLocationId: string, dropoffLocationId: string) => ({
    id: crypto.randomUUID(),
    operatorId: opAId,
    renterId,
    classId: classAId,
    pickupLocationId,
    dropoffLocationId,
    startAt: new Date('2027-03-01T09:00:00Z'),
    endAt: new Date('2027-03-03T09:00:00Z'),
    effectiveEndAt: new Date('2027-03-03T09:00:00Z'),
    fulfillmentMode: 'CLASS_COMBO' as const,
    bookingCode: `LOCFK${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
  })

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `locfk-a-${uniq}`, name: 'Loc FK Operator A' },
      { id: opBId, slug: `locfk-b-${uniq}`, name: 'Loc FK Operator B' },
    ])
    classAId = (await seedVehicleClass('locfk', opAId)).id
    locationAId = (await seedLocation('locfk-a', 2880, opAId)).id
    locationBId = (await seedLocation('locfk-b', 2880, opBId)).id
    await db.insert(users).values({
      id: renterId,
      email: `locfk-${uniq}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
  })

  afterAll(async () => {
    await db.delete(bookings).where(inArray(bookings.operatorId, [opAId, opBId]))
    await db.delete(users).where(inArray(users.id, [renterId]))
    await db.delete(vehicleClasses).where(inArray(vehicleClasses.operatorId, [opAId, opBId]))
    await db.delete(locations).where(inArray(locations.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('rejects a pickup location owned by another operator (23503)', async () => {
    await expectConstraintViolation(
      db.insert(bookings).values(bookingRow(locationBId, locationAId)),
      'bookings_operator_pickup_location_fk',
    )
  })

  it('rejects a dropoff location owned by another operator (23503)', async () => {
    await expectConstraintViolation(
      db.insert(bookings).values(bookingRow(locationAId, locationBId)),
      'bookings_operator_dropoff_location_fk',
    )
  })

  it('accepts pickup + dropoff owned by the booking’s own operator', async () => {
    const row = bookingRow(locationAId, locationAId)
    const [inserted] = await db.insert(bookings).values(row).returning({
      id: bookings.id,
      pickupLocationId: bookings.pickupLocationId,
      dropoffLocationId: bookings.dropoffLocationId,
    })
    expect(inserted).toEqual({
      id: row.id,
      pickupLocationId: locationAId,
      dropoffLocationId: locationAId,
    })
    await db.delete(bookings).where(inArray(bookings.id, [row.id]))
  })
})

/**
 * Drizzle wraps postgres-js errors as a QueryError with a generic
 * "Failed query" message; the underlying postgres error (with the constraint
 * name) lives on `.cause`. Mirrors the helper in vehicles-pricing.test.ts:
 * assert the thrown error's cause chain names the expected constraint.
 */
async function expectConstraintViolation(
  promise: Promise<unknown>,
  constraintName: string,
): Promise<void> {
  try {
    await promise
  } catch (err) {
    const chain: string[] = []
    let current: unknown = err
    for (let depth = 0; depth < 5 && current != null; depth++) {
      if (current instanceof Error) {
        chain.push(current.message)
        const withConstraint = current as Error & { constraint_name?: string }
        if (withConstraint.constraint_name) chain.push(withConstraint.constraint_name)
        current = (current as Error & { cause?: unknown }).cause
      } else {
        break
      }
    }
    const joined = chain.join(' | ')
    expect(joined).toContain(constraintName)
    return
  }
  throw new Error(`expected insert to reject with ${constraintName}, but it resolved`)
}
