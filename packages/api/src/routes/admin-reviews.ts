import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, requirePlatformAdmin, requireUser, toCallerContext } from '../middleware/auth'
import type { ReviewService } from '../services/review'
import { fail, ok, parseId } from './helpers'

// Moderation-queue query (#1451): optional page size, the VISIBLE/HIDDEN partition, and an
// opaque keyset cursor carried back as its two parts (recency instant + reviewId tiebreak).
const reportedQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  status: z.enum(['VISIBLE', 'HIDDEN']).optional(),
  cursorTs: z.string().datetime().optional(),
  cursorId: z.string().min(1).optional(),
})

/**
 * Platform-admin review moderation (#1086, #1067 slice 6). Mounts under `/admin/*`,
 * so the structural platform floor (`requirePlatformMember` in index.ts) already gates
 * the path; each handler re-asserts the stricter `requirePlatformAdmin` as defence in
 * depth (AGENTS.md), matching routes/admin.ts. GET lists the report queue; POST
 * soft-hides a review (status flip, row kept for audit). A report NEVER auto-hides —
 * only an admin here can, by owner decision, so a bad-faith report can't suppress a
 * legitimate review, only surface it. The `requirePlatformAdmin` gate runs BEFORE
 * `parseId` so a non-admin never learns whether a review id is even well-formed.
 */
export function createAdminReviewRoutes(service: ReviewService) {
  const app = new Hono()
  app.use('/admin/reviews/*', requireAuth())

  return app
    .get('/admin/reviews/reported', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformAdmin(ctx)

      const parsed = reportedQuerySchema.safeParse({
        limit: c.req.query('limit'),
        status: c.req.query('status'),
        cursorTs: c.req.query('cursorTs'),
        cursorId: c.req.query('cursorId'),
      })
      if (!parsed.success) return fail(c, 'INVALID_QUERY', 400)
      const { limit, status, cursorTs, cursorId } = parsed.data
      // A cursor is both parts or neither — a half cursor is a malformed request.
      if ((cursorTs === undefined) !== (cursorId === undefined)) {
        return fail(c, 'INVALID_CURSOR', 400)
      }
      const cursor =
        cursorTs && cursorId
          ? { lastReportedAt: new Date(cursorTs), reviewId: cursorId }
          : undefined

      const page = await service.listReported({ limit, status, cursor })
      return ok(c, {
        reported: page.items,
        nextCursor: page.nextCursor
          ? {
              lastReportedAt: page.nextCursor.lastReportedAt.toISOString(),
              reviewId: page.nextCursor.reviewId,
            }
          : null,
      })
    })
    .post('/admin/reviews/:id/hide', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformAdmin(ctx)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const hidden = await service.hideReview(ctx, idResult.id, new Date())
      if (!hidden) return fail(c, 'REVIEW_NOT_FOUND', 404)
      return ok(c, { review: hidden })
    })
}
