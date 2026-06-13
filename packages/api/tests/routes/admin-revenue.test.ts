import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import { ForbiddenError, type UserRole } from '../../src/middleware/auth'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import { InMemoryPaymentEventRepository } from '../../src/repositories/in-memory/payment-event'
import { createAdminRevenueRoutes } from '../../src/routes/admin-revenue'
import { AdminRevenueService } from '../../src/services/admin-revenue'
import type { Operator, PaymentEvent } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'

function operator(id: string, name: string, slug: string): Operator {
  return { id, name, slug, preAuthHandoffUrl: null, createdAt: new Date(), updatedAt: new Date() }
}

function payment(
  over: Partial<PaymentEvent> & Pick<PaymentEvent, 'operatorId' | 'createdAt'>,
): PaymentEvent {
  return {
    id: crypto.randomUUID(),
    bookingId: crypto.randomUUID(),
    stripeEventId: crypto.randomUUID(),
    stripeCheckoutSessionId: crypto.randomUUID(),
    stripePaymentIntentId: null,
    grossJpy: 10_000,
    platformFeeJpy: 400,
    netToPartnerJpy: 9_600,
    currency: 'jpy',
    status: 'SUCCEEDED',
    ...over,
  }
}

function seeded() {
  const operators = new Map<string, Operator>([
    [OP_A, operator(OP_A, 'Best Car Rental', 'best-car')],
    [OP_B, operator(OP_B, 'Aoki Rentals', 'aoki')],
  ])
  const payments = new Map<string, PaymentEvent>()
  for (const e of [
    payment({
      operatorId: OP_A,
      grossJpy: 10_000,
      platformFeeJpy: 400,
      netToPartnerJpy: 9_600,
      createdAt: new Date('2026-03-10T03:00:00Z'),
    }),
    payment({
      operatorId: OP_A,
      grossJpy: 20_000,
      platformFeeJpy: 800,
      netToPartnerJpy: 19_200,
      createdAt: new Date('2026-04-10T03:00:00Z'),
    }),
    payment({
      operatorId: OP_B,
      grossJpy: 50_000,
      platformFeeJpy: 2_000,
      netToPartnerJpy: 48_000,
      createdAt: new Date('2026-04-10T03:00:00Z'),
    }),
  ]) {
    payments.set(e.id, e)
  }
  return {
    operatorRepo: new InMemoryOperatorRepository(operators),
    paymentRepo: new InMemoryPaymentEventRepository(payments),
  }
}

function mount(role: UserRole, operatorId?: string) {
  const { operatorRepo, paymentRepo } = seeded()
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route('/', createAdminRevenueRoutes(new AdminRevenueService(paymentRepo, operatorRepo)))
  return app
}

describe('GET /admin/revenue — auth', () => {
  it('401 when unauthenticated', async () => {
    const { operatorRepo, paymentRepo } = seeded()
    const app = new Hono()
    app.route('/', createAdminRevenueRoutes(new AdminRevenueService(paymentRepo, operatorRepo)))
    expect((await app.request('/admin/revenue')).status).toBe(401)
  })

  it.each(['RENTER', 'PARTNER', 'STAFF', 'ADMIN'] as const)(
    '403 for %s (not a platform admin — legacy STAFF/ADMIN revoked #487)',
    async (role) => {
      expect((await mount(role).request('/admin/revenue')).status).toBe(403)
    },
  )

  it('403 for an OPERATOR_OWNER (must never see another partner revenue)', async () => {
    expect((await mount('OPERATOR_OWNER', OP_A).request('/admin/revenue')).status).toBe(403)
  })

  it('200 for PLATFORM_ADMIN (the only platform-admin role)', async () => {
    expect((await mount('PLATFORM_ADMIN').request('/admin/revenue')).status).toBe(200)
  })
})

describe('GET /admin/revenue — aggregation', () => {
  it('aggregates successful payments per partner, biggest earner first', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/revenue')
    const { data } = await res.json()

    expect(data.totals).toEqual({
      grossJpy: 80_000,
      platformFeeJpy: 3_200,
      netToPartnerJpy: 76_800,
      paymentCount: 3,
    })
    expect(data.partners.map((p: { operatorId: string }) => p.operatorId)).toEqual([OP_B, OP_A])

    const opA = data.partners.find((p: { operatorId: string }) => p.operatorId === OP_A)
    expect(opA).toMatchObject({
      operatorName: 'Best Car Rental',
      operatorSlug: 'best-car',
      grossJpy: 30_000,
      platformFeeJpy: 1_200,
      netToPartnerJpy: 28_800,
      paymentCount: 2,
    })
    // Two months, newest first.
    expect(opA.months.map((m: { month: string }) => m.month)).toEqual(['2026-04', '2026-03'])
  })
})

describe('GET /admin/revenue — month filter (#628)', () => {
  it('returns the full matrix and a null selectedMonth when no month is given', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/revenue')
    const { data } = await res.json()
    expect(data.selectedMonth).toBeNull()
    expect(data.availableMonths).toEqual(['2026-04', '2026-03'])
    expect(data.totals.grossJpy).toBe(80_000)
  })

  it('scopes the report to ?month=YYYY-MM (totals + partners reflect only that month)', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/revenue?month=2026-04')
    const { data } = await res.json()
    // April: OP_A 20,000 + OP_B 50,000 = 70,000 over 2 payments.
    expect(data.selectedMonth).toBe('2026-04')
    expect(data.totals).toEqual({
      grossJpy: 70_000,
      platformFeeJpy: 2_800,
      netToPartnerJpy: 67_200,
      paymentCount: 2,
    })
    // Each partner now carries only the April month row.
    for (const p of data.partners) {
      expect(p.months.map((m: { month: string }) => m.month)).toEqual(['2026-04'])
    }
  })

  it('keeps availableMonths the full set even while a single month is selected', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/revenue?month=2026-03')
    const { data } = await res.json()
    expect(data.selectedMonth).toBe('2026-03')
    expect(data.availableMonths).toEqual(['2026-04', '2026-03']) // not just March
    // March: OP_A only, 10,000.
    expect(data.partners.map((p: { operatorId: string }) => p.operatorId)).toEqual([OP_A])
    expect(data.totals.grossJpy).toBe(10_000)
  })

  it('returns an empty partner list for a valid month with no payments', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/revenue?month=2026-01')
    const { data } = await res.json()
    expect(res.status).toBe(200)
    expect(data.partners).toEqual([])
    expect(data.totals.grossJpy).toBe(0)
  })

  it.each(['2026-13', '2026-1', '202604', 'June', ''])(
    '400 for a malformed month %p',
    async (month) => {
      const res = await mount('PLATFORM_ADMIN').request(
        `/admin/revenue?month=${encodeURIComponent(month)}`,
      )
      expect(res.status).toBe(400)
    },
  )
})

describe('AdminRevenueService — defence-in-depth seal', () => {
  it.each(['OPERATOR_OWNER', 'RENTER', 'PARTNER'] as const)(
    'throws ForbiddenError for %s even if the route gate were bypassed',
    async (role) => {
      const { operatorRepo, paymentRepo } = seeded()
      const service = new AdminRevenueService(paymentRepo, operatorRepo)
      await expect(service.getReport({ userId: `${role}-user`, role })).rejects.toThrow(
        ForbiddenError,
      )
    },
  )
})
