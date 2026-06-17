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

/**
 * Recover the object key from either a bare key or one of our public URLs.
 *
 * Exact origin + base-path matching via URL parsing — NOT a loose string
 * prefix. A raw `startsWith(publicBaseUrl)` mis-handled a base with a trailing
 * slash (sliced one character into the key) and a look-alike host
 * (`https://cdn.example.com.evil/...` satisfies `startsWith` and got
 * mis-sliced). Anything that isn't one of our public URLs — a bare key, an
 * external URL, a different origin — is returned untouched and treated as a key
 * (a no-op delete in R2). See #678 review.
 */
export function toObjectKey(keyOrUrl: string, publicBaseUrl: string): string {
  let target: URL
  try {
    target = new URL(keyOrUrl)
  } catch {
    return keyOrUrl // relative value — already a key
  }
  let base: URL
  try {
    base = new URL(publicBaseUrl)
  } catch {
    return keyOrUrl // base not a URL (e.g. empty in dev) — can't be our URL
  }
  if (target.origin !== base.origin) return keyOrUrl
  const basePath = base.pathname.replace(/\/+$/, '') // '' or '/sub'
  const prefix = `${basePath}/`
  if (!target.pathname.startsWith(prefix)) return keyOrUrl
  return target.pathname.slice(prefix.length)
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
