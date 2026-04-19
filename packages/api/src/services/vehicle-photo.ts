import { detectImageType } from '../lib/image-signature'
import type { CallerContext } from '../middleware/auth'
import type { PhotoStorage, VehicleRepository } from '../repositories/types'

const MAX_PHOTOS_PER_VEHICLE = 10
const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

export type UploadResult =
  | { ok: true; uploaded: string[]; total: number }
  | { ok: false; error: string; status: number }

export type DeleteResult =
  | { ok: true; remaining: number }
  | { ok: false; error: string; status: number }

type ValidatedFile = { file: File; bytes: Uint8Array }

export class VehiclePhotoService {
  constructor(
    private readonly repo: VehicleRepository,
    private readonly storage: PhotoStorage,
  ) {}

  async uploadPhotos(ctx: CallerContext, vehicleId: string, files: File[]): Promise<UploadResult> {
    if (files.length === 0) return { ok: false, status: 400, error: 'No file provided' }
    if (files.length > MAX_PHOTOS_PER_VEHICLE) {
      return {
        ok: false,
        status: 400,
        error: `Maximum ${MAX_PHOTOS_PER_VEHICLE} photos per vehicle`,
      }
    }

    // Validate bytes before hitting storage so we never persist a spoofed file.
    const validated: ValidatedFile[] = []
    for (const file of files) {
      const result = await validateFile(file)
      if ('err' in result) return { ok: false, status: result.status, error: result.err }
      validated.push(result.ok)
    }

    // Upload in parallel. Track successes so we can roll back if any put
    // rejects mid-batch or the DB append fails.
    const uploadResults = await Promise.allSettled(
      validated.map(({ file }) => this.storage.put(vehicleId, file)),
    )

    const succeeded = uploadResults.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const anyFailed = uploadResults.some((r) => r.status === 'rejected')

    if (anyFailed) {
      await this.rollback(succeeded.map((r) => r.url))
      return { ok: false, status: 500, error: 'One or more uploads failed' }
    }

    const appendResult = await this.repo.appendPhotos(
      ctx,
      vehicleId,
      succeeded.map((r) => r.url),
      MAX_PHOTOS_PER_VEHICLE,
    )

    if (appendResult.outcome === 'not_found') {
      await this.rollback(succeeded.map((r) => r.url))
      return { ok: false, status: 404, error: 'Vehicle not found' }
    }
    if (appendResult.outcome === 'cap_exceeded') {
      await this.rollback(succeeded.map((r) => r.url))
      return {
        ok: false,
        status: 400,
        error: `Maximum ${MAX_PHOTOS_PER_VEHICLE} photos per vehicle`,
      }
    }

    return {
      ok: true,
      uploaded: succeeded.map((r) => r.url),
      total: appendResult.vehicle.photos.length,
    }
  }

  async deletePhoto(ctx: CallerContext, vehicleId: string, url: string): Promise<DeleteResult> {
    const updated = await this.repo.removePhotoByUrl(ctx, vehicleId, url)
    if (!updated) {
      // Either the vehicle does not exist or the URL is not one of its photos.
      // Treat both as 404 so we do not leak existence info.
      return { ok: false, status: 404, error: 'Photo not found' }
    }

    // Best-effort R2 cleanup after the authoritative DB write succeeds.
    try {
      await this.storage.delete(url)
    } catch (e) {
      console.warn('R2 photo cleanup failed, orphan left:', url, e)
    }

    return { ok: true, remaining: updated.photos.length }
  }

  private async rollback(urls: string[]): Promise<void> {
    await Promise.all(urls.map((url) => this.storage.delete(url).catch(() => {})))
  }
}

async function validateFile(
  file: File,
): Promise<{ ok: ValidatedFile } | { err: string; status: number }> {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return {
      err: 'Only image files are allowed (JPEG, PNG, WebP, AVIF)',
      status: 400,
    }
  }
  if (file.size > MAX_FILE_SIZE) {
    return { err: 'File must be under 5MB', status: 400 }
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const detected = detectImageType(bytes)
  if (detected === null) {
    return { err: 'File content does not match an allowed image format', status: 415 }
  }
  if (detected !== file.type) {
    return { err: 'File content does not match declared Content-Type', status: 415 }
  }
  return { ok: { file, bytes } }
}
