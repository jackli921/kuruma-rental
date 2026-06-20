// Slice 6 (#392) Task #4 — BookingService.create as ONE transaction (plan §4, §7).
// Resolves the assigned vehicle, location turnaround (NOT the legacy 60-min
// buffer), server price off the assigned vehicle, selected-insurance + fee
// snapshots, a retry-safe booking_code, and appends a BOOKING_CREATED event —
// all atomically. Reads run through an injected in-memory runInTransaction, so
// the service is testable without index.ts (handoff Task #4 entry point).

import { describe, expect, it, vi } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { PG_ERROR } from '../../src/pg-errors'
import {
  InMemoryAddOnRepository,
  InMemoryDocumentStorage,
  InMemoryFeeScheduleRepository,
  InMemoryInsuranceOptionRepository,
  InMemoryLocationRepository,
  InMemoryMaintenanceLogRepository,
  InMemoryRenterDocumentRepository,
  InMemoryUserRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryBookingEventRepository } from '../../src/repositories/in-memory/booking-event'
import type {
  RunInTransaction,
  TransactionRepos,
  VehicleClassRepository,
} from '../../src/repositories/types'
import {
  BookingService,
  type BookingVerificationGate,
  type CreateBookingInput,
} from '../../src/services/booking'
import type { BookingPostCommitDispatcher } from '../../src/services/booking-post-commit-dispatcher'
import { documentVerificationGate } from '../../src/services/document-verification-gate'
import { RenterDocumentService } from '../../src/services/renter-document'
import type { Booking, BookingEvent, User, Vehicle, VehicleClass } from '../../src/stores'

const OP_A = 'op-a'
const OP_B = 'op-b'
const RENTER = 'renter-1'
const CLASS_COMPACT = 'class-compact'
const LOC_OSAKA = 'loc-osaka'

const NOW = new Date('2026-07-01T00:00:00Z')
const START = new Date('2026-07-02T00:00:00Z') // +24h from now
const END = new Date('2026-07-04T00:00:00Z') // 2-day rental
const TURNAROUND_MS = 2880 * 60 * 1000 // 48h, the location default

const renterCtx: CallerContext = { userId: RENTER, role: 'RENTER', bypassScope: false }

function vehicleData(o: Partial<Vehicle> = {}): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId: OP_A,
    classId: CLASS_COMPACT,
    pickupLocationId: LOC_OSAKA,
    name: 'Yaris',
    description: null,
    photos: [],
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 10000,
    hourlyRateJpy: null,
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
    ...o,
  }
}

interface Harness {
  service: BookingService
  repos: TransactionRepos
  bookingStore: Map<string, Booking>
  events: BookingEvent[]
  vehicleId: string
  generate: { mock: ReturnType<typeof vi.fn> }
}

// Wires all seven in-memory repos behind a pass-through runInTransaction (the
// JS event loop is single-threaded, so the InMemory "transaction" mirrors the
// Drizzle one without real rollback — ordering insert-before-append gives the
// atomicity the exclusion-failure test asserts). `codes` drives the injectable
// booking_code generator so the collision-retry path is deterministic.
async function setup(
  opts: { codes?: string[]; verificationGate?: BookingVerificationGate } = {},
): Promise<Harness> {
  const bookingStore = new Map<string, Booking>()
  const events: BookingEvent[] = []
  const bookingRepo = new InMemoryBookingRepository(bookingStore)
  const bookingEventRepo = new InMemoryBookingEventRepository(events)
  const vehicleRepo = new InMemoryVehicleRepository()
  const locationRepo = new InMemoryLocationRepository()
  const insuranceOptionRepo = new InMemoryInsuranceOptionRepository()
  const addOnRepo = new InMemoryAddOnRepository()
  const feeScheduleRepo = new InMemoryFeeScheduleRepository()
  const maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
  const vehicleClassRepo = new InMemoryVehicleClassRepository()
  const userRepo = new InMemoryUserRepository(
    new Map<string, User>([
      [
        RENTER,
        {
          id: RENTER,
          name: 'R',
          email: 'r@x',
          phone: null,
          language: 'en',
          country: null,
          role: 'RENTER',
        },
      ],
    ]),
  )

  const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleData())
  await locationRepo.create({
    operatorId: OP_A,
    name: 'Osaka Namba',
    address: '1-2-3 Namba',
    operatingHours: null,
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE',
  } as Parameters<typeof locationRepo.create>[0])
  // Real location id differs from LOC_OSAKA; rewire the seeded vehicle's
  // pickupLocationId + the create input to the created location below.

  const repos: TransactionRepos = {
    vehicleRepo,
    maintenanceLogRepo,
    bookingRepo,
    bookingEventRepo,
    locationRepo,
    insuranceOptionRepo,
    addOnRepo,
    feeScheduleRepo,
    userRepo,
  }
  const runInTransaction: RunInTransaction = async (fn) => fn(repos)

  const queue = [...(opts.codes ?? [])]
  const generateMock = vi.fn(
    () => queue.shift() ?? `GEN${(queue.length + 1).toString().padStart(5, '0')}`,
  )

  const service = new BookingService(
    bookingRepo,
    runInTransaction,
    vehicleRepo,
    userRepo,
    vehicleClassRepo,
    undefined,
    undefined,
    bookingEventRepo,
    generateMock,
    opts.verificationGate,
  )

  return {
    service,
    repos,
    bookingStore,
    events,
    vehicleId: vehicle.id,
    generate: { mock: generateMock },
  }
}

function createInput(o: Partial<CreateBookingInput> = {}): CreateBookingInput {
  return {
    requestedVehicleId: '',
    pickupLocationId: '',
    dropoffLocationId: '',
    renterId: RENTER,
    startAt: START,
    endAt: END,
    source: 'DIRECT',
    addOnIds: [],
    ...o,
  }
}

