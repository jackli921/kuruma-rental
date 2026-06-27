import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../../middleware/auth'
import { SYSTEM_CONTEXT } from '../../middleware/auth'
import type { Booking } from '../../stores'
import { InMemoryBookingRepository } from './booking'

// #1119: a PARTNER (Trip.com) key must read ONLY the bookings it sourced
// (source = TRIP_COM), never operators' DIRECT/walk-in bookings.
const PARTNER: CallerContext = { userId: 'trip-com', role: 'PARTNER', bypassScope: true }

type CreateInput = Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'cancellationFeeSettlement'>

function bookingInput(overrides: Partial<CreateInput> = {}): CreateInput {
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
    bookingCode: 'BK-1',
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

async function seedTwo() {
  const repo = new InMemoryBookingRepository()
  const tripCom = await repo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: 'op-1',
      source: 'TRIP_COM',
      assignedVehicleId: 'veh-a',
      bookingCode: 'BK-TRIP',
    }),
  )
  const direct = await repo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: 'op-2',
      source: 'DIRECT',
      assignedVehicleId: 'veh-b',
      bookingCode: 'BK-DIRECT',
    }),
  )
  return { repo, tripCom, direct }
}

describe('InMemoryBookingRepository — PARTNER scope (#1119)', () => {
  it('findAll returns only TRIP_COM-sourced bookings for a PARTNER', async () => {
    const { repo, tripCom } = await seedTwo()
    const rows = await repo.findAll(PARTNER)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(tripCom.id)
    expect(rows[0]?.source).toBe('TRIP_COM')
  })

  it('findById hides another operator DIRECT booking from a PARTNER', async () => {
    const { repo, direct } = await seedTwo()
    expect(await repo.findById(PARTNER, direct.id)).toBeUndefined()
  })

  it('findById returns the PARTNER own TRIP_COM booking', async () => {
    const { repo, tripCom } = await seedTwo()
    const found = await repo.findById(PARTNER, tripCom.id)
    expect(found?.id).toBe(tripCom.id)
  })

  it('PLATFORM_ADMIN still sees every operator booking', async () => {
    const { repo } = await seedTwo()
    const rows = await repo.findAll(SYSTEM_CONTEXT)
    expect(rows).toHaveLength(2)
  })
})
