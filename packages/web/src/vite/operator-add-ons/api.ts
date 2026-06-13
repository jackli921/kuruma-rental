import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { CreateAddOnInput, UpdateAddOnInput } from '@kuruma/shared/validators/add-on'
import { queryOptions } from '@tanstack/react-query'

// #585: operator add-on management. Mirrors the #530 insurance client — the Vite
// shell owns this cookie-based client and never imports a hono-client/Bearer copy.
// The list is operator-scoped server-side via the session cookie (CallerContext),
// so this client passes NO operatorId; a cross-tenant read is impossible here.
// `includeAll=true` does NOT widen an operator's read (they auto-scope and ignore
// it) — it only satisfies the bypass-role 400 guard for PLATFORM_ADMIN / legacy
// STAFF/ADMIN sessions (the #529 lesson). Canonical write types come from
// @kuruma/shared so the form stays in lockstep with the Zod validators.

export type { CreateAddOnInput, UpdateAddOnInput }

/** JSON-serialized AddOn — dates arrive as ISO strings from the API. */
export interface AddOnData {
  id: string
  operatorId: string
  name: string
  description: string | null
  priceJpy: number
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
}

export const ADDON_QUERY_KEY = ['operator-add-ons'] as const

// Management always lists archived rows too (badged in the UI); `includeAll=true`
// rides along for bypass-role sessions. Parameterless so the query key stays
// stable for invalidation.
export async function fetchAddOns(): Promise<AddOnData[]> {
  const res = await fetch(`${getApiBaseUrl()}/add-ons?includeArchived=true&includeAll=true`, {
    credentials: 'include',
  })
  return unwrap<AddOnData[]>(res)
}

export function addOnsQueryOptions() {
  return queryOptions({
    queryKey: ADDON_QUERY_KEY,
    queryFn: fetchAddOns,
  })
}

// --- Mutations (cookie-based, CSRF-gated) ------------------------------------
// The global csrf() middleware rejects any cookie-authenticated mutation that
// omits a matching X-CSRF-Token (middleware/csrf.ts), so every write threads the
// session's csrfToken. (This is why operator-fleet's bare writeJson is unsafe to
// copy for writes — it omits the header.) Each unwraps ok() and throws ApiError
// on failure so a useMutation onError can surface it.

async function writeJson<T>(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  csrfToken: string,
): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return unwrap<T>(res)
}

export async function createAddOn(input: CreateAddOnInput, csrfToken: string): Promise<AddOnData> {
  return writeJson<AddOnData>('/add-ons', 'POST', input, csrfToken)
}

export async function updateAddOn(
  id: string,
  input: UpdateAddOnInput,
  csrfToken: string,
): Promise<AddOnData> {
  return writeJson<AddOnData>(`/add-ons/${encodeURIComponent(id)}`, 'PATCH', input, csrfToken)
}

// Soft-archive (DELETE flips status to ARCHIVED). No body — the CSRF header still
// rides along because a cookie-authed DELETE is a mutation the guard protects.
export async function archiveAddOn(id: string, csrfToken: string): Promise<AddOnData> {
  const res = await fetch(`${getApiBaseUrl()}/add-ons/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  return unwrap<AddOnData>(res)
}
