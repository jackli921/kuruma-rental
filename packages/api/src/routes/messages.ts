import {
  createThreadSchema,
  markReadSchema,
  sendMessageSchema,
} from '@kuruma/shared/validators/message'
import { Hono } from 'hono'
import type { AuthUser } from '../middleware/auth'
import type { MessageRepository, ThreadRepository } from '../repositories/types'
import { fail, ok, parseBody } from './helpers'

function getUser(c: { get: (key: string) => unknown }): AuthUser | undefined {
  return c.get('user') as AuthUser | undefined
}

export function createMessageRoutes(
  threadRepo: ThreadRepository,
  messageRepo: MessageRepository,
): Hono {
  const app = new Hono()

  app.get('/threads', async (c) => {
    // Actor derivation: use JWT sub instead of query param
    const user = getUser(c)
    const userId = user?.id ?? c.req.query('userId')
    if (!userId) {
      return fail(c, 'userId query parameter is required', 400)
    }

    const threads = await threadRepo.findAll(userId)
    return ok(c, threads)
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

    // Actor derivation: use JWT sub as senderId
    const user = getUser(c)
    const senderId = user?.id ?? parsed.data.senderId
    const message = await messageRepo.create(thread.id, senderId, parsed.data.content)
    return ok(c, message, 201)
  })

  app.post('/threads/:id/read', async (c) => {
    const thread = await threadRepo.findById(c.req.param('id'))
    if (!thread) return fail(c, 'Thread not found', 404)

    const parsed = await parseBody(c, markReadSchema)
    if (!parsed.ok) return parsed.response

    // Actor derivation: use JWT sub as userId
    const user = getUser(c)
    const userId = user?.id ?? parsed.data.userId
    await threadRepo.markAsRead(thread.id, userId)
    return ok(c, null)
  })

  return app
}
