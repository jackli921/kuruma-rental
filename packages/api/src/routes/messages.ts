import { createThreadSchema, sendMessageSchema } from '@kuruma/shared/validators/message'
import { Hono } from 'hono'
import { requireUser, toCallerContext } from '../middleware/auth'
import type { MessageService } from '../services/message'
import { fail, ok, parseBody, parseId, parsePagination } from './helpers'

export function createMessageRoutes(service: MessageService) {
  return new Hono()
    .get('/threads', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const pg = parsePagination(c)
      if (!pg.ok) return pg.response
      const { limit, offset } = pg

      const { threads, total } = await service.listThreads(ctx, limit, offset)
      return ok(c, threads, 200, { total, limit, offset })
    })
    .get('/threads/:id', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const thread = await service.getThread(ctx, idResult.id)
      if (!thread) return fail(c, 'Thread not found', 404)

      return ok(c, thread)
    })
    .post('/threads', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const parsed = await parseBody(c, createThreadSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.createThread(ctx, parsed.data)
      if (result.kind === 'forbidden') return fail(c, 'Caller must be a participant', 400)
      return ok(c, result.thread, result.status)
    })
    .post('/threads/:id/messages', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      // Existence/scope (404) is checked BEFORE body validation (400) to preserve
      // the original ordering; createMessage then reuses this confirmed thread id.
      const thread = await service.getThread(ctx, idResult.id)
      if (!thread) return fail(c, 'Thread not found', 404)

      const parsed = await parseBody(c, sendMessageSchema)
      if (!parsed.ok) return parsed.response

      const { message, status } = await service.createMessage(
        ctx,
        thread.id,
        parsed.data.content,
        parsed.data.idempotencyKey ?? null,
      )
      return ok(c, message, status)
    })
    .post('/threads/:id/read', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const result = await service.markRead(ctx, idResult.id)
      if (result.kind === 'thread_not_found') return fail(c, 'Thread not found', 404)
      return ok(c, null)
    })
}
