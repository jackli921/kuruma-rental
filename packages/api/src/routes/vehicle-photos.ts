import { Hono } from 'hono'
import { STAFF_ROLES, requireUser } from '../middleware/auth'
import type { VehiclePhotoService } from '../services/vehicle-photo'
import { fail, ok } from './helpers'

export function createVehiclePhotoRoutes(service: VehiclePhotoService) {
  return new Hono()
    .post('/vehicles/:id/photos', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const body = await c.req.parseBody({ all: true })
      const rawFiles = body.file
      const files = (Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : []).filter(
        (f): f is File => f instanceof File,
      )

      const result = await service.uploadPhotos(c.req.param('id'), files)
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, { uploaded: result.uploaded, total: result.total }, 201)
    })
    .delete('/vehicles/:id/photos', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const url = c.req.query('url')
      if (!url) return fail(c, 'url query parameter required', 400)

      const result = await service.deletePhoto(c.req.param('id'), url)
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, { deleted: url, remaining: result.remaining })
    })
}
