import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { type WithOperatorId, buildScopeParam } from '@/vite/operator-context'
import type { SaveOperatorTermsDraftInput } from '@kuruma/shared/validators/consent-documents'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Operator rental-terms authoring client (Slice A). Mirrors operator-insurance:
// the Vite shell owns this cookie-based client, lists are operator-scoped
// server-side via the session cookie, and every mutation threads the session
// csrfToken (the global CSRF guard rejects a cookie-authed write without it).

// JSON-serialized OperatorTermsVersion — the service's Dates arrive as ISO strings.
const operatorTermsVersionSchema = z.object({
  version: z.string(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  effectiveFrom: z.string(),
  publishedAt: z.string().nullable(),
  locales: z.array(z.string()),
  title: z.string(),
  body: z.string(),
  acceptanceLabel: z.string(),
})
export type OperatorTermsVersionData = z.infer<typeof operatorTermsVersionSchema>

export const OPERATOR_TERMS_QUERY_KEY = ['operator-terms'] as const

export async function fetchOperatorTerms(
  pickedOperatorId?: string,
): Promise<OperatorTermsVersionData[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/operator-terms?${buildScopeParam(pickedOperatorId)}`,
    {
      credentials: 'include',
    },
  )
  return unwrap(res, operatorTermsVersionSchema.array())
}

export function operatorTermsQueryOptions(pickedOperatorId?: string) {
  return queryOptions({
    queryKey: [...OPERATOR_TERMS_QUERY_KEY, pickedOperatorId ?? 'all'] as const,
    queryFn: () => fetchOperatorTerms(pickedOperatorId),
  })
}

// --- Mutations (cookie-based, CSRF-gated) ------------------------------------

// A write scoped to a picked tenant carries `?operatorId=`; an operator session
// omits it (auto-scoped server-side). NOT buildScopeParam — that emits
// `includeAll=true` on no-pick, which is a read default and wrong for a write.
function operatorQuery(pickedOperatorId?: string): string {
  return pickedOperatorId ? `?operatorId=${encodeURIComponent(pickedOperatorId)}` : ''
}

async function writeJson(
  path: string,
  method: 'POST' | 'DELETE',
  body: unknown,
  csrfToken: string,
): Promise<OperatorTermsVersionData> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return unwrap(res, operatorTermsVersionSchema)
}

// A platform admin acting as a picked tenant names the operator in the body (the
// platform-admin schema allows it); an operator session omits it, auto-scoped.
export async function saveOperatorTermsDraft(
  input: WithOperatorId<SaveOperatorTermsDraftInput>,
  csrfToken: string,
): Promise<OperatorTermsVersionData> {
  return writeJson('/operator-terms', 'POST', input, csrfToken)
}

export async function publishOperatorTermsVersion(
  version: string,
  csrfToken: string,
  pickedOperatorId?: string,
): Promise<OperatorTermsVersionData> {
  return writeJson(
    `/operator-terms/${encodeURIComponent(version)}/publish${operatorQuery(pickedOperatorId)}`,
    'POST',
    {},
    csrfToken,
  )
}

export async function archiveOperatorTermsVersion(
  version: string,
  csrfToken: string,
  pickedOperatorId?: string,
): Promise<OperatorTermsVersionData> {
  return writeJson(
    `/operator-terms/${encodeURIComponent(version)}${operatorQuery(pickedOperatorId)}`,
    'DELETE',
    {},
    csrfToken,
  )
}
