import { describe, expect, it } from 'vitest'
import {
  BEST_CAR_RENTAL_OPERATOR_ID,
  BEST_CAR_RENTAL_OWNER_EMAIL,
  SECOND_OPERATOR_ID,
  SECOND_OPERATOR_NAME,
  SECOND_OPERATOR_OWNER_EMAIL,
  SECOND_OPERATOR_SLUG,
  SECOND_RENTER_EMAIL,
  SECOND_RENTER_ID,
} from '../../src/db/constants'
import { DEMO_RENTERS } from '../../src/db/seed-data/bookings'
import { DEMO_OPERATORS } from '../../src/db/seed-data/operators'

// #654: the multi-actor real-DB harness resolves its SECOND tenant + SECOND
// renter through these constants (integration `global-setup` seeds the operator
// by id; the e2e harness mints a token off the owner email). If a constant ever
// drifts from the seed fixture it silently scopes a fixture/token to an operator
// that does not exist — a 404 with no error, the exact "flaky email coupling"
// the issue calls out. Pin both sides to ONE source and prove they stay wired.
describe('harness actors are single-sourced into the seed (#654)', () => {
  it('the second-operator constants ARE the Kansai Drive seed fixture', () => {
    const op = DEMO_OPERATORS.find((o) => o.id === SECOND_OPERATOR_ID)
    expect(op).toMatchObject({
      id: SECOND_OPERATOR_ID,
      slug: SECOND_OPERATOR_SLUG,
      name: SECOND_OPERATOR_NAME,
      owner: { email: SECOND_OPERATOR_OWNER_EMAIL },
    })
  })

  it('the second-renter constants ARE a seeded renter fixture', () => {
    const renter = DEMO_RENTERS.find((r) => r.id === SECOND_RENTER_ID)
    expect(renter).toMatchObject({ id: SECOND_RENTER_ID, email: SECOND_RENTER_EMAIL })
  })

  it('the two harness tenants are distinct with unique owner logins', () => {
    expect(SECOND_OPERATOR_ID).not.toBe(BEST_CAR_RENTAL_OPERATOR_ID)
    expect(SECOND_OPERATOR_OWNER_EMAIL).not.toBe(BEST_CAR_RENTAL_OWNER_EMAIL)
    const ownerEmails = DEMO_OPERATORS.map((o) => o.owner.email)
    expect(new Set(ownerEmails).size).toBe(ownerEmails.length)
    expect(ownerEmails).toEqual(
      expect.arrayContaining([BEST_CAR_RENTAL_OWNER_EMAIL, SECOND_OPERATOR_OWNER_EMAIL]),
    )
  })

  it('every demo renter email is @example.test (reserved domain: the destructive renter cleanup never deletes a real user)', () => {
    for (const renter of DEMO_RENTERS) {
      expect(renter.email).toMatch(/@example\.test$/)
    }
  })
})
