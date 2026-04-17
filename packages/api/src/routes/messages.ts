import { createThreadSchema, sendMessageSchema } from '@kuruma/shared/validators/message'
import { Hono } from 'hono'
import { PRIVILEGED_ROLES, requireUser, toCallerContext } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type { MessageRepository, ThreadRepository } from '../repositories/types'
import { fail, ok, parseBody } from './helpers'

/**
 * Idempotent create: check for existing record by key, attempt insert,
 * catch UNIQUE_VIOLATION race and re-fetch. Returns { record, status }.
 */
async function idempotentCreate<T>(
  key: string | null,
  find: (k: string) => Promise<T | undefined>,
  insert: () => Promise<T>,
): Promise<{ record: T; status: 200 | 201 }> {
  if (key) {
    const existing = await find(key)
    if (existing) return { record: existing, status: 200 }
  }

  try {
    const record = await insert()
    return { record, status: 201 }
  } catch (err) {
    if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION && key) {
      const existing = await find(key)
      if (existing) return { record: existing, status: 200 }
    }
    throw err
  }
}

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

      const idempotencyKey = parsed.data.idempotencyKey ?? null
      const { record: thread, status } = await idempotentCreate(
        idempotencyKey,
        (k) => threadRepo.findByIdempotencyKey(k),
        () =>
          threadRepo.create(
            ctx,
            parsed.data.bookingId ?? null,
            parsed.data.participantIds,
            idempotencyKey,
          ),
      )
      return ok(c, thread, status)
    })
    .post('/threads/:id/messages', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      // CallerContext scoping in repo handles participant check
      const thread = await threadRepo.findById(ctx, c.req.param('id'))
      if (!thread) return fail(c, 'Thread not found', 404)

      const parsed = await parseBody(c, sendMessageSchema)
      if (!parsed.ok) return parsed.response

      const msgIdempotencyKey = parsed.data.idempotencyKey ?? null
      const { record: message, status } = await idempotentCreate(
        msgIdempotencyKey,
        (k) => messageRepo.findByIdempotencyKey(k),
        () => messageRepo.create(ctx, thread.id, parsed.data.content, msgIdempotencyKey),
      )
      return ok(c, message, status)
    })
    .post('/threads/:id/read', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const thread = await threadRepo.findById(ctx, c.req.param('id'))
      if (!thread) return fail(c, 'Thread not found', 404)

      await threadRepo.markAsRead(ctx, thread.id)
      return ok(c, null)
    })
}
