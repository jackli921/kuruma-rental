import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { BOOKING_STATUSES } from '@kuruma/shared/enums'
import type { AdminBookingDto, AdminBookingsResponse } from '@kuruma/shared/types/admin-booking'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Platform-admin cross-operator booking oversight (#1092). Cookie-based
// (credentials: 'include') so the API gates on the session role server-side
// (requirePlatformAdmin — PLATFORM_ADMIN only; PARTNER excluded). Filters ride as
// query params; an absent param means "any". Mirrors admin/revenue/api.ts.
export const ADMIN_BOOKINGS_QUERY_KEY = ['admin-bookings'] as const

/** The oversight filter shape carried in the URL search params + the API query. */
export interface AdminBookingFiltersInput {
  operatorId?: string
  bookingCode?: string
  customer?: string
  status?: string
  cursor?: string
}

// Network-seam validator for the admin booking row (#711). Pinned to the shared
// wire DTO with `satisfies` so a renamed/added/dropped field fails typecheck here
// and a drifted runtime body (e.g. a missing operatorName) surfaces as a
// ParseError at the seam instead of a blank cell deep in the oversight table.
const adminBookingDtoSchema = z.object({
  id: z.string(),
  bookingCode: z.string(),
  status: z.enum(BOOKING_STATUSES),
  operatorId: z.string(),
  operatorName: z.string(),
  renterId: z.string(),
  renterName: z.string().nullable(),
  renterEmail: z.string().nullable(),
  pickupLocationId: z.string(),
  dropoffLocationId: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  effectiveEndAt: z.string(),
  totalPrice: z.number().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<AdminBookingDto>

const adminBookingsResponseSchema = z.object({
  bookings: z.array(adminBookingDtoSchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<AdminBookingsResponse>

function buildQuery(filters: AdminBookingFiltersInput): string {
  const params = new URLSearchParams()
  if (filters.operatorId) params.set('operatorId', filters.operatorId)
  if (filters.bookingCode) params.set('bookingCode', filters.bookingCode)
  if (filters.customer) params.set('customer', filters.customer)
  if (filters.status) params.set('status', filters.status)
  if (filters.cursor) params.set('cursor', filters.cursor)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export async function fetchAdminBookings(
  filters: AdminBookingFiltersInput,
): Promise<AdminBookingsResponse> {
  const res = await fetch(`${getApiBaseUrl()}/admin/bookings${buildQuery(filters)}`, {
    credentials: 'include',
  })
  return unwrap(res, adminBookingsResponseSchema)
}

export function adminBookingsQueryOptions(filters: AdminBookingFiltersInput) {
  return queryOptions({
    queryKey: [...ADMIN_BOOKINGS_QUERY_KEY, filters],
    queryFn: () => fetchAdminBookings(filters),
  })
}