// Resolve the real seeded location id (InMemory repos assign UUIDs) and align
// the vehicle's pickupLocationId to it, returning ids ready for createInput.
async function seedReady(h: Harness) {
  const locations = await h.repos.locationRepo.findAll(SYSTEM_CONTEXT)
  const locationId = locations[0]!.id
  // Point the seeded vehicle at the real location so pickup resolution matches.
  const veh = await h.repos.vehicleRepo.findById(SYSTEM_CONTEXT, h.vehicleId)
  ;(veh as Vehicle).pickupLocationId = locationId
  return { vehicleId: h.vehicleId, locationId }
}

describe('BookingService.create — past-start floor (#954)', () => {
  // The seeded vehicle has advanceBookingHours: null (the default + forced for
  // MANUAL), so the universal past-start floor in checkRentalRules is the only
  // thing standing between a renter and booking a car for a time already gone.
  it('rejects a booking whose start is in the past with a specific code', async () => {
    const h = await setup()
    const { vehicleId, locationId } = await seedReady(h)
    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        startAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000), // 2h before now
        endAt: END,
      }),
      NOW,
    )
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    if (!result.ok) expect(result.code).toBe('RENTAL_RULE_START_IN_PAST')
  })

  it('accepts a booking whose start is now or later', async () => {
    const h = await setup()
    const { vehicleId, locationId } = await seedReady(h)
    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        startAt: START, // +24h from now
        endAt: END,
      }),
      NOW,
    )
    expect(result.ok).toBe(true)
  })
})

describe('BookingService.create — document-verification gate (#459)', () => {
  const staffCtx: CallerContext = { userId: 'staff-9', role: 'PLATFORM_ADMIN', bypassScope: true }

  // Build the REAL gate from a document service so these exercise the actual
  // eligibility policy (approved IDP valid through the return date), not a stub.
  async function gateFor(seedApprovedIdp: boolean): Promise<BookingVerificationGate> {
    const docRepo = new InMemoryRenterDocumentRepository()
    const docService = new RenterDocumentService(docRepo, new InMemoryDocumentStorage())
    if (seedApprovedIdp) {
      const doc = await docRepo.create(renterCtx, {
        renterId: RENTER,
        type: 'IDP',
        storageKey: 'renter-documents/renter-1/scan.jpg',
      })
      await docRepo.verify(staffCtx, doc.id, {
        status: 'APPROVED',
        verifierId: staffCtx.userId,
        expiryDate: '2030-01-01', // valid well past the END return date
      })
    }
    return documentVerificationGate(docService)
  }

  it('allows an unverified renter to book when no gate is wired (flag off)', async () => {
    const h = await setup({ codes: ['NOGATE12'] })
    const { vehicleId, locationId } = await seedReady(h)

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
      NOW,
    )

    expect(result.ok).toBe(true)
  })

  it('blocks a renter with no approved IDP — 403 DOCUMENT_VERIFICATION_REQUIRED (flag on)', async () => {
    const h = await setup({ codes: ['GATED012'], verificationGate: await gateFor(false) })
    const { vehicleId, locationId } = await seedReady(h)

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
      NOW,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(403)
    expect(result.code).toBe('DOCUMENT_VERIFICATION_REQUIRED')
    // Fail-fast: the gate runs before the transaction, so nothing is persisted.
    expect(h.bookingStore.size).toBe(0)
    expect(h.events).toHaveLength(0)
  })

  it('allows a renter with an approved, unexpired IDP to book (flag on)', async () => {
    const h = await setup({ codes: ['APPRV012'], verificationGate: await gateFor(true) })
    const { vehicleId, locationId } = await seedReady(h)

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
      NOW,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.booking.status).toBe('CONFIRMED')
  })
})

