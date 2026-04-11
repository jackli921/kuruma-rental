import { Hono } from 'hono'
import type { FleetOverviewRepository } from '../repositories/types'

// Owner-facing aggregated read for /manage/vehicles. Split from
// createVehicleRoutes because it reads across vehicles + bookings +
// users.name — cleaner boundary, same pattern as
// createAvailabilityRoutes. See issue #52.
export function createFleetOverviewRoutes(repo: FleetOverviewRepository): Hono {
  const routes = new Hono()

  routes.get('/vehicles/fleet-overview', async (c) => {
    const data = await repo.findFleetOverview()
    return c.json({ success: true, data })
  })

  return routes
}
