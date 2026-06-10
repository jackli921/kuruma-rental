import {
  MAX_DOCUMENT_BYTES,
  uploadDocumentSchema,
  verifyDocumentSchema,
} from '@kuruma/shared/validators/document'
import { Hono } from 'hono'
import { STAFF_ROLES, requireUser, toCallerContext } from '../middleware/auth'
import type { RenterDocumentService } from '../services/renter-document'
import {
  MULTIPART_OVERHEAD_BYTES,
  fail,
  ok,
  parseBody,
  parsePagination,
  rejectOversizedBody,
} from './helpers'

// One file per request; cap the request at the per-file limit plus multipart slack.
const MAX_DOCUMENT_REQUEST_BYTES = MAX_DOCUMENT_BYTES + MULTIPART_OVERHEAD_BYTES

export function createDocumentRoutes(service: RenterDocumentService) {
  const app = new Hono()

  return app
    .post('/documents', async (c) => {
      const user = requireUser(c)
      const ctx = toCallerContext(user)

      const oversized = rejectOversizedBody(c, MAX_DOCUMENT_REQUEST_BYTES)
      if (oversized) return oversized

      const body = await c.req.parseBody()
      const file = body.file
      if (!(file instanceof File)) return fail(c, 'A document file is required', 400)

      const parsed = uploadDocumentSchema.safeParse({ type: body.type })
      if (!parsed.success) {
        return fail(c, parsed.error.flatten().fieldErrors, 400)
      }

      // Renters upload for themselves; staff may upload on behalf of a renter
      // by passing renterId. The repo seals cross-renter writes for non-staff.
      const renterId =
        STAFF_ROLES.has(user.role) && typeof body.renterId === 'string' ? body.renterId : ctx.userId

      const result = await service.upload(ctx, { renterId, type: parsed.data.type }, file)
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, { document: result.document }, 201)
    })
    .get('/documents/me', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const documents = await service.listMine(ctx, ctx.userId)
      return ok(c, { documents })
    })
    .get('/documents', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const page = parsePagination(c, { defaultLimit: 25, maxLimit: 100 })
      if (!page.ok) return page.response
      const result = await service.listPending(toCallerContext(user), {
        limit: page.limit,
        offset: page.offset,
      })
      return ok(c, { documents: result.data, total: result.total })
    })
    .post('/documents/:id/verify', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)

      const parsed = await parseBody(c, verifyDocumentSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.verify(ctx, c.req.param('id'), {
        status: parsed.data.status,
        verifierId: ctx.userId,
        expiryDate: parsed.data.expiryDate ?? null,
        rejectionReason: parsed.data.rejectionReason ?? null,
      })
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, { document: result.document })
    })
}
