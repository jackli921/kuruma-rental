import type { AdminBookingDto, AdminBookingsResponse } from '@kuruma/shared/types/admin-booking'
import { type CallerContext, requirePlatformAdmin } from '../middleware/auth'
import type {
  AdminBookingFilters,
  BookingRepository,
  OperatorRepository,
  UserRepository,
} from '../repositories/types'
import type { Booking, Operator, User } from '../stores'

/** Route-facing oversight filters (#1092). `customer` is a free-text name/email
 *  search the service resolves to renter ids; everything else maps straight onto
 *  {@link AdminBookingFilters}. All optional — absent means "any". */
export interface AdminBookingListInput {
  operatorId?: string
  bookingCode?: string
  customer?: string
  status?: string
  from?: Date
  to?: Date
  cursor?: string
  limit?: number
}

const DEFAULT_LIMIT = 20

/**
 * Platform-admin cross-operator booking oversight (#1092, epic #1075 slice 6).
 * Imperative shell: it gates the caller (`requirePlatformAdmin` — PLATFORM_ADMIN
 * only, PARTNER excluded), resolves a customer search to renter ids, reads the
 * UNSCOPED `findForAdmin`, then enriches each row with operator + renter identity
 * the renter DTO lacks. `requirePlatformAdmin` lives here (not only at the route)
 * so the gate travels with the business logic — `findForAdmin` is cross-operator,
 * so this service is the authz chokepoint (mirrors #462 revenue / #508 anomalies).
 */
export class AdminBookingService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly operators: OperatorRepository,
    private readonly users: UserRepository,
  ) {}

  async list(ctx: CallerContext, input: AdminBookingListInput): Promise<AdminBookingsResponse> {
    requirePlatformAdmin(ctx)

    const limit = input.limit ?? DEFAULT_LIMIT

    // A customer search resolves to a renter-id set FIRST. No match ⇒ no booking
    // can match, so we short-circuit before touching the bookings table.
    let renterIds: string[] | undefined
    if (input.customer) {
      const matches = await this.users.search(input.customer)
      if (matches.length === 0) return { bookings: [], nextCursor: null }
      renterIds = matches.map((u) => u.id)
    }

    const filters: AdminBookingFilters = { limit: limit + 1 } // overfetch by 1 to detect more
    if (input.operatorId) filters.operatorId = input.operatorId
    if (input.bookingCode) filters.bookingCode = input.bookingCode
    if (input.status) filters.status = input.status
    if (renterIds) filters.renterIds = renterIds
    if (input.from && input.to) {
      filters.from = input.from
      filters.to = input.to
    }
    if (input.cursor) filters.cursor = input.cursor

    const rows = await this.bookings.findForAdmin(filters)
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1]
    const nextCursor = hasMore && last ? `${last.createdAt.toISOString()}_${last.id}` : null

    const [operators, renters] = await Promise.all([
      this.operators.list(),
      this.users.findByIds([...new Set(page.map((b) => b.renterId))]),
    ])
    const operatorsById = new Map<string, Operator>(operators.map((o) => [o.id, o]))
    const rentersById = new Map<string, User>(renters.map((u) => [u.id, u]))

    return {
      bookings: page.map((b) => toAdminDto(b, operatorsById, rentersById)),
      nextCursor,
    }
  }
}

function toAdminDto(
  b: Booking,
  operatorsById: Map<string, Operator>,
  rentersById: Map<string, User>,
): AdminBookingDto {
  const operator = operatorsById.get(b.operatorId)
  const renter = rentersById.get(b.renterId)
  return {
    id: b.id,
    bookingCode: b.bookingCode,
    status: b.status,
    operatorId: b.operatorId,
    // A deleted/unknown operator falls back to its id so the row is never blank.
    operatorName: operator?.name ?? b.operatorId,
    renterId: b.renterId,
    renterName: renter?.name ?? null,
    renterEmail: renter?.email ?? null,
    pickupLocationId: b.pickupLocationId,
    dropoffLocationId: b.dropoffLocationId,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    effectiveEndAt: b.effectiveEndAt.toISOString(),
    totalPrice: b.totalPrice,
    createdAt: b.createdAt.toISOString(),
  }
}
