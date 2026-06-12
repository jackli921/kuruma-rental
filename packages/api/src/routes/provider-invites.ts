import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { Hono } from 'hono'
import type { ProviderInviteService } from '../services/provider-invite'
import { ok } from './helpers'
import { rateLimitByIp } from './rate-limit'

/**
 * Public provider-invite preview (#521 §7). Anonymous by design — the invite
 * acceptance page (`/provider/invite/<token>`) fetches it before the recipient
 * has any session. Lives under `/provider-invites/*`, NOT `/admin/*`, so the
 * app-level `requireAuth()` guard on `/admin/*` never touches it; the admin
 * mint endpoint (`POST /admin/provider-invites`) stays protected.
 *
 * The response carries only `{ valid, operatorName?, expiresAt? }` — never the
 * invited email (a leaked link must not disclose the target address). The
 * service looks the token up by hash; the route is pure HTTP plumbing.
 */
export function createProviderInviteRoutes(
  service: ProviderInviteService,
  publicCatalogLimiter?: RateLimitBinding,
) {
  const app = new Hono()

  // Per-IP budget on the unauthenticated preview path — an invite token is a
  // guessable-shaped public endpoint, so cap brute-force probing (mirrors the
  // storefront catalog limiter). Fails closed on an unresolvable IP (#563).
  if (publicCatalogLimiter) {
    app.use('/provider-invites/*', rateLimitByIp(publicCatalogLimiter))
  }

  return app.get('/provider-invites/:token/preview', async (c) => {
    const preview = await service.preview(c.req.param('token'))
    return ok(c, preview)
  })
}
