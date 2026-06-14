import { translateMessageSchema } from '@kuruma/shared/validators/translation'
import { Hono } from 'hono'
import { requireUser, toCallerContext } from '../middleware/auth'
import type { MessageTranslationService } from '../services/message-translation'
import { fail, ok, parseBody, parseId } from './helpers'

export function createTranslateRoutes(service: MessageTranslationService) {
  return new Hono().post('/messages/:id/translate', async (c) => {
    const ctx = toCallerContext(requireUser(c))

    const idResult = parseId(c)
    if (!idResult.ok) return idResult.response

    const parsed = await parseBody(c, translateMessageSchema)
    if (!parsed.ok) return parsed.response

    const result = await service.translate(ctx, idResult.id, parsed.data.targetLanguage)
    if (!result.ok) return fail(c, result.error, result.status)

    return ok(c, {
      translatedText: result.translatedText,
      language: result.language,
      cached: result.cached,
    })
  })
}
