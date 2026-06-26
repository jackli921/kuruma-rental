import { describe, expect, it } from 'vitest'
import type { PaymentAnomaly } from '../../stores'
import type { NewPaymentAnomaly } from '../types'
import { InMemoryPaymentAnomalyRepository } from './payment-anomaly'

function newAnomaly(overrides: Partial<NewPaymentAnomaly> = {}): NewPaymentAnomaly {
  return {
    operatorId: 'op-1',
    bookingId: 'bk-1',
    kind: 'DOUBLE_PAYMENT',
    stripeEventId: 'evt_1',
    stripeCheckoutSessionId: 'cs_1',
    stripePaymentIntentId: 'pi_1',
    receivedAmountJpy: 100_000,
    expectedAmountJpy: 100_000,
    currency: 'jpy',
    ...overrides,
  }
}

describe('InMemoryPaymentAnomalyRepository', () => {
  it('records an anomaly and surfaces it via listUnresolved with store-assigned id/createdAt', async () => {
    const repo = new InMemoryPaymentAnomalyRepository()
    await repo.record(newAnomaly({ kind: 'AMOUNT_MISMATCH', receivedAmountJpy: 99_999 }))

    const rows = await repo.listUnresolved()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      operatorId: 'op-1',
      bookingId: 'bk-1',
      kind: 'AMOUNT_MISMATCH',
      stripeEventId: 'evt_1',
      receivedAmountJpy: 99_999,
      expectedAmountJpy: 100_000,
      resolvedAt: null,
    })
    expect(rows[0]?.id).toMatch(/[0-9a-f-]{36}/)
    expect(rows[0]?.createdAt).toBeInstanceOf(Date)
  })

  it('is idempotent on stripeEventId — a redelivered anomaly does not stack', async () => {
    const repo = new InMemoryPaymentAnomalyRepository()
    await repo.record(newAnomaly())
    await repo.record(newAnomaly()) // same stripeEventId 'evt_1'
    expect(await repo.listUnresolved()).toHaveLength(1)
  })

  it('records distinct events as separate anomalies', async () => {
    const repo = new InMemoryPaymentAnomalyRepository()
    await repo.record(newAnomaly({ stripeEventId: 'evt_1' }))
    await repo.record(newAnomaly({ stripeEventId: 'evt_2', stripeCheckoutSessionId: 'cs_2' }))
    expect(await repo.listUnresolved()).toHaveLength(2)
  })

  it('excludes already-resolved anomalies from listUnresolved', async () => {
    const resolved: PaymentAnomaly = {
      id: 'an-resolved',
      operatorId: 'op-1',
      bookingId: 'bk-9',
      kind: 'DOUBLE_PAYMENT',
      stripeEventId: 'evt_resolved',
      stripeCheckoutSessionId: 'cs_resolved',
      stripePaymentIntentId: 'pi_resolved',
      receivedAmountJpy: 50_000,
      expectedAmountJpy: 50_000,
      currency: 'jpy',
      resolvedAt: new Date('2026-06-10T00:00:00Z'),
      resolution: 'REFUNDED_EXTERNALLY',
      resolvedBy: 'admin-1',
      note: null,
      createdAt: new Date('2026-06-09T00:00:00Z'),
    }
    const repo = new InMemoryPaymentAnomalyRepository(new Map([[resolved.id, resolved]]))
    await repo.record(newAnomaly({ stripeEventId: 'evt_new' }))

    const rows = await repo.listUnresolved()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.stripeEventId).toBe('evt_new')
  })
})
