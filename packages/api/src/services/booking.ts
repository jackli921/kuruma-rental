import type { BookingStatus } from '@kuruma/shared/db/schema'
import { generateBookingCode } from '../lib/booking-code'
import type { CallerContext } from '../middleware/auth'
import type {
  BookingEventRepository,
  BookingFilters,
  BookingRepository,
  OperatorRepository,
  RunInTransaction,
  UserRepository,
  VehicleClassRepository,
  VehicleRepository,
} from '../repositories/types'
import type { Booking, BookingEvent, Vehicle } from '../stores'
import { BookingCreationService } from './booking-creation'
import { BookingLifecycleService } from './booking-lifecycle'
import type { BookingPostCommitDispatcher } from './booking-post-commit-dispatcher'
import { BookingQueryService, type BookingWithOperator } from './booking-query'
import type {
  BookingVerificationGate,
  CancelResult,
  CreateBookingInput,
  CreateBookingResult,
  StatusTransitionResult,
  SubstituteResult,
} from './booking-types'

// Re-exported for import compatibility — `services/booking` stays the booking
// domain's public entry point after the #713 split into three single-purpose
// services (query / creation / lifecycle).
export type { BookingWithOperator } from './booking-query'
export type {
  BookingVerificationGate,
  CancelResult,
  CreateBookingInput,
  CreateBookingResult,
  StatusTransitionResult,
  SubstituteResult,
} from './booking-types'
export { DISCLAIMER_TERMS_VERSION } from './booking-creation'

/**
 * Composite facade over the three booking services (#713). It owns NO logic:
 * it wires the injected repos into a query, a creation, and a lifecycle service
 * — all sharing the same repository instances — and delegates every public
 * method. Routes and tests keep a single `BookingService` dependency; the
 * responsibilities now live in `booking-query.ts`, `booking-creation.ts`, and
 * `booking-lifecycle.ts`, each a single-responsibility unit under the size cap.
 *
 * Opt-in messaging hook: when a post-commit dispatcher is supplied, every
 * confirmed/changed booking also creates a thread + notifications AFTER commit;
 * a failure there never rolls the booking back.
 */
export class BookingService {
  private readonly query: BookingQueryService
  private readonly creation: BookingCreationService
  private readonly lifecycle: BookingLifecycleService

  constructor(
    bookingRepo: BookingRepository,
    runInTransaction: RunInTransaction,
    vehicleRepo?: VehicleRepository,
    userRepo?: UserRepository,
    vehicleClassRepo?: VehicleClassRepository,
    // Single post-commit seam (#393, TODO #300): ensureThread + notifications,
    // each caught-and-logged. Shared by the creation and lifecycle services.
    postCommit?: BookingPostCommitDispatcher,
    // §4h: reads the renter-safe operator projection for findById.
    operatorRepo?: OperatorRepository,
    // #549: read side of the append-only lifecycle log (findEvents).
    bookingEventRepo?: BookingEventRepository,
    // Injectable so the collision-retry path is deterministically testable.
    generateCode: () => string = generateBookingCode,
    // #459: optional document-verification gate, wired only when the
    // REQUIRE_DOCUMENT_VERIFICATION flag is on (see index.ts composition root).
    verificationGate?: BookingVerificationGate,
  ) {
    this.query = new BookingQueryService(
      bookingRepo,
      vehicleRepo,
      userRepo,
      operatorRepo,
      bookingEventRepo,
    )
    this.creation = new BookingCreationService(
      bookingRepo,
      runInTransaction,
      userRepo,
      postCommit,
      generateCode,
      verificationGate,
    )
    this.lifecycle = new BookingLifecycleService(
      bookingRepo,
      runInTransaction,
      vehicleRepo,
      vehicleClassRepo,
      postCommit,
    )
  }

  // --- query ---------------------------------------------------------------

  findAll(ctx: CallerContext, filters?: BookingFilters): Promise<Booking[]> {
    return this.query.findAll(ctx, filters)
  }

  findAllPaginated(
    ctx: CallerContext,
    filters: BookingFilters,
  ): Promise<{ data: Booking[]; nextCursor: string | null }> {
    return this.query.findAllPaginated(ctx, filters)
  }

  findAllWithVehiclesPaginated(
    ctx: CallerContext,
    filters: BookingFilters,
  ): ReturnType<BookingQueryService['findAllWithVehiclesPaginated']> {
    return this.query.findAllWithVehiclesPaginated(ctx, filters)
  }

  findAllWithRentersPaginated(
    ctx: CallerContext,
    filters: BookingFilters,
  ): ReturnType<BookingQueryService['findAllWithRentersPaginated']> {
    return this.query.findAllWithRentersPaginated(ctx, filters)
  }

  findAllWithVehiclesAndRentersPaginated(
    ctx: CallerContext,
    filters: BookingFilters,
  ): ReturnType<BookingQueryService['findAllWithVehiclesAndRentersPaginated']> {
    return this.query.findAllWithVehiclesAndRentersPaginated(ctx, filters)
  }

  findById(ctx: CallerContext, id: string): Promise<BookingWithOperator | undefined> {
    return this.query.findById(ctx, id)
  }

  findByIdWithVehicleAndRenter(
    ctx: CallerContext,
    id: string,
  ): ReturnType<BookingQueryService['findByIdWithVehicleAndRenter']> {
    return this.query.findByIdWithVehicleAndRenter(ctx, id)
  }

  findEvents(ctx: CallerContext, id: string): Promise<BookingEvent[] | undefined> {
    return this.query.findEvents(ctx, id)
  }

  // --- creation ------------------------------------------------------------

  create(
    ctx: CallerContext,
    input: CreateBookingInput,
    now: Date = new Date(),
  ): Promise<CreateBookingResult> {
    return this.creation.create(ctx, input, now)
  }

  // --- lifecycle -----------------------------------------------------------

  substitute(
    ctx: CallerContext,
    bookingId: string,
    newVehicleId: string,
    reason: string | null = null,
  ): Promise<SubstituteResult> {
    return this.lifecycle.substitute(ctx, bookingId, newVehicleId, reason)
  }

  findSubstitutionCandidates(
    ctx: CallerContext,
    bookingId: string,
  ): Promise<Vehicle[] | undefined> {
    return this.lifecycle.findSubstitutionCandidates(ctx, bookingId)
  }

  updateStatus(
    ctx: CallerContext,
    bookingId: string,
    newStatus: BookingStatus,
  ): Promise<StatusTransitionResult> {
    return this.lifecycle.updateStatus(ctx, bookingId, newStatus)
  }

  cancel(ctx: CallerContext, bookingId: string, now: Date = new Date()): Promise<CancelResult> {
    return this.lifecycle.cancel(ctx, bookingId, now)
  }
}
