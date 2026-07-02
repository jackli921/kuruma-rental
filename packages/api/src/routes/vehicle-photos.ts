import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import { type Context, Hono } from 'hono'
import { STAFF_ROLES, requireUser, toCallerContext } from '../middleware/auth'
import {
  MAX_FILE_SIZE,
  MAX_PHOTOS_PER_VEHICLE,
  type VehiclePhotoService,
} from '../services/vehicle-photo'
import { MULTIPART_OVERHEAD_BYTES, fail, ok, parseId, rejectOversizedBody } from './helpers'

// Up to MAX_PHOTOS_PER_VEHICLE files per request; cap the whole multipart body
// at that many max-sized files plus framing slack.
const MAX_PHOTOS_REQUEST_BYTES = MAX_PHOTOS_PER_VEHICLE * MAX_FILE_SIZE + MULTIPART_OVERHEAD_BYTES

export function createVehiclePhotoRoutes(
  service: VehiclePhotoService,
  photoUploadLimiter?: RateLimitBinding,
  photoUploadUserLimiter?: RateLimitBinding,
) {
  const app = new Hono()

  // Stack two limits. Per-user caps aggregate volume so rotating vehicle IDs
  // can't burst around the per-(user,vehicle) bucket. Runs first so requests
  // from a flooding account short-circuit before hitting the narrower limit.
  const vehicleKey = (c: Context) => `${requireUser(c).id}:${c.req.param('id')}`
  const userKey = (c: Context) => requireUser(c).id
  if (photoUploadUserLimiter) {
    app.use('/vehicles/:id/photos', rateLimit(photoUploadUserLimiter, userKey))
  }
  if (photoUploadLimiter) {
    app.use('/vehicles/:id/photos', rateLimit(photoUploadLimiter, vehicleKey))
  }

  return app
    .post('/vehicles/:id/photos', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const oversized = rejectOversizedBody(c, MAX_PHOTOS_REQUEST_BYTES)
      if (oversized) return oversized

      const body = await c.req.parseBody({ all: true })
      const rawFiles = body.file
      const files = (Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : []).filter(
        (f): f is File => f instanceof File,
      )

      const result = await service.uploadPhotos(ctx, idResult.id, files, c.req.query('operatorId'))
      if (!result.ok) {
        return fail(c, result.error, result.status, result.code ? { code: result.code } : undefined)
      }
      return ok(c, { uploaded: result.uploaded, total: result.total }, 201)
    })
    .delete('/vehicles/:id/photos', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const url = c.req.query('url')
      if (!url) return fail(c, 'url query parameter required', 400)

      const result = await service.deletePhoto(ctx, idResult.id, url, c.req.query('operatorId'))
      if (!result.ok) {
        return fail(c, result.error, result.status, result.code ? { code: result.code } : undefined)
      }
      return ok(c, { deleted: url, remaining: result.remaining })
    })
}
