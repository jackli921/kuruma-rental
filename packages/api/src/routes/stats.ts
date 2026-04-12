import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import type { StatsRepository } from '../repositories/types'
import { fail, ok } from './helpers'

function safeKeyCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export function createStatsRoutes(statsRepo: StatsRepository) {
  return new Hono().get('/stats', async (c) => {
    const apiKey = c.req.header('X-API-Key')
    const expectedKey = process.env.STATS_API_KEY

    if (!expectedKey || !apiKey || !safeKeyCompare(apiKey, expectedKey)) {
      return fail(c, 'Unauthorized', 401)
    }

    const data = await statsRepo.getDashboardStats()
    return ok(c, data)
  })
}
