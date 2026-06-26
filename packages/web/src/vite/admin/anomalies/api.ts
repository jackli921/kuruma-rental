import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import {
  PAYMENT_ANOMALY_KINDS,
  PAYMENT_ANOMALY_RESOLUTIONS,
  type PaymentAnomaliesResponse,
  type PaymentAnomalyResolution,
  type PaymentAnomalyView,
} from '@kuruma/shared/types/payment-anomaly'
import { resolvePaymentAnomalySchema } from '@kuruma/shared/validators/payment-anomaly'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Platform-admin payment anomalies (#744 list; resolution UI #1075 slice 3). Cookie-
// based (credentials: 'include') so the API gates on the session role server-side
// (requirePlatformRead to list, requirePlatformAdmin to resolve). Mirrors admin/documents/api.ts.
export const PAYMENT_ANOMALIES_QUERY_KEY = ['admin-payment-anomalies'] as const

export type PaymentAnomalyStatusFilter = 'resolved' | 'unresolved'

// Network-seam validator for the anomaly response (#711). Pinned to the shared
// wire DTO with `satisfies` so a renamed/added field — or a new anomaly `kind` or
// `resolution` the web can't render — fails typecheck here and surfaces as a
// ParseError at the seam instead of an `undefined`/unrenderable row in the admin UI.
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
  resolvedAt: z.string().nullable(),
  resolution: z.enum(PAYMENT_ANOMALY_RESOLUTIONS).nullable(),
  note: z.string().nullable(),
}) satisfies z.ZodType<PaymentAnomalyView>

const paymentAnomaliesResponseSchema = z.object({
  anomalies: z.array(paymentAnomalyViewSchema),
}) satisfies z.ZodType<PaymentAnomaliesResponse>

const resolveResponseSchema = z.object({ anomaly: paymentAnomalyViewSchema })

export async function fetchPaymentAnomalies(
  status: PaymentAnomalyStatusFilter = 'unresolved',
): Promise<PaymentAnomaliesResponse> {
  const res = await fetch(`${getApiBaseUrl()}/admin/payment-anomalies?status=${status}`, {
    credentials: 'include',
  })
  return unwrap(res, paymentAnomaliesResponseSchema)
}

export function paymentAnomaliesQueryOptions(status: PaymentAnomalyStatusFilter = 'unresolved') {
  return queryOptions({
    queryKey: [...PAYMENT_ANOMALIES_QUERY_KEY, status],
    queryFn: () => fetchPaymentAnomalies(status),
  })
}

// Close an anomaly's review-queue item (#1075 slice 3). Cookie-authed + CSRF-gated,
// so the caller echoes the session CSRF token in the header — NEVER the body. The
// payload is validated against the shared `.strict()` schema before the network
// call, so a drifted/invalid form fails fast and offline. v1 moves NO money.
export async function resolvePaymentAnomaly(params: {
  id: string
  resolution: PaymentAnomalyResolution
  note?: string
  csrfToken: string
}): Promise<PaymentAnomalyView> {
  const { id, csrfToken, ...verdict } = params
  const body = resolvePaymentAnomalySchema.parse(verdict)
  const res = await fetch(
    `${getApiBaseUrl()}/admin/payment-anomalies/${encodeURIComponent(id)}/resolve`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(body),
    },
  )
  const data = await unwrap(res, resolveResponseSchema)
  return data.anomaly
}
