import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import { translateMessageSchema } from '@kuruma/shared/validators/translation'
import { type Context, Hono } from 'hono'
import { requireUser, toCallerContext } from '../middleware/auth'
import type { MessageTranslationService } from '../services/message-translation'
import { failResult, ok, parseBody, parseId } from './helpers'

export function createTranslateRoutes(
  service: MessageTranslationService,
  limiter?: RateLimitBinding,
) {
  const app = new Hono()

  // Each uncached (message, language) hits an EXTERNAL translation provider, so
  // cap it per authenticated user. Per-user (not per-IP) so NAT'd callers get
  // independent budgets; the global RATE_LIMITER still covers the per-IP case.
  // Absent in local dev (no binding) — unthrottled, mirroring the photo routes.
  const userKey = (c: Context) => requireUser(c).id
  if (limiter) {
    app.use('/messages/:id/translate', rateLimit(limiter, userKey))
  }

  return app.post('/messages/:id/translate', async (c) => {
    const ctx = toCallerContext(requireUser(c))

    const idResult = parseId(c)
    if (!idResult.ok) return idResult.response

    const parsed = await parseBody(c, translateMessageSchema)
    if (!parsed.ok) return parsed.response

    const result = await service.translate(ctx, idResult.id, parsed.data.targetLanguage)
    if (!result.ok) return failResult(c, result)

    return ok(c, {
      translatedText: result.translatedText,
      language: result.language,
      cached: result.cached,
    })
  })
}
