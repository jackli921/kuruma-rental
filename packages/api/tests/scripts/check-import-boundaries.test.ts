import { describe, expect, it } from 'vitest'

import { checkContent } from '../../scripts/check-import-boundaries'

const CONSTRUCT_RULE = /Concrete repositories.*only be constructed/

describe('check-import-boundaries — construction rule (#721)', () => {
  it('flags constructing a concrete repository in a service file', () => {
    const content = [
      'export function wire() {',
      '  return new DrizzleBookingRepository(db)',
      '}',
    ].join('\n')

    const violations = checkContent('services/booking-service.ts', content)

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: 'services/booking-service.ts',
      line: 2,
      rule: expect.stringMatching(CONSTRUCT_RULE),
    })
  })

  it('flags constructing a concrete in a NON-transaction file under repositories/drizzle', () => {
    const content = 'const repo = new DrizzleVehicleRepository(db)'

    const violations = checkContent('repositories/drizzle/booking.ts', content)

    expect(violations.map((v) => v.rule)).toContainEqual(expect.stringMatching(CONSTRUCT_RULE))
  })

  it('allows the sanctioned transaction factories to construct tx-bound concretes', () => {
    const txBody = [
      'vehicleRepo: new DrizzleVehicleRepository(txDb),',
      'bookingRepo: new DrizzleBookingRepository(txDb),',
    ].join('\n')

    expect(checkContent('repositories/drizzle/transaction.ts', txBody)).toEqual([])
    expect(
      checkContent(
        'repositories/drizzle/operator-grant-transaction.ts',
        'users: new DrizzleUserRepository(txDb),',
      ),
    ).toEqual([])
  })

  it('allows the composition root to construct concretes', () => {
    expect(checkContent('index.ts', 'const r = new DrizzleBookingRepository(db)')).toEqual([])
    expect(
      checkContent('composition/repositories.ts', 'const r = new InMemoryBookingRepository()'),
    ).toEqual([])
  })

  it('exempts test files from the construction rule', () => {
    expect(
      checkContent('services/foo.test.ts', 'const r = new DrizzleBookingRepository(db)'),
    ).toEqual([])
  })

  it('does not flag benign non-repository constructors (rule is prefix-anchored)', () => {
    const content = [
      'const now = new Date()',
      'const seen = new Map()',
      'const res = new Response()',
    ].join('\n')

    expect(checkContent('services/booking-service.ts', content)).toEqual([])
  })

  it('still flags a route importing a concrete repository (existing Rule 1 unbroken)', () => {
    const content = "import { DrizzleBookingRepository } from '../repositories/drizzle/booking'"

    const violations = checkContent('routes/bookings.ts', content)

    expect(violations.map((v) => v.rule)).toContainEqual(
      expect.stringMatching(/must not import concrete repositories/),
    )
  })
})

describe('check-import-boundaries — routes/repositories type boundary (#726)', () => {
  const ROUTE_TYPES_RULE = /Routes must not import from repositories\/types/

  it('flags a service-backed route importing a filter type from repositories/types', () => {
    const content = "import type { BookingFilters } from '../repositories/types'"

    const violations = checkContent('routes/bookings.ts', content)

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: 'routes/bookings.ts',
      line: 1,
      rule: expect.stringMatching(ROUTE_TYPES_RULE),
    })
  })

  it('allows DI-repo carve-out routes to import from repositories/types (transitional, path-wide)', () => {
    expect(
      checkContent(
        'routes/regions.ts',
        "import type { RegionRepository } from '../repositories/types'",
      ),
    ).toEqual([])
    expect(
      checkContent(
        'routes/stats.ts',
        "import type { StatsRepository } from '../repositories/types'",
      ),
    ).toEqual([])
    expect(
      checkContent(
        'routes/vehicles.ts',
        "import type { Vehicle, VehicleFilters, VehicleRepository } from '../repositories/types'",
      ),
    ).toEqual([])
  })

  it('still flags a concrete repository import even in a carve-out route', () => {
    const violations = checkContent(
      'routes/vehicles.ts',
      "import { DrizzleVehicleRepository } from '../repositories/drizzle/vehicle'",
    )

    expect(violations.map((v) => v.rule)).toContainEqual(
      expect.stringMatching(/must not import concrete repositories/),
    )
  })

  it('flags a formatter-wrapped (multiline) filter import in a service-backed route', () => {
    const content = ['import type {', '  BookingFilters,', "} from '../repositories/types'"].join(
      '\n',
    )

    const violations = checkContent('routes/bookings.ts', content)

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: 'routes/bookings.ts',
      line: 1,
      rule: expect.stringMatching(ROUTE_TYPES_RULE),
    })
  })

  it('flags a formatter-wrapped (multiline) concrete repository import in a route', () => {
    const content = [
      'import {',
      '  DrizzleBookingRepository,',
      "} from '../repositories/drizzle/booking'",
    ].join('\n')

    expect(checkContent('routes/bookings.ts', content).map((v) => v.rule)).toContainEqual(
      expect.stringMatching(/must not import concrete repositories/),
    )
  })

  it('exempts the whole repositories/types path for transitional carve-out routes', () => {
    // Carve-out is deliberately path-wide (not *Repository-only): these 3 routes
    // are mid-migration and get full enforcement once their service lands (#726).
    expect(
      checkContent('routes/vehicles.ts', "import type { Vehicle } from '../repositories/types'"),
    ).toEqual([])
  })
})
