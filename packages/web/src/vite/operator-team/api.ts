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
// server-side — the client names NO operatorId, so a cross-tenant read/write is
// impossible by construction (the API derives the tenant from the session). The
// invite POST threads the session CSRF token (global double-submit guard).

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

export const TEAM_INVITES_QUERY_KEY = ['operator-team', 'invites'] as const
export const TEAM_MEMBERS_QUERY_KEY = ['operator-team', 'members'] as const

export async function fetchTeamInvites(): Promise<OperatorInviteData[]> {
  const res = await fetch(`${getApiBaseUrl()}/operators/me/invites`, { credentials: 'include' })
  return unwrap(res, inviteSchema.array())
}

export async function fetchTeamMembers(): Promise<OperatorMemberData[]> {
  const res = await fetch(`${getApiBaseUrl()}/operators/me/members`, { credentials: 'include' })
  return unwrap(res, memberSchema.array())
}

export function teamInvitesQueryOptions() {
  return queryOptions({ queryKey: TEAM_INVITES_QUERY_KEY, queryFn: fetchTeamInvites })
}

export function teamMembersQueryOptions() {
  return queryOptions({ queryKey: TEAM_MEMBERS_QUERY_KEY, queryFn: fetchTeamMembers })
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
): Promise<CreatedInviteResult> {
  const res = await fetch(`${getApiBaseUrl()}/operators/me/invites`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(input),
  })
  return unwrap(res, createdInviteSchema)
}

// Owner-only writes. Both are cookie-authed POSTs (CSRF double-submit) to
// `/operators/me/*` id paths — the API derives the tenant from the session, so
// the client never names an operatorId. unwrap throws an ApiError carrying the
// server message (404 for an unknown/foreign id, 409 for the last owner) so the
// confirm dialog can render it. The body { id } is discarded — callers refetch.
export async function revokeInvite(id: string, csrfToken: string): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/operators/me/invites/${id}/revoke`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  await unwrap(res)
}

export async function deactivateMember(id: string, csrfToken: string): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/operators/me/members/${id}/deactivate`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  await unwrap(res)
}
