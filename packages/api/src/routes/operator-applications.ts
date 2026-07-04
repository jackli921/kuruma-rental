import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { operatorApplicationSchema } from '@kuruma/shared/validators/operator-application'
import { Hono } from 'hono'
import type { OperatorApplicationService } from '../services/operator-application'
import { ok, parseBody } from './helpers'
import { rateLimitByIp } from './rate-limit'

export function createOperatorApplicationRoutes(
  service: OperatorApplicationService,
  limiter?: RateLimitBinding,
) {
  const app = new Hono()
  if (limiter) app.use('/operator-applications', rateLimitByIp(limiter))
  return app.post('/operator-applications', async (c) => {
    const parsed = await parseBody(c, operatorApplicationSchema)
    if (!parsed.ok) return parsed.response
    const { honeypot, consent: _c, ...data } = parsed.data
    // Silent bot trap: a filled honeypot means a bot. Return an indistinguishable
    // 201 and persist nothing, so the bot can't tell it was rejected (a 4xx would
    // teach it to leave the field blank). No DB write, no duplicate-email probe.
    if (honeypot) return ok(c, { id: crypto.randomUUID(), status: 'PENDING' }, 201)
    const result = await service.submit(data)
    return ok(c, result, 201)
  })
}
