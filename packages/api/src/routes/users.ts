import { Hono } from 'hono'
import type { UserRepository } from '../repositories/types'
import { fail, ok } from './helpers'

const MAX_IDS = 50
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createUserRoutes(userRepo: UserRepository) {
  return new Hono().get('/users', async (c) => {
    const idsParam = c.req.query('ids') ?? ''
    const ids = idsParam.split(',').filter((s) => s.length > 0)
    if (ids.length > MAX_IDS) {
      return fail(c, `ids must contain at most ${MAX_IDS} entries`, 400)
    }
    if (ids.some((id) => !UUID_RE.test(id))) {
      return fail(c, 'ids must be valid uuids', 400)
    }
    const users = await userRepo.findByIds(ids)
    return ok(
      c,
      users.map((u) => ({ id: u.id, name: u.name })),
    )
  })
}
