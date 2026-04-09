import { Hono } from 'hono'
import type { StatsRepository } from '../repositories/types'

export function createStatsRoutes(statsRepo: StatsRepository) {
  const app = new Hono()

  app.get('/stats', async (c) => {
    const apiKey = c.req.header('X-API-Key')
    const expectedKey = process.env.STATS_API_KEY

    if (!expectedKey || apiKey !== expectedKey) {
      return c.json({ success: false, error: 'Unauthorized' }, 401)
    }

    const data = await statsRepo.getDashboardStats()
    return c.json({ success: true, data })
  })

  return app
}
