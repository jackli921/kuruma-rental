import { Hono } from 'hono'
import { requireAuth, requirePlatformAdmin, requireUser, toCallerContext } from '../middleware/auth'
import type { ReviewService } from '../services/review'
import { fail, ok, parseId } from './helpers'

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
  app.use('/admin/reviews', requireAuth())
  app.use('/admin/reviews/*', requireAuth())

  return app
    .get('/admin/reviews/reported', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformAdmin(ctx)
      return ok(c, { reported: await service.listReported() })
    })
    .post('/admin/reviews/:id/hide', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformAdmin(ctx)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const hidden = await service.hideReview(idResult.id)
      if (!hidden) return fail(c, 'REVIEW_NOT_FOUND', 404)
      return ok(c, { review: hidden })
    })
}
