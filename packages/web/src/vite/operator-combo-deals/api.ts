import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { type WithOperatorId, buildScopeParam } from '@/vite/operator-context'
import type { ClassRatePlanData } from '@kuruma/shared/types/class-rate-plan'
import type {
  CreateClassRatePlanInput,
  UpdateClassRatePlanInput,
} from '@kuruma/shared/validators/class-rate-plan'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// #464 slice 7: operator combo-deals (class rate plans) management. Mirrors the
// operator-fees data layer — cookie-based, operator-scoped server-side (the
// client passes no operatorId), writes thread the session CSRF token. Canonical
// write types come from @kuruma/shared so the form stays in lockstep with the
// Zod validators.

export type { CreateClassRatePlanInput, UpdateClassRatePlanInput }

// JSON-serialized ClassRatePlan — dates arrive as ISO strings. Pinned to the
// shared wire DTO with `satisfies` (#847) so a producer-side field drift fails to
// compile here, not silently as a runtime ParseError. The API row type is fenced
// to the same DTO in api `wire-contract.test.ts`, closing the seam at both ends.
const classRatePlanSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  classId: z.string(),
  pickupLocationId: z.string(),
  dayRateJpy: z.number(),
  isActive: z.boolean(),
  // Operator-only display name (Q3). Never surfaced to renters.
  label: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<ClassRatePlanData>
export type { ClassRatePlanData }

export const COMBO_QUERY_KEY = ['operator-combo-deals'] as const

// The scope param is `operatorId=<picked>` when an admin has picked a tenant,
// else `includeAll=true` (the bypass-role read default that an operator session
// ignores — it auto-scopes server-side). Mirrors the #529 fees/locations lesson:
// the bare read must send a scope param, else a PLATFORM_ADMIN's cross-operator
// read 400s.
export async function fetchComboDeals(pickedOperatorId?: string): Promise<ClassRatePlanData[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/class-rate-plans?${buildScopeParam(pickedOperatorId)}`,
    { credentials: 'include' },
  )
  return unwrap(res, classRatePlanSchema.array())
}

// The picked operator id is part of the cache key so switching context refetches
// (and never serves another tenant's cached list). Optional param keeps any
// no-arg caller working.
export function comboDealsQueryOptions(pickedOperatorId?: string) {
  return queryOptions({
    queryKey: [...COMBO_QUERY_KEY, pickedOperatorId ?? 'all'] as const,
    queryFn: () => fetchComboDeals(pickedOperatorId),
  })
}

// --- Mutations (cookie-based, CSRF-gated) ------------------------------------

async function writeJson(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  csrfToken: string,
): Promise<ClassRatePlanData> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return unwrap(res, classRatePlanSchema)
}

// A picker admin stamps the picked operatorId into the create BODY (the API
// requires it for a bypass caller); an operator session omits it (server ignores it).
export async function createComboDeal(
  input: WithOperatorId<CreateClassRatePlanInput>,
  csrfToken: string,
): Promise<ClassRatePlanData> {
  return writeJson('/class-rate-plans', 'POST', input, csrfToken)
}

// PATCH/DELETE bind to the picked operator via `?operatorId=` (the API 422s a
// bypass caller with no pick, 404s a wrong pick). An operator session omits it and
// is tenant-clamped server-side. Mirrors the fees module.
function operatorQuery(pickedOperatorId?: string): string {
  return pickedOperatorId ? `?operatorId=${encodeURIComponent(pickedOperatorId)}` : ''
}

export async function updateComboDeal(
  id: string,
  input: UpdateClassRatePlanInput,
  csrfToken: string,
  pickedOperatorId?: string,
): Promise<ClassRatePlanData> {
  const path = `/class-rate-plans/${encodeURIComponent(id)}${operatorQuery(pickedOperatorId)}`
  return writeJson(path, 'PATCH', input, csrfToken)
}

// HARD delete (Q: combos have no soft-archive — DELETE removes the row and
// returns the deleted plan). The CSRF header still rides along because a
// cookie-authed DELETE is a mutation the guard protects.
export async function removeComboDeal(
  id: string,
  csrfToken: string,
  pickedOperatorId?: string,
): Promise<ClassRatePlanData> {
  const path = `/class-rate-plans/${encodeURIComponent(id)}${operatorQuery(pickedOperatorId)}`
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  return unwrap(res, classRatePlanSchema)
}
