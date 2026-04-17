import { detectImageType } from '../lib/image-signature'
import type { PhotoStorage, VehicleRepository } from '../repositories/types'

const MAX_PHOTOS_PER_VEHICLE = 10
const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

export type UploadResult =
  | { ok: true; uploaded: string[]; total: number }
  | { ok: false; error: string; status: 400 | 404 | 500 }

export type DeleteResult =
  | { ok: true; deletedUrl: string; remaining: number }
  | { ok: false; error: string; status: 400 | 404 }

export interface PhotoServiceLogger {
  warn(message: string, ...args: unknown[]): void
}

async function validateFile(file: File): Promise<{ ok: File } | { err: string }> {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { err: 'Only image files are allowed (JPEG, PNG, WebP, AVIF)' }
  }
  if (file.size > MAX_FILE_SIZE) return { err: 'File must be under 5MB' }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const detected = detectImageType(bytes)
  if (detected === null) {
    return { err: 'File content does not match an allowed image format' }
  }
  if (detected !== file.type) {
    return { err: 'File content does not match declared Content-Type' }
  }
  return { ok: file }
}

export class VehiclePhotoService {
  constructor(
    private readonly repo: VehicleRepository,
    private readonly storage: PhotoStorage,
    private readonly logger: PhotoServiceLogger = console,
  ) {}

  async upload(vehicleId: string, files: readonly File[]): Promise<UploadResult> {
    if (files.length === 0) return { ok: false, error: 'No file provided', status: 400 }
    if (files.length > MAX_PHOTOS_PER_VEHICLE) {
      return {
        ok: false,
        error: `Maximum ${MAX_PHOTOS_PER_VEHICLE} photos per vehicle`,
        status: 400,
      }
    }

    // Byte-level signature validation before hitting storage so we never persist a spoofed file.
    for (const file of files) {
      const result = await validateFile(file)
      if ('err' in result) return { ok: false, error: result.err, status: 400 }
    }

    const uploadResults = await Promise.allSettled(files.map((f) => this.storage.put(vehicleId, f)))
    const succeeded = uploadResults.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const anyFailed = uploadResults.some((r) => r.status === 'rejected')

    if (anyFailed) {
      await this.cleanupStorage(succeeded.map((r) => r.url))
      return { ok: false, error: 'One or more uploads failed', status: 500 }
    }

    const urls = succeeded.map((r) => r.url)
    const appendResult = await this.repo.appendPhotos(vehicleId, urls, MAX_PHOTOS_PER_VEHICLE)

    if (appendResult.outcome === 'not_found') {
      await this.cleanupStorage(urls)
      return { ok: false, error: 'Vehicle not found', status: 404 }
    }
    if (appendResult.outcome === 'cap_exceeded') {
      await this.cleanupStorage(urls)
      return {
        ok: false,
        error: `Maximum ${MAX_PHOTOS_PER_VEHICLE} photos per vehicle`,
        status: 400,
      }
    }

    return { ok: true, uploaded: urls, total: appendResult.vehicle.photos.length }
  }

  async deleteByUrl(vehicleId: string, url: string): Promise<DeleteResult> {
    if (!url) return { ok: false, error: 'url query parameter required', status: 400 }

    const updated = await this.repo.removePhotoByUrl(vehicleId, url)
    if (!updated) {
      // Either the vehicle does not exist or the URL is not one of its photos.
      // Treat both as 404 so we do not leak existence info.
      return { ok: false, error: 'Photo not found', status: 404 }
    }

    // Best-effort storage cleanup after the authoritative DB write succeeds.
    try {
      await this.storage.delete(url)
    } catch (e) {
      this.logger.warn('Photo storage cleanup failed, orphan left:', url, e)
    }

    return { ok: true, deletedUrl: url, remaining: updated.photos.length }
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