describe('BookingService.create — single-transaction submit (#392 §4)', () => {
  it('confirms a booking: derives operator/class/assigned vehicle, prices off the vehicle, appends BOOKING_CREATED', async () => {
    const h = await setup({ codes: ['ABCD2345'] })
    const { vehicleId, locationId } = await seedReady(h)

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
      NOW,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const b = result.booking
    expect(b.operatorId).toBe(OP_A)
    expect(b.classId).toBe(CLASS_COMPACT)
    expect(b.requestedVehicleId).toBe(vehicleId)
    expect(b.assignedVehicleId).toBe(vehicleId) // server-derived = requested
    expect(b.status).toBe('CONFIRMED')
    expect(b.bookingCode).toBe('ABCD2345')
    expect(b.totalPrice).toBe(20000) // 2 days * 10000, non-null on submit (#429)
    // #463: every pre-demo booking is server-derived SPECIFIC.
    expect(b.fulfillmentMode).toBe('SPECIFIC')

    // BOOKING_CREATED event appended, payload mirrors the booking.
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({
      bookingId: b.id,
      type: 'BOOKING_CREATED',
      actorId: RENTER,
    })
    expect(h.events[0]!.payload).toMatchObject({
      requestedVehicleId: vehicleId,
      assignedVehicleId: vehicleId,
      classId: CLASS_COMPACT,
      totalPrice: 20000,
      fulfillmentMode: 'SPECIFIC', // #463: snapshot the discriminator in the audit event
    })
  })

  it('records the acting caller (not the renter) as the BOOKING_CREATED actor for a manual booking', async () => {
    const h = await setup({ codes: ['MANUAL12'] })
    const { vehicleId, locationId } = await seedReady(h)
    const staffCtx: CallerContext = { userId: 'staff-9', role: 'PLATFORM_ADMIN', bypassScope: true }

    const result = await h.service.create(
      staffCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        renterId: RENTER, // staff books on behalf of an existing renter
      }),
      NOW,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The booking belongs to the renter, but the audit actor is the staff member.
    expect(result.booking.renterId).toBe(RENTER)
    expect(h.events[0]).toMatchObject({ type: 'BOOKING_CREATED', actorId: 'staff-9' })
  })

  it('rejects a pickup location that is not the vehicle’s own storefront, even same-operator', async () => {
    const h = await setup({ codes: ['MISMATCH1'] })
    const { vehicleId } = await seedReady(h) // vehicle's pickupLocationId = seeded location
    // A second ACTIVE location under the SAME operator — a forged body could try
    // to book the car here while it physically lives at the seeded storefront.
    const other = await h.repos.locationRepo.create({
      operatorId: OP_A,
      name: 'Umeda Annex',
      address: '9-9-9 Umeda',
      operatingHours: null,
      timezone: 'Asia/Tokyo',
      defaultTurnaroundMinutes: 1440,
      status: 'ACTIVE',
    } as Parameters<typeof h.repos.locationRepo.create>[0])

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: other.id,
        dropoffLocationId: other.id,
      }),
      NOW,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/pickup location does not match/i)
    // No booking row, no event leaked.
    expect(h.events).toHaveLength(0)
  })

  it('sets effectiveEndAt = endAt + location turnaround (48h), NOT the legacy 60-min buffer', async () => {
    const h = await setup()
    const { vehicleId, locationId } = await seedReady(h)

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
      NOW,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Mutation guard (§9 item 20): a 60-min result MUST fail this assertion.
    expect(result.booking.effectiveEndAt.getTime() - END.getTime()).toBe(TURNAROUND_MS)
    expect(result.booking.effectiveEndAt.getTime() - END.getTime()).not.toBe(60 * 60 * 1000)
  })

  it('snapshots the selected active insurance option and adds its daily price to totalPrice', async () => {
    const h = await setup()
    const { vehicleId, locationId } = await seedReady(h)
    const opt = await h.repos.insuranceOptionRepo.create({
      operatorId: OP_A,
      name: 'Premium',
      description: null,
      dailyPriceJpy: 2000,
      deductibleJpy: 150000,
      status: 'ACTIVE',
    } as Parameters<typeof h.repos.insuranceOptionRepo.create>[0])

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        insuranceOptionId: opt.id,
      }),
      NOW,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.booking.insuranceOptionId).toBe(opt.id)
    expect(result.booking.insuranceSnapshot).toEqual({
      insuranceOptionId: opt.id,
      name: 'Premium',
      dailyPriceJpy: 2000,
      deductibleJpy: 150000,
    })
    // 2 days * (10000 vehicle + 2000 insurance) = 24000
    expect(result.booking.totalPrice).toBe(24000)
  })

  it('rejects another operator’s / archived insurance option (400)', async () => {
    const h = await setup()
    const { vehicleId, locationId } = await seedReady(h)
    const foreign = await h.repos.insuranceOptionRepo.create({
      operatorId: OP_B,
      name: 'Other',
      description: null,
      dailyPriceJpy: 999,
      deductibleJpy: null,
      status: 'ACTIVE',
    } as Parameters<typeof h.repos.insuranceOptionRepo.create>[0])

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        insuranceOptionId: foreign.id,
      }),
      NOW,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
  })

  it('snapshots selected active add-ons and adds each flat price to totalPrice (#460)', async () => {
    const h = await setup()
    const { vehicleId, locationId } = await seedReady(h)
    const seat = await h.repos.addOnRepo.create({
      operatorId: OP_A,
      name: 'Baby seat',
      description: null,
      priceJpy: 1100,
      status: 'ACTIVE',
    } as Parameters<typeof h.repos.addOnRepo.create>[0])
    const etc = await h.repos.addOnRepo.create({
      operatorId: OP_A,
      name: 'ETC card',
      description: null,
      priceJpy: 330,
      status: 'ACTIVE',
    } as Parameters<typeof h.repos.addOnRepo.create>[0])

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        addOnIds: [seat.id, etc.id],
      }),
      NOW,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.booking.addOnSnapshot).toEqual([
      { addOnId: seat.id, name: 'Baby seat', priceJpy: 1100 },
      { addOnId: etc.id, name: 'ETC card', priceJpy: 330 },
    ])
    // 2 days * 10000 vehicle + 1100 + 330 add-ons (flat, NOT per-day) = 21430
    expect(result.booking.totalPrice).toBe(21430)
  })

  it('de-duplicates a repeated add-on id (charges once) (#460)', async () => {
    const h = await setup()
    const { vehicleId, locationId } = await seedReady(h)
    const seat = await h.repos.addOnRepo.create({
      operatorId: OP_A,
      name: 'Baby seat',
      description: null,
      priceJpy: 1100,
      status: 'ACTIVE',
    } as Parameters<typeof h.repos.addOnRepo.create>[0])

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        addOnIds: [seat.id, seat.id],
      }),
      NOW,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.booking.addOnSnapshot).toHaveLength(1)
    expect(result.booking.totalPrice).toBe(21100) // 20000 + 1100 once
  })

  it('rejects another operator’s / archived add-on (400) (#460)', async () => {
    const h = await setup()
    const { vehicleId, locationId } = await seedReady(h)
    const foreign = await h.repos.addOnRepo.create({
      operatorId: OP_B,
      name: 'Foreign seat',
      description: null,
      priceJpy: 999,
      status: 'ACTIVE',
    } as Parameters<typeof h.repos.addOnRepo.create>[0])

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        addOnIds: [foreign.id],
      }),
      NOW,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
  })

  it('snapshots operator-wide + class-specific active fees, excluding other operators and archived rows', async () => {
    const h = await setup()
    const { vehicleId, locationId } = await seedReady(h)
    const fee = (o: Record<string, unknown>) =>
      h.repos.feeScheduleRepo.create({
        operatorId: OP_A,
        vehicleClassId: null,
        feeType: 'CLEANING_FLAT',
        unit: 'FLAT',
        amountJpy: 3000,
        status: 'ACTIVE',
        ...o,
      } as Parameters<typeof h.repos.feeScheduleRepo.create>[0])
    await fee({}) // operator-wide cleaning
    await fee({
      vehicleClassId: CLASS_COMPACT,
      feeType: 'OVERTIME_HOURLY',
      unit: 'PER_HOUR',
      amountJpy: 500,
    })
    await fee({ operatorId: OP_B }) // other operator — excluded
    await fee({ feeType: 'NO_FUEL_FLAT', amountJpy: 5000, status: 'ARCHIVED' }) // archived — excluded

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
      NOW,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.booking.feeSnapshot).toHaveLength(2)
    expect(result.booking.feeSnapshot).toContainEqual({
      feeType: 'CLEANING_FLAT',
      unit: 'FLAT',
      amountJpy: 3000,
      vehicleClassId: null,
    })
    expect(result.booking.feeSnapshot).toContainEqual({
      feeType: 'OVERTIME_HOURLY',
      unit: 'PER_HOUR',
      amountJpy: 500,
      vehicleClassId: CLASS_COMPACT,
    })
  })

  it('is atomic: on exclusion failure no booking row and no event persist (409)', async () => {
    const h = await setup()
    const { vehicleId, locationId } = await seedReady(h)
    // Pre-seed an overlapping CONFIRMED booking on the same assigned vehicle.
    await h.repos.bookingRepo.create(SYSTEM_CONTEXT, {
      operatorId: OP_A,
      renterId: 'someone-else',
      classId: CLASS_COMPACT,
      requestedVehicleId: vehicleId,
      assignedVehicleId: vehicleId,
      pickupLocationId: locationId,
      dropoffLocationId: locationId,
      startAt: START,
      endAt: END,
      effectiveEndAt: new Date(END.getTime() + TURNAROUND_MS),
      status: 'CONFIRMED',
      source: 'DIRECT',
      bookingCode: 'SEED0001',
      insuranceOptionId: null,
      insuranceSnapshot: null,
      feeSnapshot: [],
      addOnSnapshot: [],
      externalId: null,
      notes: null,
      totalPrice: 20000,
      cancellationFee: null,
      cancelledAt: null,
      idempotencyKey: null,
    })

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
      NOW,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(h.bookingStore.size).toBe(1) // only the seeded row
    expect(h.events).toHaveLength(0) // no orphan event
  })

  it('replays idempotently: same key returns the existing booking and emits no second event', async () => {
    const h = await setup({ codes: ['FIRST123', 'SECOND12'] })
    const { vehicleId, locationId } = await seedReady(h)
    const input = createInput({
      requestedVehicleId: vehicleId,
      pickupLocationId: locationId,
      dropoffLocationId: locationId,
      idempotencyKey: 'idem-key-1',
    })

    const first = await h.service.create(renterCtx, input, NOW)
    const second = await h.service.create(renterCtx, input, NOW)
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.booking.id).toBe(first.booking.id)
    expect(second.status).toBe(200)
    expect(h.events).toHaveLength(1)
    expect(h.bookingStore.size).toBe(1)
  })

  // #875: the walk-in renter is minted INSIDE the tx, after the idempotency-replay
  // short-circuit — so a replayed walk-in returns the same booking WITHOUT creating
  // a second orphan renter. Pre-#875 every call minted one before the replay check.
  it('mints the walk-in renter once across an idempotent replay (#875)', async () => {
    const h = await setup({ codes: ['WALKIN01', 'WALKIN02'] })
    const { vehicleId, locationId } = await seedReady(h)
    const mintSpy = vi.spyOn(h.repos.userRepo, 'createWalkInRenter')
    const opCtx: CallerContext = {
      userId: 'op-walkin',
      role: 'OPERATOR_OWNER',
      operatorId: OP_A,
      bypassScope: false,
    }
    const input = createInput({
      requestedVehicleId: vehicleId,
      pickupLocationId: locationId,
      dropoffLocationId: locationId,
      source: 'MANUAL',
      walkInCustomer: { name: 'Hanako Walk-In', phone: '+81-90-8750-0001' },
      idempotencyKey: 'walkin-idem-1',
    })

    const first = await h.service.create(opCtx, input, NOW)
    const second = await h.service.create(opCtx, input, NOW)

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('expected both walk-in creates to succeed')
    expect(second.booking.id).toBe(first.booking.id) // replayed — same booking
    expect(second.status).toBe(200)
    expect(mintSpy).toHaveBeenCalledTimes(1) // renter minted once, not per attempt
    // The booking attaches to the freshly-minted renter, not the ignored input.renterId.
    const minted = await mintSpy.mock.results[0]!.value
    expect(first.booking.renterId).toBe(minted.id)
    expect(first.booking.renterId).not.toBe(RENTER)
    expect(h.bookingStore.size).toBe(1)
  })

  it('regenerates the booking_code on a UNIQUE clash and retries (bounded)', async () => {
    const h = await setup({ codes: ['COLLIDE1', 'FRESH001'] })
    const { vehicleId, locationId } = await seedReady(h)
    // Seed a non-overlapping booking on a different vehicle that owns COLLIDE1.
    await h.repos.bookingRepo.create(SYSTEM_CONTEXT, {
      operatorId: OP_A,
      renterId: 'x',
      classId: CLASS_COMPACT,
      requestedVehicleId: 'other-veh',
      assignedVehicleId: 'other-veh',
      pickupLocationId: locationId,
      dropoffLocationId: locationId,
      startAt: START,
      endAt: END,
      effectiveEndAt: new Date(END.getTime() + TURNAROUND_MS),
      status: 'CONFIRMED',
      source: 'DIRECT',
      bookingCode: 'COLLIDE1',
      insuranceOptionId: null,
      insuranceSnapshot: null,
      feeSnapshot: [],
      addOnSnapshot: [],
      externalId: null,
      notes: null,
      totalPrice: 1,
      cancellationFee: null,
      cancelledAt: null,
      idempotencyKey: null,
    })

    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
      NOW,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.booking.bookingCode).toBe('FRESH001')
    expect(h.generate.mock).toHaveBeenCalledTimes(2)
  })

  it('surfaces an error when booking_code retries are exhausted', async () => {
    const h = await setup({ codes: ['DUP00001', 'DUP00001', 'DUP00001', 'DUP00001'] })
    const { vehicleId, locationId } = await seedReady(h)
    await h.repos.bookingRepo.create(SYSTEM_CONTEXT, {
      operatorId: OP_A,
      renterId: 'x',
      classId: CLASS_COMPACT,
      requestedVehicleId: 'other-veh',
      assignedVehicleId: 'other-veh',
      pickupLocationId: locationId,
      dropoffLocationId: locationId,
      startAt: START,
      endAt: END,
      effectiveEndAt: new Date(END.getTime() + TURNAROUND_MS),
      status: 'CONFIRMED',
      source: 'DIRECT',
      bookingCode: 'DUP00001',
      insuranceOptionId: null,
      insuranceSnapshot: null,
      feeSnapshot: [],
      addOnSnapshot: [],
      externalId: null,
      notes: null,
      totalPrice: 1,
      cancellationFee: null,
      cancelledAt: null,
      idempotencyKey: null,
    })

    await expect(
      h.service.create(
        renterCtx,
        createInput({
          requestedVehicleId: vehicleId,
          pickupLocationId: locationId,
          dropoffLocationId: locationId,
        }),
        NOW,
      ),
    ).rejects.toMatchObject({ code: PG_ERROR.UNIQUE_VIOLATION })
  })

  it('rejects an unknown requested vehicle (400)', async () => {
    const h = await setup()
    const { locationId } = await seedReady(h)
    const result = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: 'nope',
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
      NOW,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
  })
})

