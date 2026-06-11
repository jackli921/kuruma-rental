import { beforeEach, describe, expect, it } from 'vitest'

import { mintSessionToken, verifySessionCookie } from '../../src/middleware/auth'
import { TEST_AUTH_SECRET } from '../helpers/auth'

// #521 §6/§8: a granted operator's session JWT carries operatorSlug so the web
// /manage/$slug guard can match the URL segment. operatorId scopes API authz;
// operatorSlug is session metadata (NOT an authz field, so it never widens any
// access check). These pin the mint -> verifySessionCookie round-trip so the two
// halves of the session contract can't drift on the new claim.
describe('session token operatorSlug round-trip', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = TEST_AUTH_SECRET
  })

  it('carries operatorSlug from mint through verifySessionCookie', async () => {
    const token = await mintSessionToken(
      {
        sub: 'u1',
        role: 'OPERATOR_OWNER',
        csrf: 'c1',
        operatorId: 'op1',
        operatorSlug: 'acme-2',
      },
      TEST_AUTH_SECRET,
    )
    const session = await verifySessionCookie(token)
    expect(session?.user.id).toBe('u1')
    expect(session?.user.role).toBe('OPERATOR_OWNER')
    expect(session?.user.operatorId).toBe('op1')
    expect(session?.operatorSlug).toBe('acme-2')
  })

  it('omits operatorSlug when none was minted (renter session)', async () => {
    const token = await mintSessionToken(
      { sub: 'u2', role: 'RENTER', csrf: 'c2' },
      TEST_AUTH_SECRET,
    )
    const session = await verifySessionCookie(token)
    expect(session?.user.operatorId).toBeUndefined()
    expect(session?.operatorSlug).toBeUndefined()
  })
})
