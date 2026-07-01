import { describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../middleware/auth'
import { PG_ERROR, pgConstraintName, pgErrorCode } from '../../pg-errors'
import type { Booking } from '../../stores'
import { InMemoryBookingRepository } from './booking'

// A CONFIRMED booking create-input (settlement is server-derived, so it is not a
// create field — the repo stamps the 'ADVISORY' default, mirroring the DB column).
function confirmedInput(
  overrides: Partial<
    Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'cancellationFeeSettlement'>
  > = {},
): Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'cancellationFeeSettlement'> {
  return {
    operatorId: 'op-1',
    renterId: 'renter-1',
    classId: 'class-1',
    requestedVehicleId: 'veh-1',
    assignedVehicleId: 'veh-1',
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    startAt: new Date('2026-08-01T09:00:00Z'),
    endAt: new Date('2026-08-01T17:00:00Z'),
    effectiveEndAt: new Date('2026-08-01T17:00:00Z'),
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'SPECIFIC',
    bookingCode: 'BK-3A-1',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 30_000,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
    ...overrides,
  }
}

// Float fixture base for needsAssignment tests: CLASS_COMBO, no assigned vehicle.
function floatInput(
  overrides: Partial<
    Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'cancellationFeeSettlement'>
  > = {},
): Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'cancellationFeeSettlement'> {
  return {
    operatorId: 'op-1',
    renterId: 'renter-1',
    classId: 'class-1',
    requestedVehicleId: null,
    assignedVehicleId: null,
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    startAt: new Date('2027-10-01T09:00:00Z'),
    endAt: new Date('2027-10-01T17:00:00Z'),
    effectiveEndAt: new Date('2027-10-01T17:00:00Z'),
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'CLASS_COMBO',
    bookingCode: 'FLOAT-001',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: null,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
    ...overrides,
  }
}

describe('InMemoryBookingRepository — needsAssignment filter (#464)', () => {
  it('returns only CONFIRMED+ACTIVE CLASS_COMBO floats with no assigned vehicle', async () => {
    const repo = new InMemoryBookingRepository()

    // Eligible #1: CLASS_COMBO, CONFIRMED, no assigned vehicle
    const floatConfirmed = await repo.create(
      SYSTEM_CONTEXT,
      floatInput({
        bookingCode: 'FLOAT-001',
        status: 'CONFIRMED',
        startAt: new Date('2027-10-01T09:00:00Z'),
        endAt: new Date('2027-10-01T17:00:00Z'),
        effectiveEndAt: new Date('2027-10-01T17:00:00Z'),
      }),
    )

    // Eligible #2: CLASS_COMBO, ACTIVE, no assigned vehicle — different window to avoid null-null overlap
    const floatActive = await repo.create(
      SYSTEM_CONTEXT,
      floatInput({
        bookingCode: 'FLOAT-002',
        status: 'ACTIVE',
        startAt: new Date('2027-10-02T09:00:00Z'),
        endAt: new Date('2027-10-02T17:00:00Z'),
        effectiveEndAt: new Date('2027-10-02T17:00:00Z'),
      }),
    )

    // NOT eligible: CLASS_COMBO, CANCELLED, no assigned vehicle
    await repo.create(
      SYSTEM_CONTEXT,
      floatInput({
        bookingCode: 'FLOAT-003',
        status: 'CANCELLED',
        startAt: new Date('2027-10-03T09:00:00Z'),
        endAt: new Date('2027-10-03T17:00:00Z'),
        effectiveEndAt: new Date('2027-10-03T17:00:00Z'),
      }),
    )

    // NOT eligible: CLASS_COMBO, CONFIRMED, already has an assigned vehicle
    await repo.create(
      SYSTEM_CONTEXT,
      floatInput({
        bookingCode: 'FLOAT-004',
        status: 'CONFIRMED',
        assignedVehicleId: 'veh-combo',
        startAt: new Date('2027-10-04T09:00:00Z'),
        endAt: new Date('2027-10-04T17:00:00Z'),
        effectiveEndAt: new Date('2027-10-04T17:00:00Z'),
      }),
    )

    // NOT eligible: SPECIFIC booking, CONFIRMED, has assigned vehicle
    await repo.create(
      SYSTEM_CONTEXT,
      floatInput({
        bookingCode: 'FLOAT-005',
        fulfillmentMode: 'SPECIFIC',
        requestedVehicleId: 'veh-1',
        assignedVehicleId: 'veh-1',
        status: 'CONFIRMED',
        startAt: new Date('2027-10-05T09:00:00Z'),
        endAt: new Date('2027-10-05T17:00:00Z'),
        effectiveEndAt: new Date('2027-10-05T17:00:00Z'),
      }),
    )

    const results = await repo.findAll(SYSTEM_CONTEXT, { needsAssignment: true })
    const returnedIds = results.map((b) => b.id).sort()

    expect(returnedIds).toEqual([floatConfirmed.id, floatActive.id].sort())
  })
})

describe('InMemoryBookingRepository — bypass-gated operatorId narrowing (#1230 slice 5a)', () => {
  const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
  const operatorA: CallerContext = { userId: 'ua', role: 'OPERATOR_OWNER', operatorId: 'op-A' }
  const renter: CallerContext = { userId: 'r1', role: 'RENTER' }

  // Two bookings, one per operator, both owned by renter r1. Distinct vehicles +
  // windows so neither the exclusion guard nor bookingCode uniqueness trips.
  async function seedTwoOperators(repo: InMemoryBookingRepository) {
    const a = await repo.create(
      SYSTEM_CONTEXT,
      confirmedInput({
        operatorId: 'op-A',
        renterId: 'r1',
        assignedVehicleId: 'veh-A',
        requestedVehicleId: 'veh-A',
        bookingCode: 'BK-A',
        startAt: new Date('2026-08-01T09:00:00Z'),
        endAt: new Date('2026-08-01T17:00:00Z'),
        effectiveEndAt: new Date('2026-08-01T17:00:00Z'),
      }),
    )
    const b = await repo.create(
      SYSTEM_CONTEXT,
      confirmedInput({
        operatorId: 'op-B',
        renterId: 'r1',
        assignedVehicleId: 'veh-B',
        requestedVehicleId: 'veh-B',
        bookingCode: 'BK-B',
        startAt: new Date('2026-08-02T09:00:00Z'),
        endAt: new Date('2026-08-02T17:00:00Z'),
        effectiveEndAt: new Date('2026-08-02T17:00:00Z'),
      }),
    )
    return { a, b }
  }

  it('narrows an all-scope admin to the requested operator', async () => {
    const repo = new InMemoryBookingRepository()
    const { a } = await seedTwoOperators(repo)
    const results = await repo.findAll(admin, { operatorId: 'op-A' })
    expect(results.map((x) => x.id)).toEqual([a.id])
  })

  it('ignores a foreign operatorId for a tenant-scoped operator (never widens across tenants)', async () => {
    const repo = new InMemoryBookingRepository()
    const { a } = await seedTwoOperators(repo)
    // operatorA passes a foreign op-B; the scope clamp keeps them on op-A only.
    const results = await repo.findAll(operatorA, { operatorId: 'op-B' })
    expect(results.map((x) => x.id)).toEqual([a.id])
  })

  it('ignores operatorId for a renter (their private read is not narrowed)', async () => {
    const repo = new InMemoryBookingRepository()
    const { a, b } = await seedTwoOperators(repo)
    // r1 owns both bookings; a stray operatorId must not narrow a non-bypass read.
    const results = await repo.findAll(renter, { operatorId: 'op-A' })
    expect(results.map((x) => x.id).sort()).toEqual([a.id, b.id].sort())
  })
})

describe('InMemoryBookingRepository — cancellation fee settlement (#868 Slice 3a)', () => {
  it('stamps a fresh booking with settlement ADVISORY (the column default)', async () => {
    const repo = new InMemoryBookingRepository()

    const booking = await repo.create(SYSTEM_CONTEXT, confirmedInput())

    expect(booking.cancellationFeeSettlement).toBe('ADVISORY')
  })

  it('records the fee but leaves settlement ADVISORY on cancel — money moves in #851, not here', async () => {
    const repo = new InMemoryBookingRepository()
    const booking = await repo.create(SYSTEM_CONTEXT, confirmedInput())

    const cancelled = await repo.cancel(SYSTEM_CONTEXT, booking.id, {
      from: 'CONFIRMED',
      fee: 9_000,
      cancelledAt: new Date('2026-07-30T12:00:00Z'),
    })

    expect(cancelled?.status).toBe('CANCELLED')
    expect(cancelled?.cancellationFee).toBe(9_000)
    // The fee is advisory: recorded for audit, zero money moved until #851.
    expect(cancelled?.cancellationFeeSettlement).toBe('ADVISORY')
  })
})

describe('InMemoryBookingRepository — CLASS_COMBO float exclusion parity (#1117 / audit H1)', () => {
  const window = {
    startAt: new Date('2026-08-01T09:00:00Z'),
    endAt: new Date('2026-08-01T17:00:00Z'),
    effectiveEndAt: new Date('2026-08-01T17:00:00Z'),
  }
  const comboFloat = (bookingCode: string) =>
    confirmedInput({
      ...window,
      fulfillmentMode: 'CLASS_COMBO',
      requestedVehicleId: null,
      assignedVehicleId: null,
      bookingCode,
    })

  // Postgres `EXCLUDE USING gist ("assignedVehicleId" WITH =, ...)` never conflicts
  // NULL keys, so two overlapping combo floats both insert in prod. The InMemory
  // mirror must admit them too, or dev + every in-memory test diverges from prod.
  it('admits two time-overlapping null-vehicle combo floats, matching Postgres NULL-exclusion', async () => {
    const repo = new InMemoryBookingRepository()

    const first = await repo.create(SYSTEM_CONTEXT, comboFloat('BK-COMBO-1'))
    const second = await repo.create(SYSTEM_CONTEXT, comboFloat('BK-COMBO-2'))

    expect(first.assignedVehicleId).toBeNull()
    expect(second.assignedVehicleId).toBeNull()
    expect(second.id).not.toBe(first.id)
  })

  // The fix must stay surgical: a real assigned vehicle still excludes on overlap.
  // Assert by (code, constraint_name) rather than message — matches the
  // conformance-suite contract (#1106) and stays mutation-resistant if the
  // postgres-js message format evolves.
  it('still rejects two overlapping bookings on the SAME assigned vehicle', async () => {
    const repo = new InMemoryBookingRepository()
    await repo.create(SYSTEM_CONTEXT, confirmedInput({ ...window, bookingCode: 'BK-SPEC-1' }))

    let caught: unknown
    try {
      await repo.create(SYSTEM_CONTEXT, confirmedInput({ ...window, bookingCode: 'BK-SPEC-2' }))
    } catch (err) {
      caught = err
    }

    expect(caught).toBeDefined()
    expect(pgErrorCode(caught)).toBe(PG_ERROR.EXCLUSION_VIOLATION)
    expect(pgConstraintName(caught)).toBe('bookings_no_overlap')
  })
})
