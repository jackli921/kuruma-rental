import { describe, expect, it } from 'vitest'
import { seedId } from '../../src/db/seed-id'
import { createBookingSchema } from '../../src/validators/booking'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('seedId', () => {
  it('is deterministic for the same slug', () => {
    expect(seedId('loc_best_kix')).toBe(seedId('loc_best_kix'))
  })

  it('produces a valid v4-shaped UUID', () => {
    expect(seedId('veh_best_compact_03')).toMatch(UUID_RE)
  })

  it('maps distinct slugs to distinct ids', () => {
    const ids = [
      'op_best_car_rental',
      'loc_best_kix',
      'veh_best_compact_03',
      'cls_best_compact',
    ].map(seedId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('passes the booking schema uuid() guard that raw slugs fail', () => {
    // This is the exact constraint the demo seed must satisfy for the live
    // booking POST to accept a seeded vehicle/location (the #390 E2E book step).
    const base = {
      startAt: '2026-07-15T01:00:00.000Z',
      endAt: '2026-07-17T01:00:00.000Z',
    }
    const slugs = {
      requestedVehicleId: 'veh_best_compact_03',
      pickupLocationId: 'loc_best_kix',
      dropoffLocationId: 'loc_best_kix',
    }
    expect(createBookingSchema.safeParse({ ...base, ...slugs }).success).toBe(false)
    expect(
      createBookingSchema.safeParse({
        ...base,
        requestedVehicleId: seedId(slugs.requestedVehicleId),
        pickupLocationId: seedId(slugs.pickupLocationId),
        dropoffLocationId: seedId(slugs.dropoffLocationId),
      }).success,
    ).toBe(true)
  })
})
