import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { CONSENT_TYPES } from '@kuruma/shared/enums'
import type {
  ConsentAcceptanceListItem,
  ConsentGovernanceFilters,
  ConsentGovernanceResponse,
} from '@kuruma/shared/types/consent-governance'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Platform-admin consent-acceptance governance browse (#1091, epic #1075 slice 5).
// Cookie-based (credentials: 'include') so the API gates on the session role
// server-side (requirePlatformAdmin); v1 is a read-only ledger browse + filter.

// Network-seam validators (#711). Pinned to the shared wire DTO with `satisfies`
// so a renamed/added field fails typecheck here; a drifted runtime body (e.g. a
// version arriving as a number) then surfaces as a ParseError at the seam instead
// of a wrong/blank cell on the table. Enum domain anchors to the shared SSoT.
const consentAcceptanceSchema = z.object({
  acceptanceId: z.string(),
  userId: z.string(),
  consentType: z.enum(CONSENT_TYPES),
  version: z.string(),
  acceptedAt: z.string(),
  operatorId: z.string().nullable(),
  bookingId: z.string().nullable(),
}) satisfies z.ZodType<ConsentAcceptanceListItem>

// Exported for the network-seam drift test (#711) — the parse is the contract.
export const consentGovernanceResponseSchema = z.object({
  acceptances: z.array(consentAcceptanceSchema),
}) satisfies z.ZodType<ConsentGovernanceResponse>

export const ADMIN_CONSENT_QUERY_KEY = ['admin-consent', 'acceptances'] as const

function toQueryString(filters: ConsentGovernanceFilters): string {
  const params = new URLSearchParams()
  if (filters.userId) params.set('userId', filters.userId)
  if (filters.consentType) params.set('consentType', filters.consentType)
  if (filters.version) params.set('version', filters.version)
  if (filters.acceptedFrom) params.set('acceptedFrom', filters.acceptedFrom)
  if (filters.acceptedTo) params.set('acceptedTo', filters.acceptedTo)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export async function fetchConsentAcceptances(
  filters: ConsentGovernanceFilters = {},
): Promise<ConsentGovernanceResponse> {
  const res = await fetch(`${getApiBaseUrl()}/admin/consent/acceptances${toQueryString(filters)}`, {
    credentials: 'include',
  })
  return unwrap(res, consentGovernanceResponseSchema)
}

export function consentAcceptancesQueryOptions(filters: ConsentGovernanceFilters = {}) {
  return queryOptions({
    queryKey: [...ADMIN_CONSENT_QUERY_KEY, filters],
    queryFn: () => fetchConsentAcceptances(filters),
  })
}

/** Same-origin-aware link to the existing platform-admin evidence export (#877).
 *  Carries the /api base so it hits the Hono API, not the SPA origin; cookie-authed. */
export function consentEvidenceUrl(acceptanceId: string): string {
  return `${getApiBaseUrl()}/admin/consent/acceptances/${encodeURIComponent(acceptanceId)}/evidence`
}
