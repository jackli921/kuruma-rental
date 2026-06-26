import { describe, expect, it } from 'vitest'
import {
  type CallerContext,
  ForbiddenError,
  SYSTEM_CONTEXT,
  type UserRole,
} from '../middleware/auth'
import { InMemoryBookingRepository } from '../repositories/in-memory/booking'
import { InMemoryOperatorRepository } from '../repositories/in-memory/operator'
import { InMemoryPaymentAnomalyRepository } from '../repositories/in-memory/payment-anomaly'
import { InMemoryPaymentEventRepository } from '../repositories/in-memory/payment-event'
import { InMemoryRenterDocumentRepository } from '../repositories/in-memory/renter-document'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import type { Booking, Operator, PaymentAnomaly, PaymentEvent, RenterDocument } from '../stores'
import { AdminOverviewService } from './admin-overview'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'

function operator(id: string, name: string, slug: string): Operator {
  return { id, name, slug, preAuthHandoffUrl: null, createdAt: new Date(), updatedAt: new Date() }
}

function payment(grossJpy: number): PaymentEvent {
  return {
    id: crypto.randomUUID(),
    operatorId: OP_A,
    bookingId: crypto.randomUUID(),
    stripeEventId: crypto.randomUUID(),
    stripeCheckoutSessionId: crypto.randomUUID(),
    stripePaymentIntentId: null,
    grossJpy,
    platformFeeJpy: Math.round(grossJpy * 0.04),
    netToPartnerJpy: grossJpy - Math.round(grossJpy * 0.04),
    currency: 'jpy',
    status: 'SUCCEEDED',
    createdAt: new Date('2026-05-10T03:00:00Z'),
  }
}

function anomaly(over: Pick<PaymentAnomaly, 'stripeEventId' | 'resolvedAt'>): PaymentAnomaly {
  return {
    id: crypto.randomUUID(),
    operatorId: OP_A,
    bookingId: crypto.randomUUID(),
    kind: 'DOUBLE_PAYMENT',
    stripeCheckoutSessionId: crypto.randomUUID(),
    stripePaymentIntentId: 'pi_dup',
    receivedAmountJpy: 100_000,
    expectedAmountJpy: 100_000,
    currency: 'jpy',
    createdAt: new Date('2026-06-10T03:00:00Z'),
    resolution: null,
    resolvedBy: null,
    note: null,
    ...over,
  }
}

function renterDoc(status: RenterDocument['status']): RenterDocument {
  const now = new Date()
  return {
    id: crypto.randomUUID(),
    renterId: crypto.randomUUID(),
    type: 'PASSPORT',
    storageKey: `doc/${crypto.randomUUID()}`,
    status,
    expiryDate: null,
    verifiedAt: null,
    verifierId: null,
    rejectionReason: null,
    createdAt: now,
    updatedAt: now,
  }
}

function booking(): Booking {
  const now = new Date()
  return {
    id: crypto.randomUUID(),
    operatorId: OP_A,
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
  }
}

function mapOf<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]))
}

/**
 * Seeds every repo with a known fixture whose six aggregates are all DISTINCT
 * numbers, so a service that wired one figure to the wrong repo (or swapped two)
 * is caught — not a uniform "non-zero" smoke test.
 *
 * Expected: bookings=3, gmvJpy=35_000 (10k+25k SUCCEEDED), fleet=3 (4 vehicles −
 * 1 RETIRED), operators=2, unresolvedAnomalies=1 (1 unresolved + 1 actioned),
 * pendingDocs=2 (2 PENDING + 1 APPROVED).
 */
async function seededService() {
  const vehicleRepo = new InMemoryVehicleRepository()
  for (const status of ['AVAILABLE', 'AVAILABLE', 'MAINTENANCE', 'RETIRED'] as const) {
    await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: OP_A,
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
      status,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      make: null,
      model: null,
      year: null,
      color: null,
      dailyRateJpy: 8_000,
      hourlyRateJpy: null,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
    })
  }

  return new AdminOverviewService(
    new InMemoryBookingRepository(mapOf([booking(), booking(), booking()])),
    new InMemoryPaymentEventRepository(mapOf([payment(10_000), payment(25_000)])),
    vehicleRepo,
    new InMemoryOperatorRepository(
      mapOf([operator(OP_A, 'Best Car', 'best-car'), operator(OP_B, 'Aoki', 'aoki')]),
    ),
    new InMemoryPaymentAnomalyRepository(
      mapOf([
        anomaly({ stripeEventId: 'evt_open', resolvedAt: null }),
        anomaly({ stripeEventId: 'evt_done', resolvedAt: new Date('2026-06-11T03:00:00Z') }),
      ]),
    ),
    new InMemoryRenterDocumentRepository(
      mapOf([renterDoc('PENDING'), renterDoc('PENDING'), renterDoc('APPROVED')]),
    ),
  )
}

const ADMIN: CallerContext = { userId: 'admin-user', role: 'PLATFORM_ADMIN' }

describe('AdminOverviewService.getOverview (#1087)', () => {
  it('composes the six platform KPIs from their own repos with exact counts/sum', async () => {
    const service = await seededService()

    const overview = await service.getOverview(ADMIN)

    expect(overview).toEqual({
      bookings: 3,
      gmvJpy: 35_000,
      fleet: 3,
      operators: 2,
      unresolvedAnomalies: 1,
      pendingDocs: 2,
    })
  })

  it('counts RETIRED vehicles out of the fleet figure', async () => {
    const service = await seededService()
    const overview = await service.getOverview(ADMIN)
    // 4 vehicles seeded, one RETIRED — the live fleet is 3.
    expect(overview.fleet).toBe(3)
  })

  it('sums only SUCCEEDED gross, ignoring anomalies/refunds', async () => {
    const service = await seededService()
    const overview = await service.getOverview(ADMIN)
    expect(overview.gmvJpy).toBe(35_000)
  })
})

describe('AdminOverviewService — defence-in-depth gate (route bypass)', () => {
  it.each(['OPERATOR_OWNER', 'OPERATOR_STAFF', 'RENTER', 'PARTNER', 'STAFF', 'ADMIN'] as const)(
    'throws ForbiddenError for %s even if the route gate were bypassed',
    async (role: UserRole) => {
      const service = await seededService()
      await expect(service.getOverview({ userId: `${role}-user`, role })).rejects.toThrow(
        ForbiddenError,
      )
    },
  )
})
