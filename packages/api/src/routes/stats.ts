import { Hono } from 'hono'
import type { StatsRepository } from '../repositories/types'
import { fail, ok } from './helpers'

export function createStatsRoutes(statsRepo: StatsRepository) {
  const app = new Hono()

  app.get('/stats', async (c) => {
    const apiKey = c.req.header('X-API-Key')
    const expectedKey = process.env.STATS_API_KEY

    if (!expectedKey || apiKey !== expectedKey) {
      return fail(c, 'Unauthorized', 401)
    }

    const data = await statsRepo.getDashboardStats()
    return ok(c, data)
  })

  return app
}
