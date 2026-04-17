import type { PhotoStorage, VehicleRepository } from '../repositories/types'

const MAX_PHOTOS_PER_VEHICLE = 10
const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

export type UploadResult =
  | { ok: true; uploaded: string[]; total: number }
  | { ok: false; error: string; status: 400 | 404 }

export type DeleteResult =
  | { ok: true; deletedUrl: string; remaining: number }
  | { ok: false; error: string; status: 400 | 404 }

function validateFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return 'Only image files are allowed (JPEG, PNG, WebP, AVIF)'
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'File must be under 5MB'
  }
  return null
}

export class VehiclePhotoService {
  constructor(
    private readonly repo: VehicleRepository,
    private readonly storage: PhotoStorage,
  ) {}

  async upload(vehicleId: string, files: readonly File[]): Promise<UploadResult> {
    if (files.length === 0) {
      return { ok: false, error: 'No file provided', status: 400 }
    }

    const vehicle = await this.repo.findById(vehicleId)
    if (!vehicle) return { ok: false, error: 'Vehicle not found', status: 404 }

    // TODO: race condition — concurrent uploads can exceed limit.
    // Fix with DB-level constraint or SELECT FOR UPDATE when needed.
    if (vehicle.photos.length + files.length > MAX_PHOTOS_PER_VEHICLE) {
      return {
        ok: false,
        error: `Maximum ${MAX_PHOTOS_PER_VEHICLE} photos per vehicle`,
        status: 400,
      }
    }

    for (const file of files) {
      const error = validateFile(file)
      if (error) return { ok: false, error, status: 400 }
    }

    const results = await Promise.all(files.map((f) => this.storage.put(vehicle.id, f)))
    const uploaded = results.map((r) => r.url)

    try {
      await this.repo.update(vehicle.id, { photos: [...vehicle.photos, ...uploaded] })
    } catch (e) {
      // Compensating cleanup: remove uploaded files if DB update fails.
      await Promise.all(results.map((r) => this.storage.delete(r.url).catch(() => {})))
      throw e
    }

    return { ok: true, uploaded, total: vehicle.photos.length + uploaded.length }
  }

  async delete(vehicleId: string, photoIdx: number): Promise<DeleteResult> {
    const vehicle = await this.repo.findById(vehicleId)
    if (!vehicle) return { ok: false, error: 'Vehicle not found', status: 404 }

    if (!Number.isInteger(photoIdx) || photoIdx < 0 || photoIdx >= vehicle.photos.length) {
      return { ok: false, error: 'Photo index out of range', status: 400 }
    }

    const deletedUrl = vehicle.photos[photoIdx]!
    const photos = vehicle.photos.filter((_, i) => i !== photoIdx)

    await this.repo.update(vehicle.id, { photos })

    // Best-effort storage cleanup after DB update succeeds.
    try {
      await this.storage.delete(deletedUrl)
    } catch (e) {
      console.warn('Photo storage cleanup failed, orphan left:', deletedUrl, e)
    }

    return { ok: true, deletedUrl, remaining: photos.length }
  }
}
