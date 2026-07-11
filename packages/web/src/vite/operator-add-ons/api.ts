import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { type WithOperatorId, buildScopeParam } from '@/vite/operator-context'
import { ADD_ON_STATUSES } from '@kuruma/shared/enums'
import { DEFAULT_LOCALE, type Locale } from '@kuruma/shared/i18n/locales'
import {
  localizedTextOverrideSchema,
  localizedTextSchema,
} from '@kuruma/shared/i18n/localized-text'
import type { OperatorAddOnData } from '@kuruma/shared/types/add-on'
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
//
// Catalog i18n (slice 2): the server resolves the picked template name/description
// to `?locale=`, so every read threads the caller locale and keys the cache by it
// (a /zh read must not serve a cached /en label).

export type { CreateAddOnInput, UpdateAddOnInput, OperatorAddOnData }

// The wire DTO the operator add-on routes return. Pinned to the shared type with
// `satisfies` (#847) so a producer-side field drift fails to compile here, not
// silently as a runtime ParseError. The API row type is fenced to the same DTO in
// api `wire-contract.test.ts`, closing the seam at both ends.
const addOnSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  templateId: z.string().nullable(),
  resolvedName: z.string(),
  resolvedDescription: z.string().nullable(),
  descriptionOverride: localizedTextOverrideSchema.nullable(),
  // Self-authored name bundle (#1437), raw so the edit form can add ja/zh later (D5);
  // null for a picked or legacy row.
  nameI18n: localizedTextSchema.nullable(),
  priceJpy: z.number(),
  status: z.enum(ADD_ON_STATUSES),
}) satisfies z.ZodType<OperatorAddOnData>

export const ADDON_QUERY_KEY = ['operator-add-ons'] as const

// Management always lists archived rows too (badged in the UI). The scope param
// is `operatorId=<picked>` when an admin has picked a tenant, else `includeAll=true`
// (the bypass-role read default; an operator session ignores it and auto-scopes).
export async function fetchAddOns(
  pickedOperatorId?: string,
  locale?: Locale,
): Promise<OperatorAddOnData[]> {
  const localeParam = locale ? `&locale=${locale}` : ''
  const res = await fetch(
    `${getApiBaseUrl()}/add-ons?includeArchived=true&${buildScopeParam(pickedOperatorId)}${localeParam}`,
    { credentials: 'include' },
  )
  return unwrap(res, addOnSchema.array())
}

// The picked operator id AND the locale are part of the cache key so switching
// context or language refetches (and never serves another tenant's or another
// locale's cached list). Optional params keep any no-arg caller working.
export function addOnsQueryOptions(pickedOperatorId?: string, locale?: Locale) {
  const resolvedLocale = locale ?? DEFAULT_LOCALE
  return queryOptions({
    queryKey: [...ADDON_QUERY_KEY, pickedOperatorId ?? 'all', resolvedLocale] as const,
    queryFn: () => fetchAddOns(pickedOperatorId, resolvedLocale),
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
): Promise<OperatorAddOnData> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return unwrap(res, addOnSchema)
}

// #1456 (operatorId) + #1318 (locale): compose the write query. `?operatorId=` binds
// a picker admin's PATCH/DELETE; `?locale=` tells the server the Model-B source locale
// (and resolves the write response to the operator's UI locale).
function writeQuery(pickedOperatorId?: string, locale?: Locale): string {
  const params = new URLSearchParams()
  if (pickedOperatorId) params.set('operatorId', pickedOperatorId)
  if (locale) params.set('locale', locale)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

// A platform admin operating as a picked tenant must name the target operator in
// the body (platformAdminCreateAddOnSchema requires it); an operator session omits
// it and is auto-scoped server-side.
export async function createAddOn(
  input: WithOperatorId<CreateAddOnInput>,
  csrfToken: string,
  locale?: Locale,
): Promise<OperatorAddOnData> {
  return writeJson(`/add-ons${writeQuery(undefined, locale)}`, 'POST', input, csrfToken)
}

export async function updateAddOn(
  id: string,
  input: UpdateAddOnInput,
  csrfToken: string,
  pickedOperatorId?: string,
  locale?: Locale,
): Promise<OperatorAddOnData> {
  const path = `/add-ons/${encodeURIComponent(id)}${writeQuery(pickedOperatorId, locale)}`
  return writeJson(path, 'PATCH', input, csrfToken)
}

// Soft-archive (DELETE flips status to ARCHIVED). No body — the CSRF header still
// rides along because a cookie-authed DELETE is a mutation the guard protects.
// Archive doesn't touch descriptions so no locale param needed.
export async function archiveAddOn(
  id: string,
  csrfToken: string,
  pickedOperatorId?: string,
): Promise<OperatorAddOnData> {
  const path = `/add-ons/${encodeURIComponent(id)}${writeQuery(pickedOperatorId)}`
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  return unwrap(res, addOnSchema)
}
