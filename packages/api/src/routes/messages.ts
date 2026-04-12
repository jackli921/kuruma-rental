import { createThreadSchema, sendMessageSchema } from '@kuruma/shared/validators/message'
import { Hono } from 'hono'
import { requireUser } from '../middleware/auth'
import type { MessageRepository, ThreadRepository } from '../repositories/types'
import { fail, ok, parseBody } from './helpers'

export function createMessageRoutes(
  threadRepo: ThreadRepository,
  messageRepo: MessageRepository,
): Hono {
  const app = new Hono()

  app.get('/threads', async (c) => {
    const user = requireUser(c)
    if (!user) return fail(c, 'Unauthorized', 401)

    const threads = await threadRepo.findAll(user.id)
    return ok(c, threads)
  })

  app.get('/threads/:id', async (c) => {
    const user = requireUser(c)
    if (!user) return fail(c, 'Unauthorized', 401)

    const thread = await threadRepo.findById(c.req.param('id'))
    if (!thread) return fail(c, 'Thread not found', 404)
    return ok(c, thread)
  })

  app.post('/threads', async (c) => {
    const user = requireUser(c)
    if (!user) return fail(c, 'Unauthorized', 401)

    const parsed = await parseBody(c, createThreadSchema)
    if (!parsed.ok) return parsed.response

    const thread = await threadRepo.create(
      parsed.data.bookingId ?? null,
      parsed.data.participantIds,
    )
    return ok(c, thread, 201)
  })

  app.post('/threads/:id/messages', async (c) => {
    const user = requireUser(c)
    if (!user) return fail(c, 'Unauthorized', 401)

    const thread = await threadRepo.findById(c.req.param('id'))
    if (!thread) return fail(c, 'Thread not found', 404)

    const parsed = await parseBody(c, sendMessageSchema)
    if (!parsed.ok) return parsed.response

    // Actor derivation: use JWT sub as senderId, never the body field
    const message = await messageRepo.create(thread.id, user.id, parsed.data.content)
    return ok(c, message, 201)
  })

  app.post('/threads/:id/read', async (c) => {
    const user = requireUser(c)
    if (!user) return fail(c, 'Unauthorized', 401)

    const thread = await threadRepo.findById(c.req.param('id'))
    if (!thread) return fail(c, 'Thread not found', 404)

    // Actor derivation: use JWT sub
    await threadRepo.markAsRead(thread.id, user.id)
    return ok(c, null)
  })

  return app
}
