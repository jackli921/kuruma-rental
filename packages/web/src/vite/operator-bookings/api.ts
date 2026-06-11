import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'

// #512: operator booking view. The Vite shell owns these DTOs (it never imports
// the frozen Next module's copy) so it stays self-contained and process.env-free.
// Namespaced under `operator-bookings` to stay clear of the renter `vite/bookings`
// client (#511) — the two features evolve independently and must not collide.
//
// The list endpoint is operator-scoped server-side via the session cookie
// (CallerContext in the repo layer), so this client passes NO operatorId — a
// cross-tenant read is impossible from here by construction.

export type OperatorBookingStatus = 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'

/** A booking row as the operator view needs it. Dates are ISO strings (JSON). */
export interface OperatorBookingRow {
  id: string
  bookingCode: string
  status: OperatorBookingStatus
  startAt: string
  endAt: string
  totalPrice: number | null
  // The fulfilling car (#392 — `vehicleId` is gone). Vehicle NAME resolution is a
  // slice-B decision (combined expand vs. a second fetch); the id is always here.
  assignedVehicleId: string
  renter: { id: string; name: string | null; email: string | null } | null
}

/** The JSON shape of one `GET /bookings?expand=renter` item we read. */
interface RawOperatorBooking {
  id: string
  bookingCode: string
  status: OperatorBookingStatus
  startAt: string
  endAt: string
  totalPrice: number | null
  assignedVehicleId: string
  renter?: { id: string; name: string | null; email: string | null; language: string } | undefined
}

export interface OperatorBookingFilters {
  status?: OperatorBookingStatus
  limit?: number
}

function toRow(b: RawOperatorBooking): OperatorBookingRow {
  return {
    id: b.id,
    bookingCode: b.bookingCode,
    status: b.status,
    startAt: b.startAt,
    endAt: b.endAt,
    totalPrice: b.totalPrice,
    assignedVehicleId: b.assignedVehicleId,
    renter: b.renter ? { id: b.renter.id, name: b.renter.name, email: b.renter.email } : null,
  }
}

export async function fetchOperatorBookings(
  filters: OperatorBookingFilters = {},
): Promise<OperatorBookingRow[]> {
  const sp = new URLSearchParams({ expand: 'renter' })
  if (filters.status) sp.set('status', filters.status)
  if (filters.limit) sp.set('limit', String(filters.limit))

  const res = await fetch(`${getApiBaseUrl()}/bookings?${sp.toString()}`, {
    credentials: 'include',
  })
  const data = await unwrap<RawOperatorBooking[]>(res)
  return data.map(toRow)
}
