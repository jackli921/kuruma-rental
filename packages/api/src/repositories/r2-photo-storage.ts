import { toObjectKey } from '@kuruma/shared/lib/photo-ref'
import type { PhotoStorage } from './types'

/** Minimal R2Bucket shape so this file compiles without global workers-types. */
export interface R2BucketLike {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  delete(key: string | string[]): Promise<void>
}

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

export class R2PhotoStorage implements PhotoStorage {
  constructor(
    private readonly bucket: R2BucketLike,
    private readonly publicBaseUrl: string,
  ) {}

  async put(vehicleId: string, file: File): Promise<{ key: string; url: string }> {
    if (!/^[\w-]+$/.test(vehicleId)) {
      throw new Error('Invalid vehicle ID format')
    }
    const ext = EXT_MAP[file.type] ?? 'bin'
    const id = crypto.randomUUID()
    const key = `vehicles/${vehicleId}/${id}.${ext}`

    await this.bucket.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    })

    return { key, url: `${this.publicBaseUrl}/${key}` }
  }

  async delete(keyOrUrl: string, ownerVehicleId: string): Promise<void> {
    const key = toObjectKey(keyOrUrl, this.publicBaseUrl)
    // A photo on vehicle X is always stored under `vehicles/X/` (see put), so a
    // key outside the owner's prefix is not this vehicle's to delete. Refuse it
    // fail-closed — this is what stops a cross-referenced URL from reaching
    // another tenant's object (#952).
    if (!key.startsWith(`vehicles/${ownerVehicleId}/`)) return
    await this.bucket.delete(key)
  }
}
