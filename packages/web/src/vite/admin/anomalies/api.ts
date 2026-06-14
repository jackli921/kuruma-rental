import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { PaymentAnomaliesResponse } from '@kuruma/shared/types/payment-anomaly'
import { queryOptions } from '@tanstack/react-query'

// Platform-admin unresolved payment anomalies (#744), surfaced on the revenue tab
// (#462). Cookie-based (credentials: 'include') so the API gates on the session
// role server-side (requirePlatformRead = STAFF/ADMIN/PLATFORM_ADMIN); no params.
// Mirrors admin/revenue/api.ts.
export const PAYMENT_ANOMALIES_QUERY_KEY = ['admin-payment-anomalies'] as const

export async function fetchPaymentAnomalies(): Promise<PaymentAnomaliesResponse> {
  const res = await fetch(`${getApiBaseUrl()}/admin/payment-anomalies`, {
    credentials: 'include',
  })
  return unwrap<PaymentAnomaliesResponse>(res)
}

export function paymentAnomaliesQueryOptions() {
  return queryOptions({
    queryKey: PAYMENT_ANOMALIES_QUERY_KEY,
    queryFn: fetchPaymentAnomalies,
  })
}
