import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import { ForbiddenError, type UserRole } from '../../src/middleware/auth'
import { InMemoryPaymentAnomalyRepository } from '../../src/repositories/in-memory/payment-anomaly'
import { createPaymentAnomalyRoutes } from '../../src/routes/payment-anomalies'
import { PaymentAnomalyService } from '../../src/services/payment-anomaly'
import type { PaymentAnomaly } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

const OP_A = 'operator-aaaaaaaa'

function anomaly(
  over: Partial<PaymentAnomaly> & Pick<PaymentAnomaly, 'stripeEventId'>,
): PaymentAnomaly {
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
    resolvedAt: null,
    createdAt: new Date('2026-06-10T03:00:00Z'),
    ...over,
  }
}

function seeded() {
  const store = new Map<string, PaymentAnomaly>()
  for (const a of [
    anomaly({ stripeEventId: 'evt_unresolved', kind: 'DOUBLE_PAYMENT' }),
    anomaly({
      stripeEventId: 'evt_resolved',
      resolvedAt: new Date('2026-06-11T03:00:00Z'), // already actioned — excluded
    }),
  ]) {
    store.set(a.id, a)
  }
  return new InMemoryPaymentAnomalyRepository(store)
}

function mount(role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route('/', createPaymentAnomalyRoutes(new PaymentAnomalyService(seeded())))
  return app
}

describe('GET /admin/payment-anomalies — auth', () => {
  it('401 when unauthenticated', async () => {
    const app = new Hono()
    app.route('/', createPaymentAnomalyRoutes(new PaymentAnomalyService(seeded())))
    expect((await app.request('/admin/payment-anomalies')).status).toBe(401)
  })

  it.each(['RENTER', 'PARTNER'] as const)('403 for %s (not a platform admin)', async (role) => {
    expect((await mount(role).request('/admin/payment-anomalies')).status).toBe(403)
  })

  it('403 for an OPERATOR_OWNER (payment oversight is platform-only)', async () => {
    expect((await mount('OPERATOR_OWNER', OP_A).request('/admin/payment-anomalies')).status).toBe(
      403,
    )
  })

  it.each(['PLATFORM_ADMIN', 'STAFF', 'ADMIN'] as const)('200 for %s', async (role) => {
    expect((await mount(role).request('/admin/payment-anomalies')).status).toBe(200)
  })
})

describe('GET /admin/payment-anomalies — listing', () => {
  it('returns only unresolved anomalies with their reconciliation identifiers', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/payment-anomalies')
    const { data } = await res.json()

    expect(data.anomalies).toHaveLength(1)
    expect(data.anomalies[0]).toMatchObject({
      kind: 'DOUBLE_PAYMENT',
      operatorId: OP_A,
      stripeEventId: 'evt_unresolved',
      stripePaymentIntentId: 'pi_dup',
      receivedAmountJpy: 100_000,
      expectedAmountJpy: 100_000,
      resolvedAt: null,
    })
  })
})

describe('PaymentAnomalyService — defence-in-depth seal', () => {
  it.each(['OPERATOR_OWNER', 'RENTER', 'PARTNER'] as const)(
    'throws ForbiddenError for %s even if the route gate were bypassed',
    async (role) => {
      const service = new PaymentAnomalyService(seeded())
      await expect(service.listUnresolved({ userId: `${role}-user`, role })).rejects.toThrow(
        ForbiddenError,
      )
    },
  )
})
