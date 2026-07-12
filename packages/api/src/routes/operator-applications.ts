import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { operatorApplicationSchema } from '@kuruma/shared/validators/operator-application'
import { Hono } from 'hono'
import { requireAuth, requireUser } from '../middleware/auth'
import type { OperatorApplicationService } from '../services/operator-application'
import { fail, ok, parseBody } from './helpers'
import { rateLimitByIp } from './rate-limit'

export function createOperatorApplicationRoutes(
  service: OperatorApplicationService,
  limiter?: RateLimitBinding,
) {
  const app = new Hono()
  // Sign-in-first (#877): all routes under this prefix require a session. The
  // wildcard `/*` covers BOTH the bare `/operator-applications` (POST submit) and
  // sub-paths like `/me` — a bare `app.use('/operator-applications', mw)` matches
  // only the exact path. Register on the wildcard ALONE: adding the exact-path
  // registration too would double-run every middleware on the bare path, which for
  // rateLimitByIp means a double token decrement per POST.
  app.use('/operator-applications/*', requireAuth())
  if (limiter) app.use('/operator-applications/*', rateLimitByIp(limiter))

  app.get('/operator-applications/me', async (c) => {
    const user = requireUser(c)
    const mine = await service.findMine(user.id)
    if (!mine) return fail(c, 'no application found', 404)
    return ok(c, mine)
  })

  return app.post('/operator-applications', async (c) => {
    const user = requireUser(c)
    const parsed = await parseBody(c, operatorApplicationSchema)
    if (!parsed.ok) return parsed.response
    const { honeypot, consent: _c, ...data } = parsed.data
    // Silent bot trap: a filled honeypot means a bot. Return an indistinguishable
    // 201 and persist nothing, so the bot can't tell it was rejected (a 4xx would
    // teach it to leave the field blank). No DB write, no duplicate-email probe.
    if (honeypot) return ok(c, { id: crypto.randomUUID(), status: 'PENDING' }, 201)
    const result = await service.submit({ ...data, applicantUserId: user.id })
    return ok(c, result, 201)
  })
}
