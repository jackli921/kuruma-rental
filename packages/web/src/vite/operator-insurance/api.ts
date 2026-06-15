import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
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

// Management always lists archived rows too (badged + restorable in the UI), so
// the fetch is parameterless and the query key stays stable for invalidation.
export async function fetchInsuranceOptions(): Promise<InsuranceOptionData[]> {
  const res = await fetch(`${getApiBaseUrl()}/insurance-options?includeArchived=true`, {
    credentials: 'include',
  })
  return unwrap(res, insuranceOptionSchema.array())
}

export function insuranceOptionsQueryOptions() {
  return queryOptions({
    queryKey: INSURANCE_QUERY_KEY,
    queryFn: fetchInsuranceOptions,
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

export async function createInsuranceOption(
  input: CreateInsuranceOptionInput,
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
