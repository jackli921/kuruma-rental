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
import type { RunInTransaction, TransactionRepos } from '../../src/repositories/types'
import {
  BookingService,
  type BookingVerificationGate,
  type CreateBookingInput,
} from '../../src/services/booking'
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
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
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

describe('BookingService.create — document-verification gate (#459)', () => {
  const staffCtx: CallerContext = { userId: 'staff-9', role: 'STAFF', bypassScope: true }

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
    const staffCtx: CallerContext = { userId: 'staff-9', role: 'STAFF', bypassScope: true }

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
async function setupSub(): Promise<SubHarness> {
  const events: BookingEvent[] = []
  const bookingRepo = new InMemoryBookingRepository()
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
  }
  const runInTransaction: RunInTransaction = async (fn) => fn(repos)
  const service = new BookingService(
    bookingRepo,
    runInTransaction,
    vehicleRepo,
    userRepo,
    vehicleClassRepo,
    undefined,
    undefined,
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

    const res = await h.service.cancel(renterCtx, created.booking.id, NOW)
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
      payload: { cancellationFee: res.cancellation.feeAmount, cancelledAt: NOW.toISOString() },
    })
  })
})
