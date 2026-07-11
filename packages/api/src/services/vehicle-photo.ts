import type { ErrorCode } from '@kuruma/shared/lib/error-codes'
import { detectImageType } from '../lib/image-signature'
import type { CallerContext } from '../middleware/auth'
import type { PhotoStorage, VehicleRepository } from '../repositories/types'
import { assertFleetWriteWithinOperator, fleetWriteDenialResult } from '../tenancy'

export const MAX_PHOTOS_PER_VEHICLE = 10
export const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

export type UploadResult =
  | { ok: true; uploaded: string[]; total: number }
  | { ok: false; error: string; status: number; code?: ErrorCode }

export type DeleteResult =
  | { ok: true; remaining: number }
  | { ok: false; error: string; status: number; code?: ErrorCode }

type ValidatedFile = { file: File; bytes: Uint8Array }

export class VehiclePhotoService {
  constructor(
    private readonly repo: VehicleRepository,
    private readonly storage: PhotoStorage,
  ) {}

  async uploadPhotos(
    ctx: CallerContext,
    vehicleId: string,
    files: File[],
    actingOperatorId?: string,
  ): Promise<UploadResult> {
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

    // #1260/#1406: the FLEET_WRITE_ROLES gate admits all-scope platform admins AND
    // tenant operators. An all-scope caller reads every operator's vehicles and
    // findById hands it any of them by raw id, so bind this write to the operator it
    // picked; an operator caller is already clamped to its own tenant by the scoped
    // findById and the guard no-ops for it. Placed after byte validation but before
    // any R2 put, so a denied cross-tenant request never persists an object (mirrors
    // MaintenanceService.toggleStatus).
    const existing = await this.repo.findById(ctx, vehicleId)
    if (!existing) return { ok: false, status: 404, error: 'Vehicle not found' }
    const denial = assertFleetWriteWithinOperator(ctx, existing.operatorId, actingOperatorId)
    if (denial) return fleetWriteDenialResult(denial, 'Vehicle not found')

    // Upload in parallel. Track successes so we can roll back if any put
    // rejects mid-batch or the DB append fails.
    const uploadResults = await Promise.allSettled(
      validated.map(({ file }) => this.storage.put(vehicleId, file)),
    )

    const succeeded = uploadResults.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const anyFailed = uploadResults.some((r) => r.status === 'rejected')

    if (anyFailed) {
      await this.rollback(
        vehicleId,
        succeeded.map((r) => r.url),
      )
      return { ok: false, status: 500, error: 'One or more uploads failed' }
    }

    const appendResult = await this.repo.appendPhotos(
      ctx,
      vehicleId,
      succeeded.map((r) => r.url),
      MAX_PHOTOS_PER_VEHICLE,
    )

    if (appendResult.outcome === 'not_found') {
      await this.rollback(
        vehicleId,
        succeeded.map((r) => r.url),
      )
      return { ok: false, status: 404, error: 'Vehicle not found' }
    }
    if (appendResult.outcome === 'cap_exceeded') {
      await this.rollback(
        vehicleId,
        succeeded.map((r) => r.url),
      )
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

  async deletePhoto(
    ctx: CallerContext,
    vehicleId: string,
    url: string,
    actingOperatorId?: string,
  ): Promise<DeleteResult> {
    // #1260/#1406: same acting-operator binding as uploadPhotos. The
    // FLEET_WRITE_ROLES gate admits operators (clamped to their own tenant by the
    // scoped findById + removePhotoByUrl) AND all-scope platform admins. Without
    // this bind an all-scope caller could delete ANY operator's photo by raw id +
    // url, so it must name the target operator first; the guard no-ops for operator
    // callers. Denial uses the caller's own "Photo not found" so there is no
    // cross-tenant existence oracle.
    const existing = await this.repo.findById(ctx, vehicleId)
    if (!existing) return { ok: false, status: 404, error: 'Photo not found' }
    const denial = assertFleetWriteWithinOperator(ctx, existing.operatorId, actingOperatorId)
    if (denial) return fleetWriteDenialResult(denial, 'Photo not found')

    const updated = await this.repo.removePhotoByUrl(ctx, vehicleId, url)
    if (!updated) {
      // Either the vehicle does not exist or the URL is not one of its photos.
      // Treat both as 404 so we do not leak existence info.
      return { ok: false, status: 404, error: 'Photo not found' }
    }

    // Best-effort R2 cleanup after the authoritative DB write succeeds. Scoped
    // to this vehicle's key prefix so a cross-referenced URL cannot delete
    // another vehicle's object (#952).
    try {
      await this.storage.delete(url, vehicleId)
    } catch (e) {
      console.warn('R2 photo cleanup failed, orphan left:', url, e)
    }

    return { ok: true, remaining: updated.photos.length }
  }

  private async rollback(vehicleId: string, urls: string[]): Promise<void> {
    await Promise.all(urls.map((url) => this.storage.delete(url, vehicleId).catch(() => {})))
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
