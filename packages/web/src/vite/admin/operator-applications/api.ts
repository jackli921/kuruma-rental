import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import {
  OPERATOR_APPLICATION_BUSINESS_TYPES,
  OPERATOR_APPLICATION_FLEET_SIZES,
  OPERATOR_APPLICATION_STATUSES,
} from '@kuruma/shared/enums'
import { SUPPORTED_LOCALES } from '@kuruma/shared/i18n/locales'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Platform-admin operator-application review (#1277). The Vite shell owns this
// DTO — it does NOT import the api package's OperatorApplication interface (the
// api↔web boundary forbids reaching into the api package). Enum domains anchor
// to the @kuruma/shared/enums SSoT so the parse can't drift from the DB pgEnums.
// The schema is non-strict: the wire may carry server-only fields which it
// validates away so they never reach the client.
const operatorApplicationDtoSchema = z.object({
  id: z.string(),
  businessName: z.string(),
  contactName: z.string(),
  contactEmail: z.string(),
  contactPhone: z.string(),
  serviceArea: z.string(),
  estimatedFleetSize: z.enum(OPERATOR_APPLICATION_FLEET_SIZES),
  website: z.string().nullable(),
  businessLicenseNumber: z.string().nullable(),
  businessType: z.enum(OPERATOR_APPLICATION_BUSINESS_TYPES).nullable(),
  message: z.string().nullable(),
  submittedLocale: z.enum(SUPPORTED_LOCALES),
  status: z.enum(OPERATOR_APPLICATION_STATUSES),
  rejectionReason: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type OperatorApplicationDto = z.infer<typeof operatorApplicationDtoSchema>

export const ADMIN_OPERATOR_APPLICATIONS_QUERY_KEY = [
  'admin-operator-applications',
  'pending',
] as const

// The platform-staff pending-review queue. Cookie-authenticated; the server
// gates on the session role (PLATFORM_ADMIN). The LIST endpoint returns
// { success: true, data: [...rows] } — data is a bare array.
export async function fetchPendingOperatorApplications(): Promise<OperatorApplicationDto[]> {
  const res = await fetch(`${getApiBaseUrl()}/admin/operator-applications?status=PENDING`, {
    credentials: 'include',
  })
  return unwrap(res, z.array(operatorApplicationDtoSchema))
}

export function pendingOperatorApplicationsQueryOptions() {
  return queryOptions({
    queryKey: ADMIN_OPERATOR_APPLICATIONS_QUERY_KEY,
    queryFn: fetchPendingOperatorApplications,
  })
}

// The approve result DTO (#1277): operator provisioned + the one-time OWNER invite
// link to hand to the applicant. Non-strict — strips any server-only fields.
const approveResultDtoSchema = z.object({
  operatorId: z.string(),
  inviteUrl: z.string(),
  expiresAt: z.string(),
})
export type ApproveResultDto = z.infer<typeof approveResultDtoSchema>

// Approve a pending application (#1277). Cookie-authed + CSRF-gated (token in the
// header, never the body). No request body — approval takes no reviewer input.
// A 409 (already reviewed / email already an operator) surfaces as an ApiError
// with status 409 from unwrap, which the caller maps to an inline message.
export async function approveApplication(params: {
  id: string
  csrfToken: string
}): Promise<ApproveResultDto> {
  const { id, csrfToken } = params
  const res = await fetch(
    `${getApiBaseUrl()}/admin/operator-applications/${encodeURIComponent(id)}/approve`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    },
  )
  return unwrap(res, approveResultDtoSchema)
}

// The re-mint result DTO (#1370): just the fresh one-time OWNER invite link and
// its expiry — no operatorId (the operator already exists). Non-strict.
const remintResultDtoSchema = z.object({
  inviteUrl: z.string(),
  expiresAt: z.string(),
})
export type RemintResultDto = z.infer<typeof remintResultDtoSchema>

// Re-mint the OWNER invite for an already-approved application (#1370). The
// original link can expire or be lost before the applicant accepts; this issues a
// fresh one without a second approval. Cookie-authed + CSRF-gated (header, never
// body). No request body. A 404 (unknown id) / 409 (not approved / owner already
// onboarded) surfaces as an ApiError the caller maps to an inline message.
export async function remintInvite(params: {
  id: string
  csrfToken: string
}): Promise<RemintResultDto> {
  const { id, csrfToken } = params
  const res = await fetch(
    `${getApiBaseUrl()}/admin/operator-applications/${encodeURIComponent(id)}/remint-invite`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    },
  )
  return unwrap(res, remintResultDtoSchema)
}

// Record a rejection verdict (#1277). Cookie-authed + CSRF-gated, so the caller
// echoes the session CSRF token in the header — NEVER the body. The REJECT
// endpoint returns { success: true, data: {row} } — data is the row directly.
export async function rejectOperatorApplication(params: {
  id: string
  rejectionReason: string
  csrfToken: string
}): Promise<OperatorApplicationDto> {
  const { id, rejectionReason, csrfToken } = params
  const res = await fetch(
    `${getApiBaseUrl()}/admin/operator-applications/${encodeURIComponent(id)}/reject`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ rejectionReason }),
    },
  )
  return unwrap(res, operatorApplicationDtoSchema)
}
