import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryBookingRepository,
  InMemoryUserRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { BookingService } from '../../src/services/booking'
import { PartnerBookingService } from '../../src/services/partner-booking'
import type { Vehicle } from '../../src/stores'

const PARTNER = { userId: 'partner:api-key', role: 'PARTNER' as const }

function vehicleInput(overrides?: Partial<Vehicle>) {
  return {
    name: 'Partner Car',
    description: 'A vehicle',
    photos: [] as string[],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'GASOLINE',
    status: 'AVAILABLE' as const,
    bufferMinutes: 60,
    minRentalHours: 1,
    maxRentalHours: 168,
    advanceBookingHours: 0,
    dailyRateJpy: 5000,
    hourlyRateJpy: 1000,
    ...overrides,
  }
}

let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let userRepo: InMemoryUserRepository
let bookingService: BookingService
let service: PartnerBookingService
let vehicleId: string

beforeEach(async () => {
  vehicleRepo = new InMemoryVehicleRepository()
  bookingRepo = new InMemoryBookingRepository()
  userRepo = new InMemoryUserRepository()

  bookingService = new BookingService(bookingRepo, vehicleRepo, userRepo)
  service = new PartnerBookingService(bookingService, userRepo)

  const v = await vehicleRepo.create(vehicleInput())
  vehicleId = v.id
})

describe('PartnerBookingService.create', () => {
  const baseInput = {
    vehicleId: '',
    renterEmail: 'tourist@example.com',
    renterName: 'Tourist Alice',
    renterPhone: null,
    renterLanguage: 'en',
    startAt: new Date('2026-05-01T10:00:00Z'),
    endAt: new Date('2026-05-02T10:00:00Z'),
    source: 'TRIP_COM' as const,
    externalId: 'TRIP-ABC-123',
    notes: null,
  }

  it('creates a booking with source TRIP_COM, externalId, and upserted renter', async () => {
    const result = await service.create(PARTNER, { ...baseInput, vehicleId })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.booking.source).toBe('TRIP_COM')
    expect(result.booking.externalId).toBe('TRIP-ABC-123')

    const renter = await userRepo.findByEmail('tourist@example.com')
    expect(renter?.name).toBe('Tourist Alice')
    expect(result.booking.renterId).toBe(renter?.id)
  })

  it('reuses an existing renter when the email already exists', async () => {
    const existing = await userRepo.quickCreate({
      name: 'Existing',
      email: 'tourist@example.com',
      phone: null,
      language: 'en',
    })

    const result = await service.create(PARTNER, { ...baseInput, vehicleId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.booking.renterId).toBe(existing.id)
  })

  it('rejects when the vehicle is already booked (exclusion constraint path)', async () => {
    const first = await service.create(PARTNER, {
      ...baseInput,
      vehicleId,
      externalId: 'TRIP-1',
    })
    expect(first.ok).toBe(true)

    const second = await service.create(PARTNER, {
      ...baseInput,
      vehicleId,
      renterEmail: 'other@example.com',
      renterName: 'Other',
      externalId: 'TRIP-2',
    })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.status).toBe(409)
  })

  it('deduplicates via idempotencyKey across retries', async () => {
    const key = '00000000-0000-4000-8000-000000000001'
    const first = await service.create(PARTNER, {
      ...baseInput,
      vehicleId,
      externalId: 'TRIP-DUP',
      idempotencyKey: key,
    })
    const second = await service.create(PARTNER, {
      ...baseInput,
      vehicleId,
      externalId: 'TRIP-DUP',
      idempotencyKey: key,
    })

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.booking.id).toBe(first.booking.id)
    expect(second.status).toBe(200)
  })
})
