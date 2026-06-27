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

  it('allows sanctioned thin-read routes (regions/stats) to DI their *Repository interface', () => {
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
  })

  it('still flags a concrete repository import in any route', () => {
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

  it('enforces vehicles.ts now that VehicleService has landed (#819)', () => {
    // The path-wide types exemption is gone: vehicles.ts joined the enforced set
    // when its business policy moved into VehicleService. An entity import is now
    // a violation, exactly like any other service-backed route.
    const violations = checkContent(
      'routes/vehicles.ts',
      "import type { Vehicle } from '../repositories/types'",
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: 'routes/vehicles.ts',
      line: 1,
      rule: expect.stringMatching(ROUTE_TYPES_RULE),
    })
  })
})

describe('check-import-boundaries — #692 sanctioned thin-read enforcement', () => {
  const TYPES_RULE = /Routes must not import from repositories\/types/
  const THIN_READ_RULE = /Sanctioned thin-read routes/

  it('allows a sanctioned thin-read route to DI only its *Repository interface', () => {
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
  })

  it('flags a sanctioned thin-read route importing a non-Repository entity/filter type', () => {
    // A thin read needs only the repo contract it is DI'd. Pulling an entity or
    // filter type is query-shaping that belongs in a service — the sanction must
    // not let a thin route quietly grow fat behind the carve-out (#692).
    const violations = checkContent(
      'routes/regions.ts',
      "import type { RegionNode } from '../repositories/types'",
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: 'routes/regions.ts',
      line: 1,
      rule: expect.stringMatching(THIN_READ_RULE),
    })
  })

  it('flags a sanctioned thin-read route mixing its *Repository with an entity type', () => {
    const violations = checkContent(
      'routes/stats.ts',
      "import type { StatsRepository, DashboardStats } from '../repositories/types'",
    )
    expect(violations.map((v) => v.rule)).toContainEqual(expect.stringMatching(THIN_READ_RULE))
  })

  it('keys the *Repository check on the imported symbol, not its local alias', () => {
    // The guard must read the source name (`X` in `X as Y`), never the binding —
    // otherwise an entity aliased `as FooRepository` would launder past the gate.
    const smuggled = checkContent(
      'routes/regions.ts',
      "import type { RegionNode as FakeRepository } from '../repositories/types'",
    )
    expect(smuggled).toHaveLength(1)
    expect(smuggled[0]).toMatchObject({ rule: expect.stringMatching(THIN_READ_RULE) })
  })

  it('allows a *Repository interface aliased to a non-Repository local name', () => {
    expect(
      checkContent(
        'routes/regions.ts',
        "import type { RegionRepository as RegionData } from '../repositories/types'",
      ),
    ).toEqual([])
  })

  it('blocks vehicles.ts from importing entity/filter types now its service has landed (#819)', () => {
    // The mixed entity/filter/Repository import vehicles.ts used to be granted is
    // now a single violation — it is a fully enforced route, not a carve-out.
    const violations = checkContent(
      'routes/vehicles.ts',
      "import type { Vehicle, VehicleFilters, VehicleRepository } from '../repositories/types'",
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ rule: expect.stringMatching(TYPES_RULE) })
  })

  it('still blocks an ordinary (non-carve-out) route from importing repositories/types', () => {
    // The *Repository-only allowance is scoped to the sanctioned routes; every
    // other route sources filter/entity types from the service layer.
    const violations = checkContent(
      'routes/bookings.ts',
      "import type { BookingRepository } from '../repositories/types'",
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ rule: expect.stringMatching(TYPES_RULE) })
  })
})

describe('check-import-boundaries — routes must not import persistence entities from ../stores (#1213)', () => {
  // stores.ts is the types-only persistence-entity barrel ("the shared contract
  // between repositories and routes"). A route gets an already-projected DTO from
  // its service, so an entity import is a toView/cast leak that belongs in the
  // service — the #1164 payment-anomalies fix, now enforced rather than manual.
  const STORES_RULE = /Routes must not import persistence entity types from \.\.\/stores/

  it('flags a route importing an entity type from ../stores', () => {
    const violations = checkContent(
      'routes/fee-schedules.ts',
      "import type { FeeSchedule } from '../stores'",
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: 'routes/fee-schedules.ts',
      line: 1,
      rule: expect.stringMatching(STORES_RULE),
    })
  })

  it('flags a formatter-wrapped (multiline) ../stores entity import in a route', () => {
    const content = ['import type {', '  AddOn,', "} from '../stores'"].join('\n')

    const violations = checkContent('routes/add-ons.ts', content)

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ line: 1, rule: expect.stringMatching(STORES_RULE) })
  })

  it('allows a SERVICE to import entity types from ../stores (only routes are blocked)', () => {
    expect(
      checkContent('services/fee-schedule.ts', "import type { FeeSchedule } from '../stores'"),
    ).toEqual([])
  })

  it('does not flag a route importing a projected DTO type from its service', () => {
    expect(
      checkContent(
        'routes/fee-schedules.ts',
        "import type { FeeScheduleUpdate } from '../services/fee-schedule'",
      ),
    ).toEqual([])
  })

  it('exempts test files from the ../stores rule', () => {
    expect(
      checkContent('routes/fee-schedules.test.ts', "import type { FeeSchedule } from '../stores'"),
    ).toEqual([])
  })
})
