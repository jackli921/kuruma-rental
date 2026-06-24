import type { CallerContext } from '../middleware/auth'
import type {
  BookingEventRepository,
  BookingFilters,
  BookingRepository,
  OperatorRepository,
  UserRepository,
  VehicleRepository,
} from '../repositories/types'
import type { Booking, BookingEvent } from '../stores'

/** Renter-safe operator projection attached to a single booking read (§4h). */
export type BookingWithOperator = Booking & {
  operator?: { name: string; preAuthHandoffUrl: string | null }
}

/**
 * Read/list side of the booking domain (#713 split of the BookingService
 * god-class). Owns the 8 query methods and their projection enrichment; holds
 * no creation or lifecycle logic. All repos are injected (the composition root
 * shares the same instances across the query/creation/lifecycle services).
 */
export class BookingQueryService {
  constructor(
    private readonly bookingRepo: BookingRepository,
    private readonly vehicleRepo?: VehicleRepository,
    private readonly userRepo?: UserRepository,
    // §4h: reads the renter-safe operator projection for findById. Unscoped repo
    // read — the booking is already tenant-checked, and only name + handoff URL
    // are exposed, so no cross-tenant leak.
    private readonly operatorRepo?: OperatorRepository,
    // #549: read side of the append-only lifecycle log, surfaced to the operator
    // trip-detail timeline via findEvents. Distinct from the transactional
    // bookingEventRepo used for appends inside runInTransaction.
    private readonly bookingEventRepo?: BookingEventRepository,
  ) {}

  async findAll(ctx: CallerContext, filters?: BookingFilters): Promise<Booking[]> {
    return this.bookingRepo.findAll(ctx, filters)
  }

  async findAllPaginated(
    ctx: CallerContext,
    filters: BookingFilters,
  ): Promise<{ data: Booking[]; nextCursor: string | null }> {
    const limit = filters.limit ?? 20
    // Overfetch by 1 to detect if more pages exist
    const rows = await this.bookingRepo.findAll(ctx, { ...filters, limit: limit + 1 })
    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows
    const last = data[data.length - 1]
    const nextCursor = hasMore && last ? `${last.createdAt.toISOString()}_${last.id}` : null
    return { data, nextCursor }
  }

  async findAllWithVehiclesPaginated(
    ctx: CallerContext,
    filters: BookingFilters,
  ): Promise<{
    data: (Booking & { vehicle?: { name: string; photos: string[] } | undefined })[]
    nextCursor: string | null
  }> {
    const { data, nextCursor } = await this.findAllPaginated(ctx, filters)
    if (!this.vehicleRepo) return { data, nextCursor }

    // The fulfilling car is the assigned vehicle (#392 — vehicleId is gone).
    // #464: CLASS_COMBO floats have no assigned car (null) — exclude them from
    // the vehicle lookup; their `vehicle` field stays undefined.
    const vehicleIds = [
      ...new Set(data.map((b) => b.assignedVehicleId).filter((id) => id !== null)),
    ]
    const vehicleList = await this.vehicleRepo.findByIds(ctx, vehicleIds)
    const vehicleMap = new Map(vehicleList.map((v) => [v.id, { name: v.name, photos: v.photos }]))

    return {
      data: data.map((booking) => ({
        ...booking,
        vehicle: booking.assignedVehicleId ? vehicleMap.get(booking.assignedVehicleId) : undefined,
      })),
      nextCursor,
    }
  }

  async findAllWithRentersPaginated(
    ctx: CallerContext,
    filters: BookingFilters,
  ): Promise<{
    data: (Booking & {
      renter?:
        | { id: string; name: string | null; email: string | null; language: string }
        | undefined
    })[]
    nextCursor: string | null
  }> {
    const { data, nextCursor } = await this.findAllPaginated(ctx, filters)
    if (!this.userRepo) return { data, nextCursor }

    const renterIds = [...new Set(data.map((b) => b.renterId))]
    const userList = await this.userRepo.findByIds(renterIds)
    const userMap = new Map(
      userList.map((u) => [u.id, { id: u.id, name: u.name, email: u.email, language: u.language }]),
    )

    return {
      data: data.map((booking) => ({
        ...booking,
        renter: userMap.get(booking.renterId),
      })),
      nextCursor,
    }
  }

