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

  async delete(keyOrUrl: string): Promise<void> {
    await this.bucket.delete(toObjectKey(keyOrUrl, this.publicBaseUrl))
  }
}
