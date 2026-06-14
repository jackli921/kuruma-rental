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