  async findAllWithVehiclesAndRentersPaginated(
    ctx: CallerContext,
    filters: BookingFilters,
  ): Promise<{
    data: (Booking & {
      vehicle?: { name: string; photos: string[] } | undefined
      renter?:
        | { id: string; name: string | null; email: string | null; language: string }
        | undefined
    })[]
    nextCursor: string | null
  }> {
    const { data, nextCursor } = await this.findAllPaginated(ctx, filters)

    // #464: CLASS_COMBO floats have no assigned car (null) — exclude them from
    // the vehicle lookup; their `vehicle` field stays undefined.
    const vehicleIds = [
      ...new Set(data.map((b) => b.assignedVehicleId).filter((id) => id !== null)),
    ]
    const vehicleList = this.vehicleRepo ? await this.vehicleRepo.findByIds(ctx, vehicleIds) : []
    const vehicleMap = new Map(vehicleList.map((v) => [v.id, { name: v.name, photos: v.photos }]))

    const renterIds = [...new Set(data.map((b) => b.renterId))]
    const userList = this.userRepo ? await this.userRepo.findByIds(renterIds) : []
    const renterMap = new Map(
      userList.map((u) => [u.id, { id: u.id, name: u.name, email: u.email, language: u.language }]),
    )

    return {
      data: data.map((booking) => ({
        ...booking,
        vehicle: booking.assignedVehicleId ? vehicleMap.get(booking.assignedVehicleId) : undefined,
        renter: renterMap.get(booking.renterId),
      })),
      nextCursor,
    }
  }

  async findById(ctx: CallerContext, id: string): Promise<BookingWithOperator | undefined> {
    const booking = await this.bookingRepo.findById(ctx, id)
    if (!booking || !this.operatorRepo) return booking
    // The renter already owns this booking (scope enforced above); exposing their
    // operator's public handoff URL + name leaks nothing cross-tenant (§4h).
    const operator = await this.operatorRepo.findById(booking.operatorId)
    if (!operator) return booking
    return {
      ...booking,
      operator: { name: operator.name, preAuthHandoffUrl: operator.preAuthHandoffUrl },
    }
  }

  /**
   * #549: single-read enrichment for the deep-linked trip-detail page. ENRICHES
   * the findById result (booking + renter-safe operator projection, §4h) with
   * the assigned vehicle + renter — it never replaces the operator block. Mirrors
   * the list endpoint's `expand=vehicle,renter` projection shape.
   */
  async findByIdWithVehicleAndRenter(
    ctx: CallerContext,
    id: string,
  ): Promise<
    | (BookingWithOperator & {
        vehicle?: { name: string; photos: string[] } | undefined
        renter?:
          | { id: string; name: string | null; email: string | null; language: string }
          | undefined
      })
    | undefined
  > {
    const booking = await this.findById(ctx, id)
    if (!booking) return booking

    const [vehicle] =
      this.vehicleRepo && booking.assignedVehicleId
        ? await this.vehicleRepo.findByIds(ctx, [booking.assignedVehicleId])
        : []
    const [renter] = this.userRepo ? await this.userRepo.findByIds([booking.renterId]) : []

    return {
      ...booking,
      vehicle: vehicle ? { name: vehicle.name, photos: vehicle.photos } : undefined,
      renter: renter
        ? { id: renter.id, name: renter.name, email: renter.email, language: renter.language }
        : undefined,
    }
  }

  /**
   * #549: the operator trip-detail timeline. Authorize via findById first — its
   * tenant read-scope means operator A reading operator B's booking gets
   * `undefined` (→ 404, no leak), not just an empty list. Returns the events in
   * the repository's deterministic order (createdAt asc, id tiebreaker).
   */
  async findEvents(ctx: CallerContext, id: string): Promise<BookingEvent[] | undefined> {
    const booking = await this.findById(ctx, id)
    if (!booking) return undefined
    if (!this.bookingEventRepo) return []
    return this.bookingEventRepo.findByBookingId(ctx, id)
  }
}
