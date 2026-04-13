import { Hono } from 'hono'
import { STAFF_ROLES, requireUser } from '../middleware/auth'
import type { PhotoStorage, VehicleRepository } from '../repositories/types'
import { fail, ok } from './helpers'

const MAX_PHOTOS_PER_VEHICLE = 10

export function createVehiclePhotoRoutes(repo: VehicleRepository, storage: PhotoStorage) {
  return new Hono()
    .post('/vehicles/:id/photos', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const vehicle = await repo.findById(c.req.param('id'))
      if (!vehicle) return fail(c, 'Vehicle not found', 404)

      const body = await c.req.parseBody({ all: true })
      const rawFiles = body.file
      if (!rawFiles) return fail(c, 'No file provided', 400)

      const files = (Array.isArray(rawFiles) ? rawFiles : [rawFiles]).filter(
        (f): f is File => f instanceof File,
      )
      if (files.length === 0) return fail(c, 'No file provided', 400)

      if (vehicle.photos.length + files.length > MAX_PHOTOS_PER_VEHICLE) {
        return fail(c, `Maximum ${MAX_PHOTOS_PER_VEHICLE} photos per vehicle`, 400)
      }

      const uploaded: string[] = []
      for (const file of files) {
        try {
          const result = await storage.put(vehicle.id, file)
          uploaded.push(result.url)
        } catch (e) {
          return fail(c, e instanceof Error ? e.message : 'Upload failed', 400)
        }
      }

      await repo.update(vehicle.id, { photos: [...vehicle.photos, ...uploaded] })

      return ok(c, { uploaded, total: vehicle.photos.length + uploaded.length }, 201)
    })
    .delete('/vehicles/:id/photos/:photoIdx', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const vehicle = await repo.findById(c.req.param('id'))
      if (!vehicle) return fail(c, 'Vehicle not found', 404)

      const idx = Number.parseInt(c.req.param('photoIdx'), 10)
      if (Number.isNaN(idx) || idx < 0 || idx >= vehicle.photos.length) {
        return fail(c, 'Photo index out of range', 400)
      }

      const deletedUrl = vehicle.photos[idx]!
      const photos = vehicle.photos.filter((_, i) => i !== idx)

      // Best-effort R2 cleanup — don't fail the request if storage delete fails.
      try {
        await storage.delete(deletedUrl)
      } catch {
        // orphan in storage is acceptable for MVP
      }

      await repo.update(vehicle.id, { photos })

      return ok(c, { deleted: deletedUrl, remaining: photos.length })
    })
}
