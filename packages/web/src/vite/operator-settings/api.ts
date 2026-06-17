import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { UpdateOperatorInput } from '@kuruma/shared/validators/operator'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// #903: operator profile & business settings. Cookie-based and operator-scoped
// server-side — the client resolves its OWN operator by id (from the session's
// operatorId) and never names a foreign tenant. The write threads the session
// CSRF token (mirrors operator-fees/operator-insurance).

export type { UpdateOperatorInput }

/**
 * The settings projection the API returns from GET and PATCH `/operators/:id`
 * (the deliberate `{ id, name, slug, preAuthHandoffUrl }` shape — no timestamps).
 * The API projects reads and writes through one shape (#903), so GET and PATCH
 * agree. Pinned with `satisfies` so a field drift fails to compile here; the
 * schema stays non-strict as defence in depth against an unexpected extra column.
 */
export interface OperatorProfile {
  id: string
  name: string
  slug: string
  preAuthHandoffUrl: string | null
}

const operatorProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  preAuthHandoffUrl: z.string().nullable(),
}) satisfies z.ZodType<OperatorProfile>

export const operatorProfileQueryKey = (operatorId: string) =>
  ['operator-profile', operatorId] as const

async function fetchOperatorProfile(operatorId: string): Promise<OperatorProfile> {
  const res = await fetch(`${getApiBaseUrl()}/operators/${encodeURIComponent(operatorId)}`, {
    credentials: 'include',
  })
  return unwrap(res, operatorProfileSchema)
}

export function operatorProfileQueryOptions(operatorId: string) {
  return queryOptions({
    queryKey: operatorProfileQueryKey(operatorId),
    queryFn: () => fetchOperatorProfile(operatorId),
  })
}

// Cookie-authed PATCH — CSRF-gated, so the session token rides in the header.
export async function updateOperatorProfile(
  operatorId: string,
  input: UpdateOperatorInput,
  csrfToken: string,
): Promise<OperatorProfile> {
  const res = await fetch(`${getApiBaseUrl()}/operators/${encodeURIComponent(operatorId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(input),
  })
  return unwrap(res, operatorProfileSchema)
}
