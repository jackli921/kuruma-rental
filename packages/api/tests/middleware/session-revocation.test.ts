import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  type AuthUser,
  provideOperatorSessionRevocation,
  requireAuth,
} from '../../src/middleware/auth'
import { setupAuthEnv, signTestJwt } from '../helpers/auth'

// #939: requireAuth must reject an operator-role token whose membership has been
// revoked since the JWT was minted (a deactivated staff member keeps a valid
// signature for <=7d). The revocation check is supplied per request by
// provideOperatorSessionRevocation; requireAuth consults it only for operator
// roles so renter/admin traffic does no extra work.
function appWith(revoked: (user: AuthUser) => Promise<boolean>): Hono {
  const a = new Hono()
  a.use('*', provideOperatorSessionRevocation(revoked))
  a.use('*', requireAuth())
  a.get('/x', (c) => c.json({ ok: true }))
  return a
}

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } })

beforeEach(setupAuthEnv)

describe('requireAuth operator session revocation (#939)', () => {
  it('401s an operator token when the revocation check reports revoked', async () => {
    const token = await signTestJwt({ sub: 'u1', role: 'OPERATOR_STAFF', operatorId: 'op_best' })
    const res = await appWith(async () => true).request('/x', bearer(token))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('passes an operator token whose session is still active', async () => {
    const token = await signTestJwt({ sub: 'u1', role: 'OPERATOR_STAFF', operatorId: 'op_best' })
    const res = await appWith(async () => false).request('/x', bearer(token))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('never consults the revocation check for a renter token (no extra read)', async () => {
    let consulted = false
    const token = await signTestJwt({ sub: 'r1', role: 'RENTER' })
    const res = await appWith(async (user) => {
      consulted = true
      void user
      return true
    }).request('/x', bearer(token))
    expect(res.status).toBe(200)
    expect(consulted).toBe(false)
  })

  it('passes operator traffic when no revocation check is provided (fail-open is opt-in)', async () => {
    const token = await signTestJwt({ sub: 'u1', role: 'OPERATOR_OWNER', operatorId: 'op_best' })
    const bare = new Hono()
    bare.use('*', requireAuth())
    bare.get('/x', (c) => c.json({ ok: true }))
    const res = await bare.request('/x', bearer(token))
    expect(res.status).toBe(200)
  })
})
