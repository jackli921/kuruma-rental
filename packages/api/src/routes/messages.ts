import { createThreadSchema, sendMessageSchema } from '@kuruma/shared/validators/message'
import { Hono } from 'hono'
import type { MessageRepository, ThreadRepository } from '../repositories/types'

export function createMessageRoutes(
  threadRepo: ThreadRepository,
  messageRepo: MessageRepository,
): Hono {
  const app = new Hono()

  app.get('/threads', async (c) => {
    const userId = c.req.query('userId')
    if (!userId) {
      return c.json({ success: false, error: 'userId query parameter is required' }, 400)
    }

    const threads = await threadRepo.findAll(userId)
    return c.json({ success: true, data: threads })
  })

  app.get('/threads/:id', async (c) => {
    const thread = await threadRepo.findById(c.req.param('id'))
    if (!thread) {
      return c.json({ success: false, error: 'Thread not found' }, 404)
    }
    return c.json({ success: true, data: thread })
  })

  app.post('/threads', async (c) => {
    const body = await c.req.json()
    const result = createThreadSchema.safeParse(body)

    if (!result.success) {
      return c.json({ success: false, error: result.error.flatten().fieldErrors }, 400)
    }

    const thread = await threadRepo.create(
      result.data.bookingId ?? null,
      result.data.participantIds,
    )
    return c.json({ success: true, data: thread }, 201)
  })

  app.post('/threads/:id/messages', async (c) => {
    const threadId = c.req.param('id')
    const thread = await threadRepo.findById(threadId)
    if (!thread) {
      return c.json({ success: false, error: 'Thread not found' }, 404)
    }

    const body = await c.req.json()
    const result = sendMessageSchema.safeParse(body)
    if (!result.success) {
      return c.json({ success: false, error: result.error.flatten().fieldErrors }, 400)
    }

    const senderId = body.senderId as string | undefined
    if (!senderId) {
      return c.json({ success: false, error: 'senderId is required' }, 400)
    }

    const message = await messageRepo.create(threadId, senderId, result.data.content)
    return c.json({ success: true, data: message }, 201)
  })

  app.post('/threads/:id/read', async (c) => {
    const threadId = c.req.param('id')
    const thread = await threadRepo.findById(threadId)
    if (!thread) {
      return c.json({ success: false, error: 'Thread not found' }, 404)
    }

    const body = await c.req.json()
    const userId = body.userId as string | undefined
    if (!userId) {
      return c.json({ success: false, error: 'userId is required' }, 400)
    }

    await threadRepo.markAsRead(threadId, userId)
    return c.json({ success: true })
  })

  return app
}
