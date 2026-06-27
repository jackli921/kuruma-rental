import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import { setupGlobalHandlers } from '../../src/error-handlers'
import { requirePlatformMember } from '../../src/middleware/auth'
import { testAuthMiddleware } from '../helpers/auth'

// #1164: the /admin/* role gate must be STRUCTURAL, not only per-handler. A
// sibling route added to an admin sub-app that forgets its in-body
// requirePlatform* call must STILL reject a non-platform caller. We prove that by
// mounting an admin route with NO in-body gate behind only the prefix middleware
// and asserting authz still holds — the exact regression the issue describes.
function appWith(role: Parameters<typeof testAuthMiddleware>[1]): Hono {
  const app = new Hono()
  app.use('/admin/*', testAuthMiddleware('u1', role))
  app.use('/admin/*', requirePlatformMember())
  // Deliberately NO in-body requirePlatform* call here — simulates a future sibling.
  app.get('/admin/unguarded', (c) => c.json({ ok: true }))
  setupGlobalHandlers(app)
  return app
}

describe('requirePlatformMember structural /admin/* gate (#1164)', () => {
  it('403s a tenant operator on an in-body-ungated admin route', async () => {
    const res = await appWith('OPERATOR_OWNER').request('/admin/unguarded')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Forbidden')
  })

  it('403s a renter on the same ungated route (only the platform tier passes)', async () => {
    const res = await appWith('RENTER').request('/admin/unguarded')
    expect(res.status).toBe(403)
  })

  it('admits PLATFORM_ADMIN through the structural gate', async () => {
    const res = await appWith('PLATFORM_ADMIN').request('/admin/unguarded')
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})
