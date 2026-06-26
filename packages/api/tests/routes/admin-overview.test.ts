import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import { SYSTEM_CONTEXT, type UserRole } from '../../src/middleware/auth'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import { InMemoryPaymentAnomalyRepository } from '../../src/repositories/in-memory/payment-anomaly'
import { InMemoryPaymentEventRepository } from '../../src/repositories/in-memory/payment-event'
import { InMemoryRenterDocumentRepository } from '../../src/repositories/in-memory/renter-document'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import { createAdminOverviewRoutes } from '../../src/routes/admin-overview'
import { AdminOverviewService } from '../../src/services/admin-overview'
import type {
  Booking,
  Operator,
  PaymentAnomaly,
  PaymentEvent,
  RenterDocument,
} from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

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

// bookings=3, gmvJpy=35_000, fleet=3 (4 − 1 RETIRED), operators=2,
// unresolvedAnomalies=1, pendingDocs=2 — six distinct figures (catch a swap).
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

async function mount(role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route('/', createAdminOverviewRoutes(await seededService()))
  return app
}

describe('GET /admin/overview — auth', () => {
  it('401 when unauthenticated', async () => {
    const app = new Hono()
    app.route('/', createAdminOverviewRoutes(await seededService()))
    expect((await app.request('/admin/overview')).status).toBe(401)
  })

  it.each(['RENTER', 'PARTNER', 'STAFF', 'ADMIN', 'OPERATOR_STAFF'] as const)(
    '403 for %s (only PLATFORM_ADMIN may read platform health)',
    async (role) => {
      expect((await (await mount(role)).request('/admin/overview')).status).toBe(403)
    },
  )

  it('403 for an OPERATOR_OWNER (a tenant must never read platform-wide health)', async () => {
    const app = await mount('OPERATOR_OWNER', OP_A)
    expect((await app.request('/admin/overview')).status).toBe(403)
  })

  it('200 for PLATFORM_ADMIN (the only platform-admin role)', async () => {
    const app = await mount('PLATFORM_ADMIN')
    expect((await app.request('/admin/overview')).status).toBe(200)
  })
})

describe('GET /admin/overview — aggregate', () => {
  it('returns the six platform KPIs computed from the seeded fixture', async () => {
    const app = await mount('PLATFORM_ADMIN')
    const res = await app.request('/admin/overview')
    const { success, data } = await res.json()

    expect(success).toBe(true)
    expect(data).toMatchObject({
      bookings: 3,
      gmvJpy: 35_000,
      fleet: 3,
      operators: 2,
      unresolvedAnomalies: 1,
      pendingDocs: 2,
    })
  })
})
