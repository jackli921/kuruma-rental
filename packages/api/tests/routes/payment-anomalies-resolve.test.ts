import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryPaymentAnomalyRepository } from '../../src/repositories/in-memory/payment-anomaly'
import { createPaymentAnomalyRoutes } from '../../src/routes/payment-anomalies'
import { PaymentAnomalyService } from '../../src/services/payment-anomaly'
import type { PaymentAnomaly } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

const OP_A = 'operator-aaaaaaaa'
const ANOMALY_ID = 'anomaly-11111111'

function anomaly(over: Partial<PaymentAnomaly> = {}): PaymentAnomaly {
  return {
    id: ANOMALY_ID,
    operatorId: OP_A,
    bookingId: crypto.randomUUID(),
    kind: 'DOUBLE_PAYMENT',
    stripeEventId: crypto.randomUUID(),
    stripeCheckoutSessionId: crypto.randomUUID(),
    stripePaymentIntentId: 'pi_dupe',
    receivedAmountJpy: 10_000,
    expectedAmountJpy: 10_000,
    currency: 'jpy',
    resolution: null,
    resolvedBy: null,
    note: null,
    resolvedAt: null,
    createdAt: new Date('2026-06-20T03:00:00Z'),
    ...over,
  }
}

function seeded() {
  return new InMemoryPaymentAnomalyRepository(new Map([[ANOMALY_ID, anomaly()]]))
}

function mount(role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route('/', createPaymentAnomalyRoutes(new PaymentAnomalyService(seeded())))
  return app
}

function resolveReq(app: Hono, body: unknown = { resolution: 'BENIGN' }) {
  return app.request(`/admin/payment-anomalies/${ANOMALY_ID}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function listReq(app: Hono, status: 'resolved' | 'unresolved') {
  return app.request(`/admin/payment-anomalies?status=${status}`)
}

async function ids(res: Response): Promise<string[]> {
  const json = (await res.json()) as { data: { anomalies: Array<{ id: string }> } }
  return json.data.anomalies.map((a) => a.id)
}

describe('POST /admin/payment-anomalies/:id/resolve — auth', () => {
  it('401 when unauthenticated', async () => {
    const app = new Hono()
    setupGlobalHandlers(app)
    app.route('/', createPaymentAnomalyRoutes(new PaymentAnomalyService(seeded())))
    expect((await resolveReq(app)).status).toBe(401)
  })

  it.each(['RENTER', 'PARTNER', 'STAFF', 'ADMIN'] as const)(
    '403 for %s (resolving an anomaly is a platform-governance action)',
    async (role) => {
      expect((await resolveReq(mount(role))).status).toBe(403)
    },
  )

  it('403 for an OPERATOR_OWNER (payment oversight is platform-only)', async () => {
    expect((await resolveReq(mount('OPERATOR_OWNER', OP_A))).status).toBe(403)
  })
})

describe('POST /admin/payment-anomalies/:id/resolve — behaviour', () => {
  it('writes the full resolution audit and returns the resolved view (no money fields)', async () => {
    const app = mount('PLATFORM_ADMIN')
    const res = await resolveReq(app, {
      resolution: 'REFUNDED_EXTERNALLY',
      note: 'refunded in Stripe',
    })
    expect(res.status).toBe(200)

    const { data } = (await res.json()) as {
      data: { anomaly: { id: string; resolution: string; note: string; resolvedAt: string } }
    }
    expect(data.anomaly).toMatchObject({
      id: ANOMALY_ID,
      resolution: 'REFUNDED_EXTERNALLY',
      note: 'refunded in Stripe',
    })
    // resolvedAt is stamped to a real ISO instant by the resolve, not echoed null.
    expect(Number.isNaN(Date.parse(data.anomaly.resolvedAt))).toBe(false)
  })

  it('drops the anomaly from the unresolved list and surfaces it under ?status=resolved', async () => {
    const app = mount('PLATFORM_ADMIN')
    expect(await ids(await listReq(app, 'unresolved'))).toEqual([ANOMALY_ID])

    expect((await resolveReq(app, { resolution: 'BENIGN' })).status).toBe(200)

    expect(await ids(await listReq(app, 'unresolved'))).toEqual([])
    expect(await ids(await listReq(app, 'resolved'))).toEqual([ANOMALY_ID])
  })

  it('is write-once: resolving an already-resolved anomaly is a 404, not a silent overwrite', async () => {
    const app = mount('PLATFORM_ADMIN')
    expect((await resolveReq(app, { resolution: 'BENIGN' })).status).toBe(200)
    expect((await resolveReq(app, { resolution: 'INVESTIGATED' })).status).toBe(404)
  })

  it('404 when the anomaly id is unknown', async () => {
    const app = new Hono()
    setupGlobalHandlers(app)
    app.use('*', testAuthMiddleware('admin', 'PLATFORM_ADMIN'))
    app.route('/', createPaymentAnomalyRoutes(new PaymentAnomalyService(seeded())))
    const res = await app.request('/admin/payment-anomalies/anomaly-99999999/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: 'BENIGN' }),
    })
    expect(res.status).toBe(404)
  })

  it('400 on a drifted body — an unknown resolution or a foreign field (.strict seam)', async () => {
    const app = mount('PLATFORM_ADMIN')
    expect((await resolveReq(app, { resolution: 'WHATEVER' })).status).toBe(400)
    expect((await resolveReq(app, { resolution: 'BENIGN', amountJpy: 5000 })).status).toBe(400)
  })

  it('400 when ?status is neither resolved nor unresolved', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/payment-anomalies?status=bogus')
    expect(res.status).toBe(400)
  })
})
