import { Hono } from 'hono'
import { z } from 'zod'
import { requireUser, toCallerContext } from '../middleware/auth'
import type { UserDirectoryService } from '../services/user-directory'
import { fail, ok } from './helpers'

const MAX_IDS = 50
const idsSchema = z.array(z.string().uuid()).max(MAX_IDS)

export function createUserRoutes(service: UserDirectoryService) {
  return new Hono().get('/users', async (c) => {
    const ctx = toCallerContext(requireUser(c))

    const idsParam = c.req.query('ids') ?? ''
    const rawIds = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    const parsed = idsSchema.safeParse(rawIds)
    if (!parsed.success) {
      const tooMany = rawIds.length > MAX_IDS
      const message = tooMany
        ? `ids must contain at most ${MAX_IDS} entries`
        : 'ids must be valid uuids'
      return fail(c, message, 400)
    }

    const users = await service.resolveVisibleUsers(ctx, parsed.data)
    return ok(c, users)
  })
}
