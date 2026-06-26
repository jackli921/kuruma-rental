import { ApiError, ParseError } from '@/lib/api-error'
import {
  PAYMENT_ANOMALIES_QUERY_KEY,
  fetchPaymentAnomalies,
  paymentAnomaliesQueryOptions,
  resolvePaymentAnomaly,
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
  resolvedAt: null,
  resolution: null,
  note: null,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchPaymentAnomalies', () => {
  it('GETs the status-scoped endpoint with cookie credentials and unwraps the anomalies', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { anomalies: [anomaly] } }))

    const result = await fetchPaymentAnomalies('resolved')

    expect(result.anomalies).toHaveLength(1)
    expect(result.anomalies[0]?.stripeEventId).toBe('evt_1')
    const [url, init] = spy.mock.calls[0] ?? []
    expect(String(url)).toMatch(/\/admin\/payment-anomalies\?status=resolved$/)
    expect(init?.credentials).toBe('include')
  })

  it('defaults to the unresolved review queue when no status is given', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { anomalies: [] } }))
    await fetchPaymentAnomalies()
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/\?status=unresolved$/)
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

  it('throws a ParseError when a row carries an out-of-domain resolution (#1075 slice 3)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ success: true, data: { anomalies: [{ ...anomaly, resolution: 'WAT' }] } }),
    )
    await expect(fetchPaymentAnomalies('resolved')).rejects.toBeInstanceOf(ParseError)
  })
})

describe('paymentAnomaliesQueryOptions', () => {
  it('keys the cache by status so the resolved and unresolved tabs cache separately', () => {
    expect(PAYMENT_ANOMALIES_QUERY_KEY).toEqual(['admin-payment-anomalies'])
    expect(paymentAnomaliesQueryOptions().queryKey).toEqual([
      ...PAYMENT_ANOMALIES_QUERY_KEY,
      'unresolved',
    ])
    expect(paymentAnomaliesQueryOptions('resolved').queryKey).toEqual([
      ...PAYMENT_ANOMALIES_QUERY_KEY,
      'resolved',
    ])
  })
})

describe('resolvePaymentAnomaly', () => {
  it('POSTs the resolution with the CSRF header and no csrfToken in the body', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          anomaly: {
            ...anomaly,
            resolution: 'REFUNDED_EXTERNALLY',
            resolvedAt: '2026-06-11T00:00:00.000Z',
          },
        },
      }),
    )

    await resolvePaymentAnomaly({
      id: 'pa_1',
      resolution: 'REFUNDED_EXTERNALLY',
      note: 'refunded in Stripe',
      csrfToken: 'csrf-1',
    })

    const [url, init] = spy.mock.calls[0] ?? []
    expect(String(url)).toMatch(/\/admin\/payment-anomalies\/pa_1\/resolve$/)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'csrf-1',
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      resolution: 'REFUNDED_EXTERNALLY',
      note: 'refunded in Stripe',
    })
  })

  it('omits an absent note from the body and never leaks the csrfToken into it', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { anomaly } }))

    await resolvePaymentAnomaly({ id: 'pa_1', resolution: 'BENIGN', csrfToken: 'csrf-1' })

    expect(JSON.parse(String(spy.mock.calls[0]?.[1]?.body))).toEqual({ resolution: 'BENIGN' })
  })

  it('refuses an out-of-domain resolution — never hits the network (.strict seam)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    await expect(
      // @ts-expect-error — a drifted resolution must not typecheck nor reach fetch.
      resolvePaymentAnomaly({ id: 'pa_1', resolution: 'WHATEVER', csrfToken: 'csrf-1' }),
    ).rejects.toThrow()
    expect(spy).not.toHaveBeenCalled()
  })
})
