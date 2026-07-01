import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { OPERATOR_ROLES, type OperatorRole } from '@kuruma/shared/enums'
import { createOperatorSchema, updateOperatorSchema } from '@kuruma/shared/validators/operator'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

/**
 * Web-side data layer for the platform-admin operator directory (#1088, epic
 * #1075 slice 2). Backs `GET /admin/operators` plus the create / mint-invite /
 * edit / deactivate / reactivate writes. Mirrors `admin/anomalies/api.ts`: raw
 * fetch + cookie auth + `X-CSRF-Token`, request bodies validated against the
 * shared zod schemas, responses validated at the seam via `unwrap`.
 *
 * The wire row uses string dates: the API's `OperatorAdminRow` carries `Date`
 * columns, but `c.json` serialises them to ISO strings. `OperatorAdminRow` lives
 * in `packages/api` (web must not import it), so the wire shape is defined here
 * and the seam validation turns any field drift into a clean `ParseError`.
 */
export const OPERATORS_QUERY_KEY = ['admin-operators'] as const

export const operatorAdminRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  deactivatedAt: z.string().nullable(),
  createdAt: z.string(),
  fleetCount: z.number(),
})

export type OperatorAdminRow = z.infer<typeof operatorAdminRowSchema>

const operatorsResponseSchema = z.array(operatorAdminRowSchema)

// The create / edit / deactivate / reactivate writes each return a different
// operator projection (Operator, OperatorProfile, OperatorStatus), but the UI
// discards the body and refetches. Validate the identity fields all three share
// so seam drift (a renamed/missing id|name|slug) still fails loudly (#711/#784);
// Zod strips the per-projection extras (deactivatedAt, preAuthHandoffUrl, ...).
export const operatorWriteAckSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
})

// Returned once by `POST /admin/provider-invites`: the plaintext token + its
// shareable link (only the sha256 hash is persisted server-side, never the token).
export const createdInviteSchema = z.object({
  token: z.string(),
  inviteUrl: z.string(),
  expiresAt: z.string(),
})

export type CreatedInvite = z.infer<typeof createdInviteSchema>

export async function fetchOperators(): Promise<OperatorAdminRow[]> {
  const res = await fetch(`${getApiBaseUrl()}/admin/operators`, { credentials: 'include' })
  return unwrap(res, operatorsResponseSchema)
}

export function operatorsQueryOptions() {
  return queryOptions({
    queryKey: OPERATORS_QUERY_KEY,
    queryFn: fetchOperators,
  })
}

// Per-operator metrics & compliance roll-up (#1120), backing `GET
// /admin/operators/:id/summary`. The wire shape mirrors the API's
// `OperatorComplianceSummary` (lives in @kuruma/shared, but validated here at the
// seam so a renamed/removed figure fails loudly rather than rendering NaN).
export const operatorSummarySchema = z.object({
  operatorId: z.string(),
  name: z.string(),
  vehicleCount: z.number(),
  vehiclesNeedingDocs: z.number(),
  vehiclesExpiringSoon: z.number(),
  totalBookings: z.number(),
  upcomingBookings: z.number(),
  lastComplianceAlertAt: z.string().nullable(),
})

export type OperatorSummary = z.infer<typeof operatorSummarySchema>

export const operatorSummaryQueryKey = (id: string) => ['admin-operator-summary', id] as const

export async function fetchOperatorSummary(id: string): Promise<OperatorSummary> {
  const res = await fetch(`${getApiBaseUrl()}/admin/operators/${encodeURIComponent(id)}/summary`, {
    credentials: 'include',
  })
  return unwrap(res, operatorSummarySchema)
}

export function operatorSummaryQueryOptions(id: string) {
  return queryOptions({
    queryKey: operatorSummaryQueryKey(id),
    queryFn: () => fetchOperatorSummary(id),
  })
}

function jsonHeaders(csrfToken: string): HeadersInit {
  return { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
}

export async function createOperator(params: {
  name: string
  preAuthHandoffUrl?: string
  csrfToken: string
}): Promise<void> {
  const { csrfToken, ...input } = params
  const body = createOperatorSchema.parse(input)
  const res = await fetch(`${getApiBaseUrl()}/admin/operators`, {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders(csrfToken),
    body: JSON.stringify(body),
  })
  await unwrap(res, operatorWriteAckSchema)
}

export async function editOperator(params: {
  id: string
  name?: string
  preAuthHandoffUrl?: string | null
  csrfToken: string
}): Promise<void> {
  const { id, csrfToken, ...patch } = params
  const body = updateOperatorSchema.parse(patch)
  const res = await fetch(`${getApiBaseUrl()}/operators/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: jsonHeaders(csrfToken),
    body: JSON.stringify(body),
  })
  await unwrap(res, operatorWriteAckSchema)
}

export async function mintProviderInvite(params: {
  email: string
  operatorId: string
  role: OperatorRole
  csrfToken: string
}): Promise<CreatedInvite> {
  const { csrfToken, ...input } = params
  const res = await fetch(`${getApiBaseUrl()}/admin/provider-invites`, {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders(csrfToken),
    body: JSON.stringify(input),
  })
  return unwrap(res, createdInviteSchema)
}

async function toggleOperatorActive(
  id: string,
  action: 'deactivate' | 'reactivate',
  csrfToken: string,
): Promise<void> {
  const res = await fetch(
    `${getApiBaseUrl()}/admin/operators/${encodeURIComponent(id)}/${action}`,
    { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrfToken } },
  )
  await unwrap(res, operatorWriteAckSchema)
}

export const deactivateOperator = (params: { id: string; csrfToken: string }) =>
  toggleOperatorActive(params.id, 'deactivate', params.csrfToken)

export const reactivateOperator = (params: { id: string; csrfToken: string }) =>
  toggleOperatorActive(params.id, 'reactivate', params.csrfToken)

export const PROVIDER_INVITE_ROLES = OPERATOR_ROLES