// ---- Substitution (#392 §5.5) ----

const ACRISS_A = 'ECMR'
const ACRISS_B = 'IFAR'

const opCtxA: CallerContext = {
  userId: 'opA-staff',
  role: 'OPERATOR_OWNER',
  operatorId: OP_A,
  bypassScope: false,
}
const opCtxB: CallerContext = {
  userId: 'opB-staff',
  role: 'OPERATOR_OWNER',
  operatorId: OP_B,
  bypassScope: false,
}

function classData(
  o: Partial<VehicleClass> = {},
): Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId: OP_A,
    name: 'Class',
    slug: 'class',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: null,
    sortOrder: 0,
    status: 'ACTIVE',
    ...o,
  }
}

function bookingRow(o: Partial<Booking>): Omit<Booking, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId: OP_A,
    renterId: 'seed-renter',
    classId: CLASS_COMPACT,
    requestedVehicleId: 'seed-veh',
    assignedVehicleId: 'seed-veh',
    pickupLocationId: 'seed-loc',
    dropoffLocationId: 'seed-loc',
    startAt: START,
    endAt: END,
    effectiveEndAt: new Date(END.getTime() + TURNAROUND_MS),
    status: 'CONFIRMED',
    source: 'DIRECT',
    bookingCode: 'SEEDROW1',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 1,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    ...o,
  }
}

