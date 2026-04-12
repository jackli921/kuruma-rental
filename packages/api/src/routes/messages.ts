import { createThreadSchema, sendMessageSchema } from '@kuruma/shared/validators/message'
import { Hono } from 'hono'
import { getUser } from '../middleware/auth'
import type { MessageRepository, ThreadRepository } from '../repositories/types'
import { fail, ok, parseBody } from './helpers'

export function createMessageRoutes(
  threadRepo: ThreadRepository,
  messageRepo: MessageRepository,
): Hono {
  const app = new Hono()

  app.get('/threads', async (c) => {
    const user = getUser(c)
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
    const thread = await threadRepo.findById(c.req.param('id'))
    if (!thread) {
      return fail(c, 'Thread not found', 404)
    }
    return ok(c, thread)
  })

  app.post('/threads', async (c) => {
    const parsed = await parseBody(c, createThreadSchema)
    if (!parsed.ok) return parsed.response

    const thread = await threadRepo.create(
      parsed.data.bookingId ?? null,
      parsed.data.participantIds,
    )
    return ok(c, thread, 201)
  })

  app.post('/threads/:id/messages', async (c) => {
    const thread = await threadRepo.findById(c.req.param('id'))
    if (!thread) return fail(c, 'Thread not found', 404)

    const user = getUser(c)
    if (!user) return fail(c, 'Unauthorized', 401)

    const parsed = await parseBody(c, sendMessageSchema)
    if (!parsed.ok) return parsed.response

    const message = await messageRepo.create(thread.id, user.id, parsed.data.content)
    return ok(c, message, 201)
  })

  app.post('/threads/:id/read', async (c) => {
    const thread = await threadRepo.findById(c.req.param('id'))
    if (!thread) return fail(c, 'Thread not found', 404)

    const user = getUser(c)
    if (!user) return fail(c, 'Unauthorized', 401)

    await threadRepo.markAsRead(thread.id, user.id)
    return ok(c, null)
  })

  return app
}
