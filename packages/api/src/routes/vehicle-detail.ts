import { Hono } from 'hono'
import type { VehicleDetailRepository } from '../repositories/types'
import { fail, ok } from './helpers'

export function createVehicleDetailRoutes(repo: VehicleDetailRepository) {
  return new Hono().get('/vehicles/:id/detail', async (c) => {
    const detail = await repo.findVehicleDetail(c.req.param('id'))
    if (!detail) {
      return fail(c, 'Vehicle not found', 404)
    }
    return ok(c, detail)
  })
}
