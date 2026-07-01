import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { type WithOperatorId, buildScopeParam } from '@/vite/operator-context'
import { INSURANCE_STATUSES } from '@kuruma/shared/enums'
import type { InsuranceOptionData } from '@kuruma/shared/types/insurance-option'
import type {
  CreateInsuranceOptionInput,
  UpdateInsuranceOptionInput,
} from '@kuruma/shared/validators/insurance-option'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// #530: operator insurance-option management. Mirrors the operator-fleet read
// projection — the Vite shell owns this cookie-based client and never imports
// the frozen Next module's `modules/insurance/api.ts` (hono-client + Bearer).
// The list is operator-scoped server-side via the session cookie (CallerContext),
// so this client passes NO operatorId; a cross-tenant read is impossible here.
// Canonical write types come from @kuruma/shared so the form stays in lockstep
// with the Zod validators rather than drifting a parallel copy.

export type { CreateInsuranceOptionInput, UpdateInsuranceOptionInput }

// JSON-serialized InsuranceOption — dates arrive as ISO strings. Pinned to the
// shared wire DTO with `satisfies` (#847) so a producer-side field drift fails to
// compile here, not silently as a runtime ParseError. The API row type is fenced
// to the same DTO in api `wire-contract.test.ts`, closing the seam at both ends.
const insuranceOptionSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  dailyPriceJpy: z.number(),
  // null = full cover (no deductible).
  deductibleJpy: z.number().nullable(),
  status: z.enum(INSURANCE_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<InsuranceOptionData>
export type { InsuranceOptionData }

export const INSURANCE_QUERY_KEY = ['operator-insurance'] as const

// Management always lists archived rows too (badged + restorable in the UI). The
// scope param is `operatorId=<picked>` when an admin has picked a tenant, else
// `includeAll=true` — the bypass-role read default that satisfies the API's
// cross-operator guard (this is what clears the admin 400; the parameterless read
// previously sent neither flag). An operator session ignores it and auto-scopes.
export async function fetchInsuranceOptions(
  pickedOperatorId?: string,
): Promise<InsuranceOptionData[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/insurance-options?includeArchived=true&${buildScopeParam(pickedOperatorId)}`,
    { credentials: 'include' },
  )
  return unwrap(res, insuranceOptionSchema.array())
}

// The picked operator id is part of the cache key so switching context refetches
// (and never serves another tenant's cached list). Optional param keeps any
// no-arg caller working.
export function insuranceOptionsQueryOptions(pickedOperatorId?: string) {
  return queryOptions({
    queryKey: [...INSURANCE_QUERY_KEY, pickedOperatorId ?? 'all'] as const,
    queryFn: () => fetchInsuranceOptions(pickedOperatorId),
  })
}

// --- Mutations (cookie-based, CSRF-gated) ------------------------------------
// The global csrf() middleware rejects any cookie-authenticated mutation that
// omits a matching X-CSRF-Token (middleware/csrf.ts), so every write threads the
// session's csrfToken. (This is why operator-fleet's bare writeJson is unsafe to
// copy for writes — it omits the header.) Each unwraps ok() and throws ApiError
// on failure so a useMutation onError can surface it.

async function writeJson(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  csrfToken: string,
): Promise<InsuranceOptionData> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return unwrap(res, insuranceOptionSchema)
}

// A platform admin operating as a picked tenant must name the target operator in
// the body (the platform-admin create schema requires it); an operator session omits
// it and is auto-scoped server-side. PATCH/DELETE are id-scoped and never carry it.
export async function createInsuranceOption(
  input: WithOperatorId<CreateInsuranceOptionInput>,
  csrfToken: string,
): Promise<InsuranceOptionData> {
  return writeJson('/insurance-options', 'POST', input, csrfToken)
}

export async function updateInsuranceOption(
  id: string,
  input: UpdateInsuranceOptionInput,
  csrfToken: string,
): Promise<InsuranceOptionData> {
  return writeJson(`/insurance-options/${encodeURIComponent(id)}`, 'PATCH', input, csrfToken)
}

// Soft-archive (DELETE flips status to ARCHIVED). No body — the CSRF header still
// rides along because a cookie-authed DELETE is a mutation the guard protects.
export async function archiveInsuranceOption(
  id: string,
  csrfToken: string,
): Promise<InsuranceOptionData> {
  const res = await fetch(`${getApiBaseUrl()}/insurance-options/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  return unwrap(res, insuranceOptionSchema)
}
