import type { PhotoStorage, VehicleRepository } from '../repositories/types'

const MAX_PHOTOS_PER_VEHICLE = 10
const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

export type UploadResult =
  | { ok: true; uploaded: string[]; total: number }
  | { ok: false; error: string; status: 400 | 404 | 409 }

export type DeleteResult =
  | { ok: true; deletedUrl: string; remaining: number }
  | { ok: false; error: string; status: 400 | 404 | 409 }

export interface PhotoServiceLogger {
  warn(message: string, ...args: unknown[]): void
}

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
    private readonly logger: PhotoServiceLogger = console,
  ) {}

  async upload(vehicleId: string, files: readonly File[]): Promise<UploadResult> {
    if (files.length === 0) {
      return { ok: false, error: 'No file provided', status: 400 }
    }

    const vehicle = await this.repo.findById(vehicleId)
    if (!vehicle) return { ok: false, error: 'Vehicle not found', status: 404 }

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

    // Optimistic concurrency: only append if photos hasn't changed since read.
    // A concurrent upload/delete that races with this one will cause one to
    // return undefined — we roll back the uploaded storage objects and 409.
    let updated: Awaited<ReturnType<VehicleRepository['update']>>
    try {
      updated = await this.repo.update(
        vehicle.id,
        { photos: [...vehicle.photos, ...uploaded] },
        { expectedPhotos: vehicle.photos },
      )
    } catch (e) {
      await this.cleanupStorage(uploaded)
      throw e
    }

    if (!updated) {
      await this.cleanupStorage(uploaded)
      return {
        ok: false,
        error: 'Vehicle photos changed concurrently; retry',
        status: 409,
      }
    }

    return { ok: true, uploaded, total: updated.photos.length }
  }

  async delete(vehicleId: string, photoIdx: number): Promise<DeleteResult> {
    const vehicle = await this.repo.findById(vehicleId)
    if (!vehicle) return { ok: false, error: 'Vehicle not found', status: 404 }

    if (!Number.isInteger(photoIdx) || photoIdx < 0 || photoIdx >= vehicle.photos.length) {
      return { ok: false, error: 'Photo index out of range', status: 400 }
    }

    const deletedUrl = vehicle.photos[photoIdx]!
    const photos = vehicle.photos.filter((_, i) => i !== photoIdx)

    const updated = await this.repo.update(
      vehicle.id,
      { photos },
      { expectedPhotos: vehicle.photos },
    )
    if (!updated) {
      return {
        ok: false,
        error: 'Vehicle photos changed concurrently; retry',
        status: 409,
      }
    }

    // Best-effort storage cleanup after DB update succeeds.
    try {
      await this.storage.delete(deletedUrl)
    } catch (e) {
      this.logger.warn('Photo storage cleanup failed, orphan left:', deletedUrl, e)
    }

    return { ok: true, deletedUrl, remaining: updated.photos.length }
  }

  private async cleanupStorage(urls: readonly string[]): Promise<void> {
    await Promise.all(
      urls.map((url) =>
        this.storage.delete(url).catch((e) => {
          this.logger.warn('Photo storage cleanup failed, orphan left:', url, e)
        }),
      ),
    )
  }
}
