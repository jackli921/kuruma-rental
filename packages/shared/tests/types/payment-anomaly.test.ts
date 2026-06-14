import { describe, expect, it } from 'vitest'
import { paymentAnomalyKindEnum } from '../../src/db/schema'
import { PAYMENT_ANOMALY_KINDS, type PaymentAnomalyView } from '../../src/types/payment-anomaly'

describe('PaymentAnomalyView contract', () => {
  // Drift fence: the web-facing kind union must stay identical to the DB enum
  // (payment_anomaly_kind). Web cannot import the schema, so this is the only
  // place the two are pinned together — mirrors the roleEnum guard in schema.test.ts.
  it('PAYMENT_ANOMALY_KINDS mirrors the payment_anomaly_kind DB enum (order matters)', () => {
    expect([...PAYMENT_ANOMALY_KINDS]).toEqual([...paymentAnomalyKindEnum.enumValues])
  })

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
    }
    expect(view.receivedAmountJpy).toBeNull()
    expect(view.stripePaymentIntentId).toBeNull()
  })
})
