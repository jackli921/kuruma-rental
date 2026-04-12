import { Hono } from 'hono'
import type { FleetOverviewRepository } from '../repositories/types'
import { ok } from './helpers'

export function createFleetOverviewRoutes(repo: FleetOverviewRepository): Hono {
  const routes = new Hono()

  routes.get('/vehicles/fleet-overview', async (c) => {
    const data = await repo.findFleetOverview()
    return ok(c, data)
  })

  return routes
}
