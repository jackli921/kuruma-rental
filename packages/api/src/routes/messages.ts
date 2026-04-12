import { createThreadSchema, sendMessageSchema } from '@kuruma/shared/validators/message'
import { Hono } from 'hono'
import { STAFF_ROLES, requireUser } from '../middleware/auth'
import type { MessageRepository, ThreadRepository } from '../repositories/types'
import { fail, ok, parseBody } from './helpers'

export function createMessageRoutes(
  threadRepo: ThreadRepository,
  messageRepo: MessageRepository,
): Hono {
  const app = new Hono()

  function isParticipant(
    thread: { participants: Array<{ userId: string }> },
    userId: string,
  ): boolean {
    return thread.participants.some((p) => p.userId === userId)
  }

  app.get('/threads', async (c) => {
    const user = requireUser(c)
    if (!user) return fail(c, 'Unauthorized', 401)

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

    const all = await threadRepo.findAll(user.id)
    const page = all.slice(offset, offset + limit)
    return ok(c, page, 200, { total: all.length, limit, offset })
  })

  app.get('/threads/:id', async (c) => {
    const user = requireUser(c)
    if (!user) return fail(c, 'Unauthorized', 401)

    const thread = await threadRepo.findById(c.req.param('id'))
    if (!thread) return fail(c, 'Thread not found', 404)

    if (!isParticipant(thread, user.id) && !STAFF_ROLES.has(user.role)) {
      return fail(c, 'Thread not found', 404)
    }

    return ok(c, thread)
  })

  app.post('/threads', async (c) => {
    const user = requireUser(c)
    if (!user) return fail(c, 'Unauthorized', 401)

    const parsed = await parseBody(c, createThreadSchema)
    if (!parsed.ok) return parsed.response

    const ids = parsed.data.participantIds
    const participantIds = ids.includes(user.id) ? ids : [user.id, ...ids]

    const thread = await threadRepo.create(parsed.data.bookingId ?? null, participantIds)
    return ok(c, thread, 201)
  })

  app.post('/threads/:id/messages', async (c) => {
    const user = requireUser(c)
    if (!user) return fail(c, 'Unauthorized', 401)

    const thread = await threadRepo.findById(c.req.param('id'))
    if (!thread) return fail(c, 'Thread not found', 404)

    if (!isParticipant(thread, user.id)) {
      return fail(c, 'Thread not found', 404)
    }

    const parsed = await parseBody(c, sendMessageSchema)
    if (!parsed.ok) return parsed.response

    const message = await messageRepo.create(thread.id, user.id, parsed.data.content)
    return ok(c, message, 201)
  })

  app.post('/threads/:id/read', async (c) => {
    const user = requireUser(c)
    if (!user) return fail(c, 'Unauthorized', 401)

    const thread = await threadRepo.findById(c.req.param('id'))
    if (!thread) return fail(c, 'Thread not found', 404)

    if (!isParticipant(thread, user.id)) {
      return fail(c, 'Thread not found', 404)
    }

    await threadRepo.markAsRead(thread.id, user.id)
    return ok(c, null)
  })

  return app
}
