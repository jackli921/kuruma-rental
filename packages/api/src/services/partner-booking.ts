import type { CallerContext } from '../middleware/auth'
import type { UserRepository } from '../repositories/types'
import type { Booking } from '../stores'
import type { BookingService, CreateBookingResult } from './booking'

export interface PartnerBookingInput {
  vehicleId: string
  renterEmail: string
  renterName: string
  renterPhone: string | null
  renterLanguage: string
  startAt: Date
  endAt: Date
  source: Booking['source']
  externalId: string
  notes: string | null
  idempotencyKey?: string | null
}

/**
 * Composes user-upsert + booking-create for partner-originated bookings
 * (Trip.com and similar). The partner provides renter contact info; we
 * resolve or create the renter row and delegate to BookingService.
 *
 * Exists as a separate service so the booking orchestration stays
 * ignorant of user upsert semantics.
 */
export class PartnerBookingService {
  constructor(
    private readonly bookingService: BookingService,
    private readonly userRepo: UserRepository,
  ) {}

  async create(ctx: CallerContext, input: PartnerBookingInput): Promise<CreateBookingResult> {
    const renter = await this.userRepo.quickCreate({
      name: input.renterName,
      email: input.renterEmail,
      phone: input.renterPhone,
      language: input.renterLanguage,
    })

    return this.bookingService.create(ctx, {
      vehicleId: input.vehicleId,
      renterId: renter.id,
      startAt: input.startAt,
      endAt: input.endAt,
      source: input.source,
      externalId: input.externalId,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey ?? null,
    })
  }
}
