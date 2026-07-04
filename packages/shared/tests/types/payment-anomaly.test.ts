import { describe, expect, it } from 'vitest'
import type { PaymentAnomalyView } from '../../src/types/payment-anomaly'

// The kind/resolution unions are pinned to the DB enums (order included) by the
// #688 SSoT loop in enums.test.ts and the db-drift CI job; this file only guards
// the PaymentAnomalyView wire shape the API returns and the web consumes.
describe('PaymentAnomalyView contract', () => {
  it('a DOUBLE_PAYMENT view carries the refund/reconcile identifiers', () => {
    const view: PaymentAnomalyView = {
      id: 'pa_1',
      kind: 'DOUBLE_PAYMENT',
      bookingId: 'bk_1',
      operatorId: 'op_1',
      receivedAmountJpy: 12000,
      expectedAmountJpy: 12000,
      currency: 'jpy',
      stripeEventId: 'evt_1',
      stripePaymentIntentId: 'pi_1',
      createdAt: '2026-06-13T03:00:00.000Z',
      resolvedAt: null,
      resolution: null,
      note: null,
    }
    expect(view.kind).toBe('DOUBLE_PAYMENT')
    expect(view.stripePaymentIntentId).toBe('pi_1')
  })

  it('an AMOUNT_MISMATCH view allows null amounts/intent (malformed Stripe event)', () => {
    const view: PaymentAnomalyView = {
      id: 'pa_2',
      kind: 'AMOUNT_MISMATCH',
      bookingId: 'bk_2',
      operatorId: 'op_2',
      receivedAmountJpy: null,
      expectedAmountJpy: 12000,
      currency: null,
      stripeEventId: 'evt_2',
      stripePaymentIntentId: null,
      createdAt: '2026-06-13T03:00:00.000Z',
      resolvedAt: '2026-06-14T05:00:00.000Z',
      resolution: 'REFUNDED_EXTERNALLY',
      note: 'duplicate refunded in Stripe dashboard',
    }
    expect(view.receivedAmountJpy).toBeNull()
    expect(view.stripePaymentIntentId).toBeNull()
  })
})