interface SubHarness {
  service: BookingService
  repos: TransactionRepos
  events: BookingEvent[]
  classA: VehicleClass
  classB: VehicleClass
  locationId: string
  v1Id: string
  bookingId: string
}

// Seeds a confirmed operator-A booking on vehicle V1 (class A @ ACRISS_A, the
// Osaka location) via the real submit path, ready for substitution tests.
// The class repo is injectable so #709's call-count test can wrap it in a spy.
async function setupSub(
  postCommit?: BookingPostCommitDispatcher,
  vehicleClassRepo: VehicleClassRepository = new InMemoryVehicleClassRepository(),
): Promise<SubHarness> {
  const events: BookingEvent[] = []
  const bookingRepo = new InMemoryBookingRepository()
  const bookingEventRepo = new InMemoryBookingEventRepository(events)
  const vehicleRepo = new InMemoryVehicleRepository()
  const locationRepo = new InMemoryLocationRepository()
  const insuranceOptionRepo = new InMemoryInsuranceOptionRepository()
  const addOnRepo = new InMemoryAddOnRepository()
  const feeScheduleRepo = new InMemoryFeeScheduleRepository()
  const maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
  const userRepo = new InMemoryUserRepository(
    new Map<string, User>([
      [
        RENTER,
        {
          id: RENTER,
          name: 'R',
          email: 'r@x',
          phone: null,
          language: 'en',
          country: null,
          role: 'RENTER',
        },
      ],
    ]),
  )

  const classA = await vehicleClassRepo.create(
    classData({ name: 'Compact A', slug: 'compact-a', acrissCode: ACRISS_A }),
  )
  const classB = await vehicleClassRepo.create(
    classData({ name: 'SUV B', slug: 'suv-b', acrissCode: ACRISS_B }),
  )
  const location = await locationRepo.create({
    operatorId: OP_A,
    name: 'Osaka',
    address: '1',
    operatingHours: null,
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE',
  } as Parameters<typeof locationRepo.create>[0])
  const v1 = await vehicleRepo.create(
    SYSTEM_CONTEXT,
    vehicleData({ classId: classA.id, pickupLocationId: location.id, dailyRateJpy: 10000 }),
  )

  const repos: TransactionRepos = {
    vehicleRepo,
    maintenanceLogRepo,
    bookingRepo,
    bookingEventRepo,
    locationRepo,
    insuranceOptionRepo,
    addOnRepo,
    feeScheduleRepo,
    userRepo,
  }
  const runInTransaction: RunInTransaction = async (fn) => fn(repos)
  const service = new BookingService(
    bookingRepo,
    runInTransaction,
    vehicleRepo,
    userRepo,
    vehicleClassRepo,
    postCommit,
    undefined,
    bookingEventRepo,
    () => 'SUBSEED1',
  )

  const created = await service.create(
    renterCtx,
    createInput({
      requestedVehicleId: v1.id,
      pickupLocationId: location.id,
      dropoffLocationId: location.id,
    }),
    NOW,
  )
  if (!created.ok) throw new Error('setupSub: seed booking failed')
  return {
    service,
    repos,
    events,
    classA,
    classB,
    locationId: location.id,
    v1Id: v1.id,
    bookingId: created.booking.id,
  }
}

