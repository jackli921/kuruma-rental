import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// `GET /operators` — the picker's option source (#407). Bypass roles see all
// operators; the leaner `{id,name,slug}` summary is the collection shape.
const operatorSummarySchema = z.object({ id: z.string(), name: z.string(), slug: z.string() })
export type OperatorSummary = z.infer<typeof operatorSummarySchema>

export const OPERATORS_QUERY_KEY = ['operator-context', 'operators'] as const

export async function fetchOperators(): Promise<OperatorSummary[]> {
  const res = await fetch(`${getApiBaseUrl()}/operators`, { credentials: 'include' })
  return unwrap(res, operatorSummarySchema.array())
}

export function operatorsQueryOptions() {
  return queryOptions({ queryKey: OPERATORS_QUERY_KEY, queryFn: fetchOperators })
}
