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

const MAX_FILE_SIZE = 5 * 1024 * 1024

export class R2PhotoStorage implements PhotoStorage {
  constructor(
    private readonly bucket: R2BucketLike,
    private readonly publicBaseUrl: string,
  ) {}

  async put(vehicleId: string, file: File): Promise<{ key: string; url: string }> {
    if (!file.type.startsWith('image/')) {
      throw new Error('Only image files are allowed')
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('File must be under 5MB')
    }

    const ext = file.name.split('.').pop() ?? 'bin'
    const id = crypto.randomUUID()
    const key = `vehicles/${vehicleId}/${id}.${ext}`

    await this.bucket.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    })

    const url = `${this.publicBaseUrl}/${key}`
    return { key, url }
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key)
  }
}
