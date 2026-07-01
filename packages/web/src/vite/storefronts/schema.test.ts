import { describe, expect, it } from 'vitest'
import { storefrontDetailResultSchema, storefrontSearchResultSchema } from './schema'

// #1085 slice 5: pin the new wire fields the storefront pages need to drive a
// review-aggregate fetch. The schemas are the single source of truth on the web
// side (`AvailableVehicleData` / `StorefrontSummaryData` are inferred from them),
// so a mismatch with the API producer surfaces here at parse time — not deep in
// a render path with a TS error and `undefined`-rendered badges.

const validVehicle = {
  id: 'veh_1',
  classId: 'cls_1',
  name: 'Yaris',
  make: 'Toyota',
  model: 'Yaris',
  year: 2024,
  seats: 4,
  luggageCapacity: 2,
  luggageSize: 'MEDIUM',
  transmission: 'AUTO',
  acrissCode: 'CCAR',
  classLabel: 'Compact',
  dailyRateJpy: 8000,
  hourlyRateJpy: 800,
  photos: [] as string[],
}

const validSummary = {
  locationId: 'loc_1',
  operatorId: 'op_1',
  name: 'Namba',
  address: '1-1',
  operatorName: 'Best Car Rental',
  operatingHours: { openTime: '09:00', closeTime: '20:00' },
  turnaroundMinutes: 60,
}

describe('storefrontDetailResultSchema — #1085 slice 5 wire extensions', () => {
  it('parses a summary carrying the new operatorId', () => {
    const parsed = storefrontDetailResultSchema.parse({
      storefront: validSummary,
      vehicles: [validVehicle],
      nextCursor: null,
    })
    expect(parsed.storefront.operatorId).toBe('op_1')
    expect(parsed.vehicles[0]?.classId).toBe('cls_1')
  })

  it('parses a vehicle with classId=null (classless vehicle path)', () => {
    const parsed = storefrontDetailResultSchema.parse({
      storefront: validSummary,
      vehicles: [{ ...validVehicle, classId: null }],
      nextCursor: null,
    })
    // null is the explicit "no class -> no class aggregate" signal; the UI must
    // skip the badge entirely instead of fetching with a null key.
    expect(parsed.vehicles[0]?.classId).toBeNull()
  })

  it('rejects a summary missing operatorId', () => {
    const { operatorId: _, ...withoutOp } = validSummary
    const result = storefrontDetailResultSchema.safeParse({
      storefront: withoutOp,
      vehicles: [validVehicle],
      nextCursor: null,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a vehicle missing classId entirely (null is fine, absent is not)', () => {
    const { classId: _, ...withoutClass } = validVehicle
    const result = storefrontDetailResultSchema.safeParse({
      storefront: validSummary,
      vehicles: [withoutClass],
      nextCursor: null,
    })
    expect(result.success).toBe(false)
  })
})

describe('storefrontSearchResultSchema — pre-existing operatorId still pinned', () => {
  it('still parses a search result whose cards already carried operatorId (#391)', () => {
    // Sanity check that adding operatorId to the DETAIL summary did not
    // inadvertently change the search-list schema (which had it since #391).
    const parsed = storefrontSearchResultSchema.parse({
      storefronts: [
        {
          locationId: 'loc_1',
          operatorId: 'op_1',
          operatorName: 'Best',
          name: 'Namba',
          address: '1-1',
          operatingHours: null,
          turnaroundMinutes: 60,
          classSummaries: [],
          fromDailyPriceJpy: null,
          fromHourlyPriceJpy: null,
          representativePhotos: [],
          latitude: null,
          longitude: null,
        },
      ],
      nextCursor: null,
    })
    expect(parsed.storefronts[0]?.operatorId).toBe('op_1')
  })
})
