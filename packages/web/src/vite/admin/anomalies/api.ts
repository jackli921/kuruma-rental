import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import {
  PAYMENT_ANOMALY_KINDS,
  type PaymentAnomaliesResponse,
  type PaymentAnomalyView,
} from '@kuruma/shared/types/payment-anomaly'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Platform-admin unresolved payment anomalies (#744), surfaced on the revenue tab
// (#462). Cookie-based (credentials: 'include') so the API gates on the session
// role server-side (requirePlatformRead = STAFF/ADMIN/PLATFORM_ADMIN); no params.
// Mirrors admin/revenue/api.ts.
export const PAYMENT_ANOMALIES_QUERY_KEY = ['admin-payment-anomalies'] as const

// Network-seam validator for the anomaly response (#711). Pinned to the shared
// wire DTO with `satisfies` so a renamed/added field — or a new anomaly `kind`
// the web can't render — fails typecheck here and surfaces as a ParseError at the
// seam instead of an `undefined`/unrenderable row deep in the admin revenue tab.
const paymentAnomalyViewSchema = z.object({
  id: z.string(),
  kind: z.enum(PAYMENT_ANOMALY_KINDS),
  operatorId: z.string(),
  bookingId: z.string(),
  receivedAmountJpy: z.number().nullable(),
  expectedAmountJpy: z.number().nullable(),
  currency: z.string().nullable(),
  stripeEventId: z.string(),
  stripePaymentIntentId: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<PaymentAnomalyView>

const paymentAnomaliesResponseSchema = z.object({
  anomalies: z.array(paymentAnomalyViewSchema),
}) satisfies z.ZodType<PaymentAnomaliesResponse>

export async function fetchPaymentAnomalies(): Promise<PaymentAnomaliesResponse> {
  const res = await fetch(`${getApiBaseUrl()}/admin/payment-anomalies`, {
    credentials: 'include',
  })
  return unwrap(res, paymentAnomaliesResponseSchema)
}

export function paymentAnomaliesQueryOptions() {
  return queryOptions({
    queryKey: PAYMENT_ANOMALIES_QUERY_KEY,
    queryFn: fetchPaymentAnomalies,
  })
}
