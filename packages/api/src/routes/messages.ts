import { createThreadSchema, sendMessageSchema } from '@kuruma/shared/validators/message'
import { Hono } from 'hono'
import { PRIVILEGED_ROLES, requireUser, toCallerContext } from '../middleware/auth'
import type { MessageRepository, ThreadRepository } from '../repositories/types'
import { fail, ok, parseBody } from './helpers'

export function createMessageRoutes(threadRepo: ThreadRepository, messageRepo: MessageRepository) {
  return new Hono()
    .get('/threads', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const limitParam = c.req.query('limit')
      const offsetParam = c.req.query('offset')

      const limit = limitParam ? Number.parseInt(limitParam, 10) : 25
      if (Number.isNaN(limit) || limit < 1 || limit > 100) {
        return fail(c, 'limit must be between 1 and 100', 400)
      }
      const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0
      if (Number.isNaN(offset) || offset < 0) {
        return fail(c, 'offset must be a non-negative integer', 400)
      }

      const all = await threadRepo.findAll(ctx)
      const page = all.slice(offset, offset + limit)
      return ok(c, page, 200, { total: all.length, limit, offset })
    })
    .get('/threads/:id', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      // CallerContext scoping in repo handles participant check for renters
      const thread = await threadRepo.findById(ctx, c.req.param('id'))
      if (!thread) return fail(c, 'Thread not found', 404)

      return ok(c, thread)
    })
    .post('/threads', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const parsed = await parseBody(c, createThreadSchema)
      if (!parsed.ok) return parsed.response

      if (!PRIVILEGED_ROLES.has(ctx.role) && !parsed.data.participantIds.includes(ctx.userId)) {
        return fail(c, 'Caller must be a participant', 400)
      }

      const thread = await threadRepo.create(
        ctx,
        parsed.data.bookingId ?? null,
        parsed.data.participantIds,
      )
      return ok(c, thread, 201)
    })
    .post('/threads/:id/messages', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      // CallerContext scoping in repo handles participant check
      const thread = await threadRepo.findById(ctx, c.req.param('id'))
      if (!thread) return fail(c, 'Thread not found', 404)

      const parsed = await parseBody(c, sendMessageSchema)
      if (!parsed.ok) return parsed.response

      const message = await messageRepo.create(ctx, thread.id, parsed.data.content)
      return ok(c, message, 201)
    })
    .post('/threads/:id/read', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const thread = await threadRepo.findById(ctx, c.req.param('id'))
      if (!thread) return fail(c, 'Thread not found', 404)

      await threadRepo.markAsRead(ctx, thread.id)
      return ok(c, null)
    })
}
