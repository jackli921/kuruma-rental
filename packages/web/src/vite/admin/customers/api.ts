import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { BOOKING_STATUSES } from '@kuruma/shared/enums'
import type {
  Customer,
  CustomerBookingSummary,
  CustomerSort,
  CustomerWithBookings,
} from '@kuruma/shared/types/customer'
import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Platform-admin customer directory (#1090, epic #1075). Wires the existing
// PLATFORM_ADMIN-only customers API (`routes/customers.ts`): GET /customers
// (cursor-paginated, search + sort) and GET /customers/:id (cross-operator
// booking history). Cookie-based (`credentials: 'include'`) so the API gates on
// the session role server-side — the page layer's `adminGuard` is UX only.

export type { CustomerSort } from '@kuruma/shared/types/customer'

export const ADMIN_CUSTOMERS_QUERY_KEY = ['admin-customers'] as const

// Default page size — small enough to demo cursor pagination on the seed data.
const DEFAULT_LIMIT = 20

// Network-seam validators (#711) pinned to the shared customer DTOs via
// `satisfies z.ZodType<...>`: the shared interface stays the single source of the
// shape, while a renamed/dropped field fails typecheck HERE and a drifted runtime
// body (e.g. `bookingCount` arriving as a string) surfaces as a ParseError at the
// seam instead of a wrong/blank cell on the directory. The booking-status domain
// anchors to the `@kuruma/shared/enums` SSoT so it can't drift from the DB pgEnum.
const customerSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  language: z.string(),
  country: z.string().nullable(),
  bookingCount: z.number(),
  lastBookingAt: z.string(),
  totalSpent: z.number(),
}) satisfies z.ZodType<Customer>

const customerBookingSummarySchema = z.object({
  id: z.string(),
  vehicleId: z.string().nullable(),
  vehicleName: z.string().nullable(),
  startAt: z.string(),
  endAt: z.string(),
  status: z.enum(BOOKING_STATUSES),
  totalPrice: z.number().nullable(),
}) satisfies z.ZodType<CustomerBookingSummary>

const customerWithBookingsSchema = customerSchema.extend({
  bookings: z.array(customerBookingSummarySchema),
}) satisfies z.ZodType<CustomerWithBookings>

// `nextCursor` rides in the success envelope as a SIBLING of `data` (the API's
// `ok(c, data, 200, { nextCursor })`), not inside it. `.catch(null)` degrades a
// missing/garbage cursor to "no more pages" rather than throwing mid-pagination.
const nextCursorSchema = z.string().nullable().catch(null)

export interface CustomerListParams {
  search?: string | undefined
  sort?: CustomerSort | undefined
  cursor?: string | undefined
  limit?: number | undefined
}

export interface CustomerPage {
  readonly data: Customer[]
  readonly nextCursor: string | null
}

// One page of the directory. `unwrap()` returns only `data`, so we peek the
// sibling `nextCursor` off a `clone()` BEFORE unwrap consumes the body, then
// unwrap+validate the rows so the #711 seam still guards every cell. A failure
// envelope (401/403) still throws an ApiError from `unwrap` carrying the status.
export async function fetchCustomers(params: CustomerListParams = {}): Promise<CustomerPage> {
  const sp = new URLSearchParams()
  if (params.search) sp.set('search', params.search)
  if (params.sort) sp.set('sort', params.sort)
  if (params.cursor) sp.set('cursor', params.cursor)
  sp.set('limit', String(params.limit ?? DEFAULT_LIMIT))

  const res = await fetch(`${getApiBaseUrl()}/customers?${sp.toString()}`, {
    credentials: 'include',
  })
  const envelope = (await res
    .clone()
    .json()
    .catch(() => null)) as { nextCursor?: unknown } | null
  const data = await unwrap(res, customerSchema.array())
  return { data, nextCursor: nextCursorSchema.parse(envelope?.nextCursor ?? null) }
}

export function customersQueryOptions(params: CustomerListParams = {}) {
  return queryOptions({
    queryKey: [
      ...ADMIN_CUSTOMERS_QUERY_KEY,
      'list',
      params.search ?? null,
      params.sort ?? null,
      params.cursor ?? null,
    ],
    queryFn: () => fetchCustomers(params),
    // Hold the current page on screen while the next/searched page loads so the
    // table doesn't flash empty between cursor steps.
    placeholderData: keepPreviousData,
  })
}

// Cross-operator booking history for one customer. IDOR is a non-issue here (the
// route is PLATFORM_ADMIN-only), but a missing id still maps 404 -> null so a
// stale drawer open shows the empty state rather than faulting the page.
export async function fetchCustomerById(id: string): Promise<CustomerWithBookings | null> {
  const res = await fetch(`${getApiBaseUrl()}/customers/${encodeURIComponent(id)}`, {
    credentials: 'include',
  })
  if (res.status === 404) return null
  return unwrap(res, customerWithBookingsSchema)
}

export function customerByIdQueryOptions(id: string | null) {
  return queryOptions({
    queryKey: [...ADMIN_CUSTOMERS_QUERY_KEY, 'detail', id],
    queryFn: () => (id ? fetchCustomerById(id) : Promise.resolve(null)),
    enabled: id != null,
  })
}
