import { describe, expect, it } from 'vitest'
import { paymentAnomalyKindEnum, paymentAnomalyResolutionEnum } from '../../src/db/schema'
import {
  PAYMENT_ANOMALY_KINDS,
  PAYMENT_ANOMALY_RESOLUTIONS,
  type PaymentAnomalyView,
} from '../../src/types/payment-anomaly'

describe('PaymentAnomalyView contract', () => {
  // Drift fence: the web-facing kind union must stay identical to the DB enum
  // (payment_anomaly_kind). Web cannot import the schema, so this is the only
  // place the two are pinned together — mirrors the roleEnum guard in schema.test.ts.
  it('PAYMENT_ANOMALY_KINDS mirrors the payment_anomaly_kind DB enum (order matters)', () => {
    expect([...PAYMENT_ANOMALY_KINDS]).toEqual([...paymentAnomalyKindEnum.enumValues])
  })

  it('PAYMENT_ANOMALY_RESOLUTIONS mirrors the payment_anomaly_resolution DB enum (order matters)', () => {
    expect([...PAYMENT_ANOMALY_RESOLUTIONS]).toEqual([...paymentAnomalyResolutionEnum.enumValues])
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
