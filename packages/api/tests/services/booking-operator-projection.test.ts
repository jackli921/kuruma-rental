import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import type { RunInTransaction, TransactionRepos } from '../../src/repositories/types'
import { BookingService } from '../../src/services/booking'
import type { Booking } from '../../src/stores'

// §4h: the web confirmation page needs the operator's pre-auth URL, but it has no
// DB access and /operators/:id is management-gated. So BookingService.findById
// attaches a RENTER-SAFE projection — operator: { name, preAuthHandoffUrl } only.

const RENTER = 'renter-1'
const ownerCtx: CallerContext = { userId: RENTER, role: 'RENTER', bypassScope: false }
const strangerCtx: CallerContext = { userId: 'renter-2', role: 'RENTER', bypassScope: false }
const runInTransaction: RunInTransaction = async (fn) => fn({} as TransactionRepos)

function makeBooking(operatorId: string): Booking {
  const now = new Date('2026-07-01T00:00:00Z')
  return {
    id: 'bk-1',
    operatorId,
    renterId: RENTER,
    classId: 'cls-1',
    requestedVehicleId: 'veh-1',
    assignedVehicleId: 'veh-1',
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    startAt: now,
    endAt: now,
    effectiveEndAt: now,
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'SPECIFIC',
    bookingCode: 'ABCD2345',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 24000,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    createdAt: now,
    updatedAt: now,
  }
}

async function setup() {
  const operatorRepo = new InMemoryOperatorRepository()
  const operator = await operatorRepo.create({
    name: 'Best Car Rental',
    slug: 'bcr',
    preAuthHandoffUrl: 'https://pay.bestcarrental.jp/handoff/abc',
  })
  const booking = makeBooking(operator.id)
  const bookingRepo = new InMemoryBookingRepository(new Map([[booking.id, booking]]))
  const service = new BookingService(
    bookingRepo,
    runInTransaction,
    undefined,
    undefined,
    undefined,
    undefined,
    operatorRepo,
  )
  return { service, operator, booking }
}

describe('BookingService.findById operator projection (§4h)', () => {
  it('attaches operator { name, preAuthHandoffUrl } with the exact URL for the owner', async () => {
    const { service } = await setup()
    const result = await service.findById(ownerCtx, 'bk-1')
    expect(result?.operator).toEqual({
      name: 'Best Car Rental',
      preAuthHandoffUrl: 'https://pay.bestcarrental.jp/handoff/abc',
    })
  })

  it('projection includes ONLY name + preAuthHandoffUrl — no other operator fields leak', async () => {
    const { service } = await setup()
    const result = await service.findById(ownerCtx, 'bk-1')
    expect(Object.keys(result?.operator ?? {}).sort()).toEqual(['name', 'preAuthHandoffUrl'])
  })

  it('keeps slice-6 scope intact — a non-owner renter still gets undefined (404)', async () => {
    const { service } = await setup()
    expect(await service.findById(strangerCtx, 'bk-1')).toBeUndefined()
  })
})
