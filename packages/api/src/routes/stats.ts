import { Hono } from 'hono'
import type { StatsRepository } from '../repositories/types'

export function createStatsRoutes(statsRepo: StatsRepository) {
  const app = new Hono()

  app.get('/stats', async (c) => {
    const data = await statsRepo.getDashboardStats()
    return c.json({ success: true, data })
  })

  return app
}
