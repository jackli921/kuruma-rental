import { Hono } from 'hono'
import { z } from 'zod'
import type { CallerContext } from '../middleware/auth'
import { PRIVILEGED_ROLES, isOperatorRole, requireUser, toCallerContext } from '../middleware/auth'
import type { ThreadRepository, UserRepository } from '../repositories/types'
import { fail, ok } from './helpers'

const MAX_IDS = 50
const idsSchema = z.array(z.string().uuid()).max(MAX_IDS)

/**
 * Build the set of user ids the caller is allowed to resolve. Privileged roles
 * (STAFF/ADMIN/PARTNER) can resolve anyone; renters can only resolve users they
 * share a thread with. Without this filter the endpoint becomes a name-harvest
 * oracle: any authenticated renter could probe arbitrary UUIDs and dump the
 * user table 50 ids at a time.
 */
async function allowedUserIds(
  ctx: CallerContext,
  threadRepo: ThreadRepository,
): Promise<Set<string> | 'all'> {
  if (PRIVILEGED_ROLES.has(ctx.role)) return 'all'
  // #396: OPERATOR_* are self-only here. The thread lookup below uses a
  // synthetic RENTER context to resolve a caller's co-participants for renter
  // messaging; operators have no messaging surface yet (slice 7) and must not
  // resolve another tenant's users via a shared thread. Fail closed until
  // operator messaging is deliberately modeled.
  if (isOperatorRole(ctx.role)) return new Set<string>([ctx.userId])
  const threads = await threadRepo.findAll({ userId: ctx.userId, role: 'RENTER' })
  const allowed = new Set<string>([ctx.userId])
  for (const thread of threads) {
    for (const p of thread.participants) allowed.add(p.userId)
  }
  return allowed
}

export function createUserRoutes(userRepo: UserRepository, threadRepo: ThreadRepository) {
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

    const allowed = await allowedUserIds(ctx, threadRepo)
    const requested = allowed === 'all' ? parsed.data : parsed.data.filter((id) => allowed.has(id))

    const users = await userRepo.findByIds(requested)
    return ok(
      c,
      users.map((u) => ({ id: u.id, name: u.name })),
    )
  })
}
