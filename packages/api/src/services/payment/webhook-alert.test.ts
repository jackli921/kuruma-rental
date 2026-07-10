import { describe, expect, it } from 'vitest'
import type { WebhookResult } from './payment'
import { paymentWebhookStrandedAlert } from './webhook-alert'

const base = (over: Partial<WebhookResult>): WebhookResult => ({
  status: 200,
  outcome: 'ignored',
  ...over,
})

describe('paymentWebhookStrandedAlert', () => {
  it('alerts when an amount-mismatch auto-refund FAILED (funds stranded)', () => {
    expect(
      paymentWebhookStrandedAlert(base({ outcome: 'amount_mismatch', refund: 'failed' })),
    ).toBe(
      'amount-mismatch auto-refund did not complete (failed) — captured funds may be stranded and need manual reconciliation',
    )
  })

  it('alerts when the mismatched charge is unrefundable', () => {
    expect(
      paymentWebhookStrandedAlert(base({ outcome: 'amount_mismatch', refund: 'unrefundable' })),
    ).toBe(
      'amount-mismatch auto-refund did not complete (unrefundable) — captured funds may be stranded and need manual reconciliation',
    )
  })

  it('is silent when the mismatch auto-refund completed or is pending', () => {
    expect(
      paymentWebhookStrandedAlert(base({ outcome: 'amount_mismatch', refund: 'refunded' })),
    ).toBeNull()
    expect(
      paymentWebhookStrandedAlert(base({ outcome: 'amount_mismatch', refund: 'pending' })),
    ).toBeNull()
  })

  it('alerts on a double payment (recorded but never auto-refunded)', () => {
    expect(paymentWebhookStrandedAlert(base({ outcome: 'double_payment' }))).toBe(
      'double charge recorded but NOT auto-refunded — the duplicate charge needs a manual refund',
    )
  })

  it('is silent for benign outcomes', () => {
    expect(paymentWebhookStrandedAlert(base({ outcome: 'ignored' }))).toBeNull()
    expect(paymentWebhookStrandedAlert(base({ outcome: 'recorded' }))).toBeNull()
    expect(
      paymentWebhookStrandedAlert(base({ outcome: 'invalid_signature', status: 400 })),
    ).toBeNull()
  })
})
