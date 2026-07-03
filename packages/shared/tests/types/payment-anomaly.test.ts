import { describe, expect, it } from 'vitest'
import type { PaymentAnomalyView } from '../../src/types/payment-anomaly'

describe('PaymentAnomalyView contract', () => {
  // The payment_anomaly_kind / _resolution value sets are pinned to literals in
  // enums.test.ts (the SSoT they now derive from), and enums.ts -> migration drift
  // is caught by db:verify / the db-drift CI job. This file guards only the
  // web-facing PaymentAnomalyView JSON shape (ISO-string dates, nullable amounts).
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