describe('BookingService.substitute — operator vehicle swap (#392 §5.5)', () => {
  // A same-operator candidate vehicle (class A @ the Osaka location by default).
  const addVehicle = (h: SubHarness, o: Partial<Vehicle> = {}) =>
    h.repos.vehicleRepo.create(
      SYSTEM_CONTEXT,
      vehicleData({
        classId: h.classA.id,
        pickupLocationId: h.locationId,
        dailyRateJpy: 15000,
        ...o,
      }),
    )

  it('rejects a replacement vehicle from another operator (404, no leak)', async () => {
    const h = await setupSub()
    const foreign = await addVehicle(h, { operatorId: OP_B })
    const result = await h.service.substitute(opCtxA, h.bookingId, foreign.id, null)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
  })

  it('rejects a replacement vehicle at a different pickup location (400)', async () => {
    const h = await setupSub()
    const loc2 = await h.repos.locationRepo.create({
      operatorId: OP_A,
      name: 'Kyoto',
      address: '2',
      operatingHours: null,
      timezone: 'Asia/Tokyo',
      defaultTurnaroundMinutes: 2880,
      status: 'ACTIVE',
    } as Parameters<typeof h.repos.locationRepo.create>[0])
    const elsewhere = await addVehicle(h, { pickupLocationId: loc2.id })
    const result = await h.service.substitute(opCtxA, h.bookingId, elsewhere.id, null)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
  })

  it('rejects a replacement vehicle of a different ACRISS class (400)', async () => {
    const h = await setupSub()
    const otherClass = await addVehicle(h, { classId: h.classB.id })
    const result = await h.service.substitute(opCtxA, h.bookingId, otherClass.id, null)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
  })

  it('swaps the vehicle: updates assignedVehicleId, keeps requestedVehicleId, re-snapshots totalPrice, appends VEHICLE_SUBSTITUTED', async () => {
    const h = await setupSub()
    const replacement = await addVehicle(h, { dailyRateJpy: 15000 })
    const result = await h.service.substitute(opCtxA, h.bookingId, replacement.id, 'maintenance')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.booking.assignedVehicleId).toBe(replacement.id)
    expect(result.booking.requestedVehicleId).toBe(h.v1Id) // audit trail preserved
    expect(result.booking.totalPrice).toBe(30000) // 2 days * 15000 (#429 re-snapshot)
    const subs = h.events.filter((e) => e.type === 'VEHICLE_SUBSTITUTED')
    expect(subs).toHaveLength(1)
    expect(subs[0]).toMatchObject({ bookingId: h.bookingId, actorId: opCtxA.userId })
    expect(subs[0]!.payload).toMatchObject({
      fromVehicleId: h.v1Id,
      toVehicleId: replacement.id,
      reason: 'maintenance',
    })
  })

  it('backfills totalPrice when a vehicle is assigned to a null-total class-only booking (#429)', async () => {
    const h = await setupSub()
    const replacement = await addVehicle(h) // class A @ Osaka, 15000/day

    // A class-only booking (#464 CLASS_COMBO): no vehicle assigned at creation,
    // so it was never priced (totalPrice null). Assigning a vehicle via
    // substitute() must SNAPSHOT the price off that vehicle, not preserve null —
    // a null total would later cancel for a ¥0 fee via the `totalPrice ?? 0`
    // floor in the cancel path. This is #429's named backfill guard.
    const classOnly = await h.repos.bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingRow({
        classId: h.classA.id,
        requestedVehicleId: h.v1Id,
        assignedVehicleId: null,
        totalPrice: null,
        pickupLocationId: h.locationId,
        dropoffLocationId: h.locationId,
        bookingCode: 'CLASSONLY',
      }),
    )

    const result = await h.service.substitute(opCtxA, classOnly.id, replacement.id, null)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.booking.assignedVehicleId).toBe(replacement.id)
    expect(result.booking.totalPrice).toBe(30000) // 2 days * 15000, backfilled from null
    // Persisted, not just returned on the result object.
    const stored = await h.repos.bookingRepo.findById(opCtxA, classOnly.id)
    expect(stored?.totalPrice).toBe(30000)
  })

  it('folds locked add-on charges into the re-snapshotted total on substitute (#855)', async () => {
    const h = await setupSub()
    const original = await addVehicle(h) // the add-on booking sits on its own vehicle
    const replacement = await addVehicle(h) // class A @ Osaka, 15000/day

    // A booking carrying paid add-ons (#460): their flat charges are locked into
    // addOnSnapshot at creation. substitute() re-prices the base off the new
    // vehicle and must re-add those charges — the canonical composition is
    // base + insurance + Σ add-ons (booking-creation.ts). Dropping the add-ons
    // silently undercharges the renter by their total on every vehicle swap.
    const withAddOns = await h.repos.bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingRow({
        classId: h.classA.id,
        requestedVehicleId: original.id,
        assignedVehicleId: original.id,
        pickupLocationId: h.locationId,
        dropoffLocationId: h.locationId,
        bookingCode: 'ADDONS01',
        addOnSnapshot: [
          { addOnId: 'a-gps', name: 'GPS', priceJpy: 3000 },
          { addOnId: 'a-seat', name: 'Child seat', priceJpy: 2000 },
        ],
      }),
    )

    const result = await h.service.substitute(opCtxA, withAddOns.id, replacement.id, null)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 2 days * 15000 (new vehicle base) + 5000 (Σ add-on priceJpy). Insurance null.
    expect(result.booking.totalPrice).toBe(35000)
    // Persisted, not just returned.
    const stored = await h.repos.bookingRepo.findById(opCtxA, withAddOns.id)
    expect(stored?.totalPrice).toBe(35000)
  })

  it('rejects a replacement already booked for the range (409, no event appended)', async () => {
    const h = await setupSub()
    const replacement = await addVehicle(h)
    await h.repos.bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingRow({
        assignedVehicleId: replacement.id,
        requestedVehicleId: replacement.id,
        pickupLocationId: h.locationId,
        dropoffLocationId: h.locationId,
        bookingCode: 'OTHER001',
      }),
    )
    const result = await h.service.substitute(opCtxA, h.bookingId, replacement.id, null)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(h.events.filter((e) => e.type === 'VEHICLE_SUBSTITUTED')).toHaveLength(0)
  })

  it('returns 404 when the booking belongs to another operator (no cross-tenant write)', async () => {
    const h = await setupSub()
    const replacement = await addVehicle(h)
    const result = await h.service.substitute(opCtxB, h.bookingId, replacement.id, null)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(404)
  })
})

