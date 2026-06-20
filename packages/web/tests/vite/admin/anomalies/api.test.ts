import { ApiError, ParseError } from '@/lib/api-error'
import {
  PAYMENT_ANOMALIES_QUERY_KEY,
  fetchPaymentAnomalies,
  paymentAnomaliesQueryOptions,
} from '@/vite/admin/anomalies/api'
import type { PaymentAnomalyView } from '@kuruma/shared/types/payment-anomaly'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

const anomaly: PaymentAnomalyView = {
  id: 'pa_1',
  kind: 'DOUBLE_PAYMENT',
  operatorId: 'op_1',
  bookingId: 'bk_1',
  receivedAmountJpy: 100_000,
  expectedAmountJpy: 100_000,
  currency: 'jpy',
  stripeEventId: 'evt_1',
  stripePaymentIntentId: 'pi_1',
  createdAt: '2026-06-10T03:00:00.000Z',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchPaymentAnomalies', () => {
  it('GETs /admin/payment-anomalies with cookie credentials and unwraps the anomalies', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { anomalies: [anomaly] } }))

    const result = await fetchPaymentAnomalies()

    expect(result.anomalies).toHaveLength(1)
    expect(result.anomalies[0]?.stripeEventId).toBe('evt_1')
    const [url, init] = spy.mock.calls[0] ?? []
    expect(String(url)).toMatch(/\/admin\/payment-anomalies$/)
    expect(init?.credentials).toBe('include')
  })

  it('throws an ApiError carrying the status when the API rejects (e.g. 403)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'Forbidden' }, 403),
    )
    const err = await fetchPaymentAnomalies().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(403)
    expect((err as ApiError).message).toBe('Forbidden')
  })

  it('throws a ParseError when the API adds an anomaly kind the web cannot render (#711)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { anomalies: [{ ...anomaly, kind: 'REFUND_PENDING' }] },
      }),
    )
    await expect(fetchPaymentAnomalies()).rejects.toBeInstanceOf(ParseError)
  })
})

describe('paymentAnomaliesQueryOptions', () => {
  it('carries the stable query key', () => {
    expect(paymentAnomaliesQueryOptions().queryKey).toEqual(PAYMENT_ANOMALIES_QUERY_KEY)
    expect(PAYMENT_ANOMALIES_QUERY_KEY).toEqual(['admin-payment-anomalies'])
  })
})
