import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import { type Context, Hono } from 'hono'
import type { ProviderInviteService } from '../services/provider-invite'
import { ok } from './helpers'

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
  // storefront catalog limiter).
  if (publicCatalogLimiter) {
    const ipKey = (c: Context) => c.req.header('cf-connecting-ip') ?? ''
    app.use('/provider-invites/*', rateLimit(publicCatalogLimiter, ipKey))
  }

  return app.get('/provider-invites/:token/preview', async (c) => {
    const preview = await service.preview(c.req.param('token'))
    return ok(c, preview)
  })
}