// Counts every read against the wrapped class repo so a test can assert the
// substitution path resolves classes in a constant number of queries (#709) —
// not the per-candidate `findById` fan-out it used to do.
class CountingVehicleClassRepository implements VehicleClassRepository {
  findByIdCalls = 0
  findAllCalls = 0
  constructor(private readonly inner: VehicleClassRepository) {}
  findAll(...args: Parameters<VehicleClassRepository['findAll']>) {
    this.findAllCalls += 1
    return this.inner.findAll(...args)
  }
  findById(...args: Parameters<VehicleClassRepository['findById']>) {
    this.findByIdCalls += 1
    return this.inner.findById(...args)
  }
  findBySlug(...args: Parameters<VehicleClassRepository['findBySlug']>) {
    return this.inner.findBySlug(...args)
  }
  create(...args: Parameters<VehicleClassRepository['create']>) {
    return this.inner.create(...args)
  }
  update(...args: Parameters<VehicleClassRepository['update']>) {
    return this.inner.update(...args)
  }
  archive(...args: Parameters<VehicleClassRepository['archive']>) {
    return this.inner.archive(...args)
  }
}

describe('BookingService.findSubstitutionCandidates — batched class lookups (#709)', () => {
  // Same-operator, same-location candidate. Class defaults to A (matches the
  // seeded booking) so it qualifies unless an off-class override is passed.
  const addVehicle = (h: SubHarness, o: Partial<Vehicle> = {}) =>
    h.repos.vehicleRepo.create(
      SYSTEM_CONTEXT,
      vehicleData({
        classId: h.classA.id,
        pickupLocationId: h.locationId,
        dailyRateJpy: 15000,
        ...o,
      }),
    )

  it('resolves classes in a constant number of queries regardless of candidate count', async () => {
    const counting = new CountingVehicleClassRepository(new InMemoryVehicleClassRepository())
    const h = await setupSub(undefined, counting)
    // 6 same-class peers — the old path fired 2 findById each (re-fetching the
    // booking class every time): 12+ findById for 6 candidates. Batched: zero.
    const N = 6
    for (let i = 0; i < N; i += 1) await addVehicle(h)
    counting.findByIdCalls = 0
    counting.findAllCalls = 0

    const candidates = await h.service.findSubstitutionCandidates(opCtxA, h.bookingId)

    expect(candidates).toHaveLength(N)
    // The N+1 signal: per-candidate findById is gone entirely.
    expect(counting.findByIdCalls).toBe(0)
    // Classes resolved once in a single batch read, not per candidate.
    expect(counting.findAllCalls).toBe(1)
  })

  it('preserves the same-ACRISS filter: keeps same-class peers, drops an off-class vehicle', async () => {
    const counting = new CountingVehicleClassRepository(new InMemoryVehicleClassRepository())
    const h = await setupSub(undefined, counting)
    const keep1 = await addVehicle(h)
    const keep2 = await addVehicle(h)
    await addVehicle(h, { classId: h.classB.id }) // different ACRISS -> excluded

    const candidates = await h.service.findSubstitutionCandidates(opCtxA, h.bookingId)
    const ids = (candidates ?? []).map((v) => v.id).sort()

    expect(ids).toEqual([keep1.id, keep2.id].sort())
    // Even with a mix of classes, lookups stay constant.
    expect(counting.findByIdCalls).toBe(0)
    expect(counting.findAllCalls).toBe(1)
  })
})

describe('BookingService lifecycle events (#392 §3.1)', () => {
  it('appends STATUS_CHANGED in the same tx when a booking transitions', async () => {
    const h = await setup({ codes: ['LIFE0001'] })
    const { vehicleId, locationId } = await seedReady(h)
    const created = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
      NOW,
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const res = await h.service.updateStatus(opCtxA, created.booking.id, 'ACTIVE')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.booking.status).toBe('ACTIVE')

    // Event log is the source of truth: create + the transition, in order.
    const events = await h.repos.bookingEventRepo.findByBookingId(
      SYSTEM_CONTEXT,
      created.booking.id,
    )
    expect(events.map((e) => e.type)).toEqual(['BOOKING_CREATED', 'STATUS_CHANGED'])
    expect(events[1]).toMatchObject({
      type: 'STATUS_CHANGED',
      actorId: opCtxA.userId,
      payload: { from: 'CONFIRMED', to: 'ACTIVE' },
    })
  })

  it('appends BOOKING_CANCELLED in the same tx when a booking is cancelled', async () => {
    const h = await setup({ codes: ['LIFE0002'] })
    const { vehicleId, locationId } = await seedReady(h)
    const created = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
      NOW,
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const res = await h.service.cancel(renterCtx, created.booking.id, null, NOW)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const events = await h.repos.bookingEventRepo.findByBookingId(
      SYSTEM_CONTEXT,
      created.booking.id,
    )
    expect(events.map((e) => e.type)).toEqual(['BOOKING_CREATED', 'BOOKING_CANCELLED'])
    expect(events[1]).toMatchObject({
      type: 'BOOKING_CANCELLED',
      actorId: RENTER,
      payload: {
        cancellationFee: res.cancellation.feeAmount,
        cancelledAt: NOW.toISOString(),
        // #868 3b: a cancel with no reason supplied records null, not a missing key.
        cancellationReason: null,
      },
    })
  })

  // #868 Slice 3b: an optional renter reason is captured into the BOOKING_CANCELLED
  // event payload (operator/analytics insight). It never affects the fee or whether
  // the cancel succeeds — only the audit record. Mutation guard: drop the reason in
  // cancel() and this fails (the payload would carry null instead of the object).
  it('records the renter cancellation reason in the BOOKING_CANCELLED payload (#868 3b)', async () => {
    const h = await setup({ codes: ['LIFE3B01'] })
    const { vehicleId, locationId } = await seedReady(h)
    const created = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
      NOW,
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const reason = { code: 'FOUND_ALTERNATIVE', note: 'cheaper nearby' } as const
    const res = await h.service.cancel(renterCtx, created.booking.id, reason, NOW)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const events = await h.repos.bookingEventRepo.findByBookingId(
      SYSTEM_CONTEXT,
      created.booking.id,
    )
    expect(events[1]).toMatchObject({
      type: 'BOOKING_CANCELLED',
      payload: { cancellationReason: { code: 'FOUND_ALTERNATIVE', note: 'cheaper nearby' } },
    })
  })

  // #679: the two routes to CANCELLED are intentionally divergent on FEE, not only
  // on notification. Renter self-cancel (cancel(), tiered fee — asserted above and in
  // the route suite) ALWAYS applies the cancellation schedule; operator cancel
  // (updateStatus -> CANCELLED) charges NOTHING. Operator non-delivery is the
  // operator's fault, so the renter is made whole, never penalised for it. Guards
  // against a "unify the two cancel paths" refactor silently charging renters.
  it('operator cancel via updateStatus charges no fee, unlike renter self-cancel (#679)', async () => {
    const h = await setup({ codes: ['LIFE0679'] })
    const { vehicleId, locationId } = await seedReady(h)
    const created = await h.service.create(
      renterCtx,
      createInput({
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
      }),
      NOW,
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    // Only updateStatus can cancel a non-CONFIRMED booking, so an operator cancels
    // by transitioning ACTIVE -> CANCELLED (the path #664 wired the email onto).
    await h.service.updateStatus(opCtxA, created.booking.id, 'ACTIVE')
    const cancelled = await h.service.updateStatus(opCtxA, created.booking.id, 'CANCELLED')
    expect(cancelled.ok).toBe(true)
    if (!cancelled.ok) return

    expect(cancelled.booking.status).toBe('CANCELLED')
    // No fee charged, and no fee breakdown returned — the renter owes nothing.
    expect(cancelled.booking.cancellationFee).toBeNull()
    expect('cancellation' in cancelled).toBe(false)
    // Audit trail diverges too: operator cancel appends STATUS_CHANGED, never the
    // fee-bearing BOOKING_CANCELLED that the renter path records.
    const events = await h.repos.bookingEventRepo.findByBookingId(
      SYSTEM_CONTEXT,
      created.booking.id,
    )
    expect(events.map((e) => e.type)).toEqual([
      'BOOKING_CREATED',
      'STATUS_CHANGED',
      'STATUS_CHANGED',
    ])
  })
})

