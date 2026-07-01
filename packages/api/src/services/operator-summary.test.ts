import { describe, expect, it } from 'vitest'
import {
  type CallerContext,
  ForbiddenError,
  NotFoundError,
  type UserRole,
} from '../middleware/auth'
import { InMemoryBookingRepository } from '../repositories/in-memory/booking'
import { InMemoryComplianceAlertLogRepository } from '../repositories/in-memory/compliance-alert-log'
import { InMemoryOperatorRepository } from '../repositories/in-memory/operator'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import type { Booking, ComplianceAlertLog, Operator, Vehicle } from '../stores'
import { OperatorSummaryService } from './operator-summary'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'
const OP_C = 'operator-cccccccc' // exists, but has no vehicles/bookings/alerts

// Fixed clock so compliance classification (JST date) and "upcoming" (startAt >= now)
// are deterministic. asOf JST date = 2026-06-27; expiring-soon threshold = 2026-07-27.
const NOW = new Date('2026-06-27T03:00:00Z')

function operator(id: string, name: string, slug: string): Operator {
  return {
    id,
    name,
    slug,
    preAuthHandoffUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deactivatedAt: null,
  }
}

function vehicle(over: Partial<Vehicle> & Pick<Vehicle, 'operatorId'>): Vehicle {
  const now = new Date()
  return {
    id: crypto.randomUUID(),
    classId: 'class-1',
    pickupLocationId: 'loc-1',
    name: 'Car',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: null,
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
    dailyRateJpy: 8_000,
    hourlyRateJpy: null,
    shakenExpiryDate: '2027-01-01',
    insuranceExpiryDate: '2027-01-01',
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function booking(over: Partial<Booking> & Pick<Booking, 'operatorId'>): Booking {
  const now = new Date()
  return {
    id: crypto.randomUUID(),
    renterId: crypto.randomUUID(),
    classId: 'class-1',
    requestedVehicleId: 'veh-1',
    assignedVehicleId: 'veh-1',
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    startAt: new Date('2026-08-01T09:00:00Z'),
    endAt: new Date('2026-08-01T17:00:00Z'),
    effectiveEndAt: new Date('2026-08-01T17:00:00Z'),
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'SPECIFIC',
    bookingCode: `BK-${crypto.randomUUID().slice(0, 6)}`,
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 30_000,
    cancellationFee: null,
    cancellationFeeSettlement: 'ADVISORY',
    cancelledAt: null,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function alert(id: string, operatorId: string, sentAt: Date): [string, ComplianceAlertLog] {
  return [
    id,
    {
      id,
      operatorId,
      vehicleId: `veh-${id}`,
      documentType: 'SHAKEN',
      thresholdBand: 'D30',
      recipient: 'a@example.com',
      sentAt,
    },
  ]
}

function mapOf<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]))
}

/**
 * Seeds the four repos so every summary figure is a DISTINCT number — a service
 * that wired one figure to the wrong field (or swapped two) is caught, not a
 * uniform "non-zero" smoke test. Foreign-operator (OP_B) rows in every repo prove
 * the roll-up is operator-scoped, not platform-wide.
 *
 * Expected for OP_A: vehicleCount=5, vehiclesNeedingDocs=3, vehiclesExpiringSoon=1,
 * totalBookings=4, upcomingBookings=2, lastComplianceAlertAt=2026-06-20T09:30Z.
 */
