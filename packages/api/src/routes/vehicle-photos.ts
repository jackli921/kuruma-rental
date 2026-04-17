import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import { type Context, Hono } from 'hono'
import { detectImageType } from '../lib/image-signature'
import { STAFF_ROLES, requireUser } from '../middleware/auth'
import type { PhotoStorage, VehicleRepository } from '../repositories/types'
import { fail, ok } from './helpers'

const MAX_PHOTOS_PER_VEHICLE = 10
const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

type ValidatedFile = { file: File; bytes: Uint8Array }

async function validateFile(file: File): Promise<{ ok: ValidatedFile } | { err: string }> {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { err: 'Only image files are allowed (JPEG, PNG, WebP, AVIF)' }
  }
  if (file.size > MAX_FILE_SIZE) return { err: 'File must be under 5MB' }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const detected = detectImageType(bytes)
  if (detected === null) return { err: 'File content does not match an allowed image format' }
  if (detected !== file.type) return { err: 'File content does not match declared Content-Type' }
  return { ok: { file, bytes } }
}

export function createVehiclePhotoRoutes(
  repo: VehicleRepository,
  storage: PhotoStorage,
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

      const vehicleId = c.req.param('id')
      const body = await c.req.parseBody({ all: true })
      const rawFiles = body.file
      if (!rawFiles) return fail(c, 'No file provided', 400)

      const files = (Array.isArray(rawFiles) ? rawFiles : [rawFiles]).filter(
        (f): f is File => f instanceof File,
      )
      if (files.length === 0) return fail(c, 'No file provided', 400)
      if (files.length > MAX_PHOTOS_PER_VEHICLE) {
        return fail(c, `Maximum ${MAX_PHOTOS_PER_VEHICLE} photos per vehicle`, 400)
      }

      // Validate bytes before hitting storage so we never persist a spoofed file.
      const validated: ValidatedFile[] = []
      for (const file of files) {
        const result = await validateFile(file)
        if ('err' in result) return fail(c, result.err, 400)
        validated.push(result.ok)
      }

      // Upload all files in parallel. Track successes so we can roll back if
      // any put rejects mid-batch or the DB append fails.
      const uploadResults = await Promise.allSettled(
        validated.map(({ file }) => storage.put(vehicleId, file)),
      )

      const succeeded = uploadResults.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      const anyFailed = uploadResults.some((r) => r.status === 'rejected')

      if (anyFailed) {
        await Promise.all(succeeded.map((r) => storage.delete(r.url).catch(() => {})))
        return fail(c, 'One or more uploads failed', 500)
      }

      const appendResult = await repo.appendPhotos(
        vehicleId,
        succeeded.map((r) => r.url),
        MAX_PHOTOS_PER_VEHICLE,
      )

      if (appendResult.outcome === 'not_found') {
        await Promise.all(succeeded.map((r) => storage.delete(r.url).catch(() => {})))
        return fail(c, 'Vehicle not found', 404)
      }
      if (appendResult.outcome === 'cap_exceeded') {
        await Promise.all(succeeded.map((r) => storage.delete(r.url).catch(() => {})))
        return fail(c, `Maximum ${MAX_PHOTOS_PER_VEHICLE} photos per vehicle`, 400)
      }

      return ok(
        c,
        {
          uploaded: succeeded.map((r) => r.url),
          total: appendResult.vehicle.photos.length,
        },
        201,
      )
    })
    .delete('/vehicles/:id/photos', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const url = c.req.query('url')
      if (!url) return fail(c, 'url query parameter required', 400)

      const updated = await repo.removePhotoByUrl(c.req.param('id'), url)
      if (!updated) {
        // Either the vehicle does not exist or the URL is not one of its photos.
        // Treat both as 404 so we do not leak existence info.
        return fail(c, 'Photo not found', 404)
      }

      // Best-effort R2 cleanup after the authoritative DB write succeeds.
      try {
        await storage.delete(url)
      } catch (e) {
        console.warn('R2 photo cleanup failed, orphan left:', url, e)
      }

      return ok(c, { deleted: url, remaining: updated.photos.length })
    })
}
