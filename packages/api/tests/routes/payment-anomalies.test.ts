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
    resolution: null,
    resolvedBy: null,
    note: null,
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

  it('200 for PLATFORM_ADMIN', async () => {
    expect((await mount('PLATFORM_ADMIN').request('/admin/payment-anomalies')).status).toBe(200)
  })

  it.each(['STAFF', 'ADMIN'] as const)(
    '403 for legacy %s — platform-admin access revoked (#487)',
    async (role) => {
      expect((await mount(role).request('/admin/payment-anomalies')).status).toBe(403)
    },
  )
})

describe('GET /admin/payment-anomalies — listing (PaymentAnomalyView contract)', () => {
  it('returns only unresolved anomalies as views with reconciliation identifiers', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/payment-anomalies')
    const { data } = await res.json()

    expect(data.anomalies).toHaveLength(1)
    const [view] = data.anomalies
    expect(view).toMatchObject({
      kind: 'DOUBLE_PAYMENT',
      operatorId: OP_A,
      stripeEventId: 'evt_unresolved',
      stripePaymentIntentId: 'pi_dup',
      receivedAmountJpy: 100_000,
      expectedAmountJpy: 100_000,
      currency: 'jpy',
    })
    // Dates cross the wire as ISO strings (JSON has no Date type).
    expect(view.createdAt).toBe('2026-06-10T03:00:00.000Z')
    // An unresolved view carries the resolution audit fields as null (#1075 slice 3);
    // the internal resolvedBy and checkout-session id stay off the wire.
    expect(view.resolvedAt).toBeNull()
    expect(view.resolution).toBeNull()
    expect(view.note).toBeNull()
    expect('resolvedBy' in view).toBe(false)
    expect('stripeCheckoutSessionId' in view).toBe(false)
  })
})

describe('PaymentAnomalyService — defence-in-depth seal', () => {
  it.each(['OPERATOR_OWNER', 'RENTER', 'PARTNER', 'STAFF', 'ADMIN'] as const)(
    'throws ForbiddenError for %s even if the route gate were bypassed',
    async (role) => {
      const service = new PaymentAnomalyService(seeded())
      await expect(service.listUnresolved({ userId: `${role}-user`, role })).rejects.toThrow(
        ForbiddenError,
      )
    },
  )
})
