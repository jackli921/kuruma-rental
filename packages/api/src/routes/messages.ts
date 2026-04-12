import {
  createThreadSchema,
  markReadSchema,
  sendMessageSchema,
} from '@kuruma/shared/validators/message'
import { Hono } from 'hono'
import type { MessageRepository, ThreadRepository } from '../repositories/types'
import { fail, ok, parseBody } from './helpers'

export function createMessageRoutes(
  threadRepo: ThreadRepository,
  messageRepo: MessageRepository,
): Hono {
  const app = new Hono()

  app.get('/threads', async (c) => {
    const userId = c.req.query('userId')
    if (!userId) {
      return fail(c, 'userId query parameter is required', 400)
    }

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

    const all = await threadRepo.findAll(userId)
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

    const parsed = await parseBody(c, sendMessageSchema)
    if (!parsed.ok) return parsed.response

    const message = await messageRepo.create(thread.id, parsed.data.senderId, parsed.data.content)
    return ok(c, message, 201)
  })

  app.post('/threads/:id/read', async (c) => {
    const thread = await threadRepo.findById(c.req.param('id'))
    if (!thread) return fail(c, 'Thread not found', 404)

    const parsed = await parseBody(c, markReadSchema)
    if (!parsed.ok) return parsed.response

    await threadRepo.markAsRead(thread.id, parsed.data.userId)
    return ok(c, null)
  })

  return app
}
