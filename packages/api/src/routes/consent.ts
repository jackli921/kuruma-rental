import { Hono } from 'hono'
import { z } from 'zod'
import { requireUser, toCallerContext } from '../middleware/auth'
import type { ConsentService } from '../services/consent'
import { fail, ok, parseBody } from './helpers'

// Document ids are deterministic slugs (e.g. `doc_renter_tos_v1_en`), not UUIDs,
// so this is a presence check — the service is the authority on whether the id
// resolves to a published, acceptable document (404/409).
const acceptSchema = z.object({ documentId: z.string().min(1) })

/** Locale to present consent copy in; the service falls back to `en` when a
 *  (type, version) was never authored for it. */
function presentationLocale(c: { req: { query: (k: string) => string | undefined } }): string {
  return c.req.query('locale') ?? 'en'
}

/**
 * Flow A consent endpoints (#877 Phase 2). Mounted under `requireAuth` so the
 * caller is always an authenticated subject; both read the identity from the
 * session, never the body — a renter can only see and accept their own consents.
 */
export function createConsentRoutes(service: ConsentService) {
  return new Hono()
    .get('/consent/status', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const pending = await service.getPendingConsents(
        ctx.userId,
        ctx.role,
        presentationLocale(c),
        new Date(),
      )
      return ok(c, pending)
    })
    .post('/consent/accept', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const parsed = await parseBody(c, acceptSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.recordAcceptance(
        { documentId: parsed.data.documentId, userId: ctx.userId, actorRole: ctx.role },
        {
          now: new Date(),
          ipAddress: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
          userAgent: c.req.header('user-agent') ?? null,
        },
      )
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.acceptance)
    })
}