function seededService(now: () => Date = () => NOW) {
  const vehicles = new InMemoryVehicleRepository(
    mapOf([
      vehicle({ operatorId: OP_A, shakenExpiryDate: null }), // UNKNOWN → needingDocs
      vehicle({ operatorId: OP_A, shakenExpiryDate: '2026-01-01' }), // EXPIRED → needingDocs
      vehicle({ operatorId: OP_A, insuranceExpiryDate: null }), // UNKNOWN → needingDocs
      vehicle({ operatorId: OP_A, shakenExpiryDate: '2026-07-10' }), // <=2026-07-27 → expiringSoon
      vehicle({ operatorId: OP_A }), // both far-future → fine
      vehicle({ operatorId: OP_A, status: 'RETIRED', shakenExpiryDate: null }), // excluded
      vehicle({ operatorId: OP_B, shakenExpiryDate: null }), // other operator → excluded
    ]),
  )
  const bookings = new InMemoryBookingRepository(
    mapOf([
      booking({ operatorId: OP_A, status: 'CONFIRMED' }), // future → total + upcoming
      booking({ operatorId: OP_A, status: 'ACTIVE', startAt: new Date('2026-09-01T09:00:00Z') }), // upcoming
      booking({ operatorId: OP_A, status: 'COMPLETED', startAt: new Date('2026-05-01T09:00:00Z') }), // total only
      booking({ operatorId: OP_A, status: 'CONFIRMED', startAt: new Date('2026-05-02T09:00:00Z') }), // past → total only
      booking({ operatorId: OP_A, status: 'CANCELLED' }), // excluded
      booking({ operatorId: OP_B, status: 'CONFIRMED' }), // other operator → excluded
    ]),
  )
  const complianceAlerts = new InMemoryComplianceAlertLogRepository(
    new Map([
      alert('1', OP_A, new Date('2026-06-01T00:00:00Z')),
      alert('2', OP_A, new Date('2026-06-20T09:30:00Z')), // latest for OP_A
      alert('3', OP_B, new Date('2026-06-25T00:00:00Z')), // newer, other operator
    ]),
  )
  const operators = new InMemoryOperatorRepository(
    mapOf([
      operator(OP_A, 'Best Car', 'best-car'),
      operator(OP_B, 'Aoki', 'aoki'),
      operator(OP_C, 'Newcomer', 'newcomer'),
    ]),
  )
  return new OperatorSummaryService(operators, vehicles, bookings, complianceAlerts, now)
}

const ADMIN: CallerContext = { userId: 'admin-user', role: 'PLATFORM_ADMIN' }

describe('OperatorSummaryService.getSummary (#1120)', () => {
  it('composes the operator-scoped metrics with exact, distinct counts', async () => {
    const summary = await seededService().getSummary(ADMIN, OP_A)

    expect(summary).toEqual({
      operatorId: OP_A,
      name: 'Best Car',
      vehicleCount: 5,
      vehiclesNeedingDocs: 3,
      vehiclesExpiringSoon: 1,
      totalBookings: 4,
      upcomingBookings: 2,
      lastComplianceAlertAt: '2026-06-20T09:30:00.000Z',
    })
  })

  it('scopes every figure to the requested operator, not platform-wide', async () => {
    // OP_B carries one vehicle, one booking, and the newest alert in the fixture.
    const summary = await seededService().getSummary(ADMIN, OP_B)
    expect(summary.vehicleCount).toBe(1)
    expect(summary.totalBookings).toBe(1)
    expect(summary.lastComplianceAlertAt).toBe('2026-06-25T00:00:00.000Z')
  })

  it('reports null lastComplianceAlertAt and zero counts when the operator has no data', async () => {
    const summary = await seededService().getSummary(ADMIN, OP_C)
    expect(summary).toEqual({
      operatorId: OP_C,
      name: 'Newcomer',
      vehicleCount: 0,
      vehiclesNeedingDocs: 0,
      vehiclesExpiringSoon: 0,
      totalBookings: 0,
      upcomingBookings: 0,
      lastComplianceAlertAt: null,
    })
  })

  it('throws NotFoundError for an unknown operator id', async () => {
    await expect(seededService().getSummary(ADMIN, 'operator-zzzzzzzz')).rejects.toThrow(
      NotFoundError,
    )
  })
})

describe('OperatorSummaryService — defence-in-depth gate (route bypass)', () => {
  it.each(['OPERATOR_OWNER', 'OPERATOR_STAFF', 'RENTER', 'PARTNER', 'STAFF', 'ADMIN'] as const)(
    'throws ForbiddenError for %s even if the route gate were bypassed',
    async (role: UserRole) => {
      await expect(
        seededService().getSummary({ userId: `${role}-user`, role }, OP_A),
      ).rejects.toThrow(ForbiddenError)
    },
  )
})
