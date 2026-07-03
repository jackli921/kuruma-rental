import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import {
  OPERATOR_MEMBERSHIP_STATUSES,
  OPERATOR_ROLES,
  PROVIDER_INVITE_STATUSES,
} from '@kuruma/shared/enums'
import type { OperatorInviteData, OperatorMemberData } from '@kuruma/shared/types/operator-team'
import type { InviteStaffInput } from '@kuruma/shared/validators/provider-invite'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// #904: operator self-service team page. Cookie-based and operator-scoped
// server-side — PLATFORM_ADMIN callers pass ?operatorId= to scope to a picked
// tenant; operator roles are scoped server-side from the session and ignore it.
// The invite POST threads the session CSRF token (global double-submit guard).

// Network-seam validators pinned to the shared DTOs with `satisfies` so a field
// drift fails to compile here, not silently at render.
const inviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(OPERATOR_ROLES),
  status: z.enum(PROVIDER_INVITE_STATUSES),
  expiresAt: z.string(),
  createdAt: z.string(),
}) satisfies z.ZodType<OperatorInviteData>

const memberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  role: z.enum(OPERATOR_ROLES),
  status: z.enum(OPERATOR_MEMBERSHIP_STATUSES),
  joinedAt: z.string(),
}) satisfies z.ZodType<OperatorMemberData>

// 2-element prefix kept as-is so dialogs can invalidate by prefix without
// knowing the operatorId. The query options append the id as a third element.
export const TEAM_INVITES_QUERY_KEY = ['operator-team', 'invites'] as const
export const TEAM_MEMBERS_QUERY_KEY = ['operator-team', 'members'] as const

// Scope every team call to the picked (or session) operator. Operator sessions
// send their own id (ignored server-side); a PLATFORM_ADMIN sends the picked one.
const operatorQuery = (operatorId: string): string =>
  `?operatorId=${encodeURIComponent(operatorId)}`

export async function fetchTeamInvites(operatorId: string): Promise<OperatorInviteData[]> {
  const res = await fetch(`${getApiBaseUrl()}/operators/me/invites${operatorQuery(operatorId)}`, {
    credentials: 'include',
  })
  return unwrap(res, inviteSchema.array())
}

export async function fetchTeamMembers(operatorId: string): Promise<OperatorMemberData[]> {
  const res = await fetch(`${getApiBaseUrl()}/operators/me/members${operatorQuery(operatorId)}`, {
    credentials: 'include',
  })
  return unwrap(res, memberSchema.array())
}

export function teamInvitesQueryOptions(operatorId: string) {
  return queryOptions({
    queryKey: [...TEAM_INVITES_QUERY_KEY, operatorId],
    queryFn: () => fetchTeamInvites(operatorId),
  })
}

export function teamMembersQueryOptions(operatorId: string) {
  return queryOptions({
    queryKey: [...TEAM_MEMBERS_QUERY_KEY, operatorId],
    queryFn: () => fetchTeamMembers(operatorId),
  })
}

/** The one-time invite reveal: the URL embeds the token (never persisted in
 *  cleartext), so the owner copies it to share. Mirrors the API response shape. */
export interface CreatedInviteResult {
  inviteUrl: string
  expiresAt: string
}

const createdInviteSchema = z.object({
  inviteUrl: z.string(),
  expiresAt: z.string(),
}) satisfies z.ZodType<CreatedInviteResult>

// Cookie-authed POST — CSRF-gated, so the session token rides in the header.
export async function inviteStaff(
  input: InviteStaffInput,
  csrfToken: string,
  operatorId: string,
): Promise<CreatedInviteResult> {
  const res = await fetch(`${getApiBaseUrl()}/operators/me/invites${operatorQuery(operatorId)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(input),
  })
  return unwrap(res, createdInviteSchema)
}

// Both owner-only writes echo the affected `{ id }`; callers discard it and
// refetch, but the seam is still validated (#711/#784 ratchet) so a contract
// drift fails here rather than passing silently.
const mutatedEntitySchema = z.object({ id: z.string() })

// Owner-only writes. Both are cookie-authed POSTs (CSRF double-submit) to
// `/operators/me/*` id paths. PLATFORM_ADMIN passes ?operatorId= to scope to
// the picked tenant; operator roles are scoped from the session server-side.
// unwrap throws an ApiError carrying the server message (404 for an
// unknown/foreign id, 409 for the last owner) so the confirm dialog can render it.
export async function revokeInvite(
  id: string,
  csrfToken: string,
  operatorId: string,
): Promise<void> {
  const res = await fetch(
    `${getApiBaseUrl()}/operators/me/invites/${id}/revoke${operatorQuery(operatorId)}`,
    { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrfToken } },
  )
  await unwrap(res, mutatedEntitySchema)
}

export async function deactivateMember(
  id: string,
  csrfToken: string,
  operatorId: string,
): Promise<void> {
  const res = await fetch(
    `${getApiBaseUrl()}/operators/me/members/${id}/deactivate${operatorQuery(operatorId)}`,
    { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrfToken } },
  )
  await unwrap(res, mutatedEntitySchema)
}
