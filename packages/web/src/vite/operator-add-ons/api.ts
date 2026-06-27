import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { type WithOperatorId, buildScopeParam } from '@/vite/operator-context'
import { ADD_ON_STATUSES } from '@kuruma/shared/enums'
import type { AddOnData } from '@kuruma/shared/types/add-on'
import type { CreateAddOnInput, UpdateAddOnInput } from '@kuruma/shared/validators/add-on'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// #585: operator add-on management. Mirrors the #530 insurance client — the Vite
// shell owns this cookie-based client and never imports a hono-client/Bearer copy.
// The list is operator-scoped server-side via the session cookie (CallerContext),
// so this client passes NO operatorId; a cross-tenant read is impossible here.
// `includeAll=true` does NOT widen an operator's read (they auto-scope and ignore
// it) — it only satisfies the bypass-role 400 guard for PLATFORM_ADMIN / legacy
// STAFF/ADMIN sessions (the #529 lesson). Canonical write types come from
// @kuruma/shared so the form stays in lockstep with the Zod validators.

export type { CreateAddOnInput, UpdateAddOnInput }

// JSON-serialized AddOn — dates arrive as ISO strings. Pinned to the shared wire
// DTO with `satisfies` (#847) so a producer-side field drift fails to compile
// here, not silently as a runtime ParseError. The API row type is fenced to the
// same DTO in api `wire-contract.test.ts`, closing the seam at both ends.
const addOnSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceJpy: z.number(),
  status: z.enum(ADD_ON_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<AddOnData>
export type { AddOnData }

export const ADDON_QUERY_KEY = ['operator-add-ons'] as const

// Management always lists archived rows too (badged in the UI). The scope param
// is `operatorId=<picked>` when an admin has picked a tenant, else `includeAll=true`
// (the bypass-role read default; an operator session ignores it and auto-scopes).
export async function fetchAddOns(pickedOperatorId?: string): Promise<AddOnData[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/add-ons?includeArchived=true&${buildScopeParam(pickedOperatorId)}`,
    { credentials: 'include' },
  )
  return unwrap(res, addOnSchema.array())
}

// The picked operator id is part of the cache key so switching context refetches
// (and never serves another tenant's cached list). Optional param keeps any
// no-arg caller working.
export function addOnsQueryOptions(pickedOperatorId?: string) {
  return queryOptions({
    queryKey: [...ADDON_QUERY_KEY, pickedOperatorId ?? 'all'] as const,
    queryFn: () => fetchAddOns(pickedOperatorId),
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
): Promise<AddOnData> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return unwrap(res, addOnSchema)
}

// A platform admin operating as a picked tenant must name the target operator in
// the body (platformAdminCreateAddOnSchema requires it); an operator session omits
// it and is auto-scoped server-side. PATCH/DELETE are id-scoped and never carry it.
export async function createAddOn(
  input: WithOperatorId<CreateAddOnInput>,
  csrfToken: string,
): Promise<AddOnData> {
  return writeJson('/add-ons', 'POST', input, csrfToken)
}

export async function updateAddOn(
  id: string,
  input: UpdateAddOnInput,
  csrfToken: string,
): Promise<AddOnData> {
  return writeJson(`/add-ons/${encodeURIComponent(id)}`, 'PATCH', input, csrfToken)
}

// Soft-archive (DELETE flips status to ARCHIVED). No body — the CSRF header still
// rides along because a cookie-authed DELETE is a mutation the guard protects.
export async function archiveAddOn(id: string, csrfToken: string): Promise<AddOnData> {
  const res = await fetch(`${getApiBaseUrl()}/add-ons/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  return unwrap(res, addOnSchema)
}