describe('BookingService — renter lifecycle notifications (#664)', () => {
  // The post-commit seam is a spy. We assert each operator action hands off to it
  // with the correct trigger AFTER the write commits. setupSub seeds via create(),
  // which fires a CREATED dispatch — cleared so each test counts only its action.
  // The dispatcher's own routing + non-fatal behavior is covered in its suites.
  function spyPostCommit() {
    const run = vi.fn(async () => {})
    return { postCommit: { run } as unknown as BookingPostCommitDispatcher, run }
  }
  // A same-operator, same-class candidate at the seeded location (cf. setupSub).
  const addVehicle = (h: SubHarness) =>
    h.repos.vehicleRepo.create(
      SYSTEM_CONTEXT,
      vehicleData({ classId: h.classA.id, pickupLocationId: h.locationId, dailyRateJpy: 15000 }),
    )

  it('substitute hands off with the SUBSTITUTED trigger', async () => {
    const { postCommit, run } = spyPostCommit()
    const h = await setupSub(postCommit)
    run.mockClear()
    const replacement = await addVehicle(h)
    const result = await h.service.substitute(opCtxA, h.bookingId, replacement.id, 'maintenance')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(opCtxA, result.booking, 'SUBSTITUTED')
  })

  it('updateStatus maps ACTIVE -> ACTIVATED and COMPLETED -> COMPLETED', async () => {
    const { postCommit, run } = spyPostCommit()
    const h = await setupSub(postCommit)
    run.mockClear()
    const active = await h.service.updateStatus(opCtxA, h.bookingId, 'ACTIVE')
    expect(active.ok).toBe(true)
    if (!active.ok) return
    expect(run).toHaveBeenNthCalledWith(1, opCtxA, active.booking, 'ACTIVATED')
    const completed = await h.service.updateStatus(opCtxA, h.bookingId, 'COMPLETED')
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(run).toHaveBeenNthCalledWith(2, opCtxA, completed.booking, 'COMPLETED')
  })

  it('cancel hands off with the CANCELLED trigger', async () => {
    const { postCommit, run } = spyPostCommit()
    const h = await setupSub(postCommit)
    run.mockClear()
    const result = await h.service.cancel(renterCtx, h.bookingId, null, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(renterCtx, result.booking, 'CANCELLED')
  })

  // The renter cancel() path rejects non-CONFIRMED, so an operator cancelling an
  // ACTIVE booking can ONLY go through updateStatus -> CANCELLED. That path must
  // still reach the renter (the gap #664 closes), via STATUS_TRIGGER.
  it('operator cancelling an ACTIVE booking via updateStatus notifies CANCELLED', async () => {
    const { postCommit, run } = spyPostCommit()
    const h = await setupSub(postCommit)
    const active = await h.service.updateStatus(opCtxA, h.bookingId, 'ACTIVE')
    expect(active.ok).toBe(true)
    run.mockClear() // isolate the cancel step from create + activate
    const cancelled = await h.service.updateStatus(opCtxA, h.bookingId, 'CANCELLED')
    expect(cancelled.ok).toBe(true)
    if (!cancelled.ok) return
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(opCtxA, cancelled.booking, 'CANCELLED')
  })

  it('does not notify on a rejected action (no commit -> no email)', async () => {
    const { postCommit, run } = spyPostCommit()
    const h = await setupSub(postCommit)
    run.mockClear()
    const replacement = await addVehicle(h)
    // Operator B cannot touch operator A's booking -> 404, nothing commits.
    const result = await h.service.substitute(opCtxB, h.bookingId, replacement.id, null)
    expect(result.ok).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
})
