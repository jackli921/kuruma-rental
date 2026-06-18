import type { R2BucketLike } from './r2-photo-storage'
import type { DocumentStorage } from './types'

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Private R2 storage for renter document scans (#459). Unlike vehicle photos,
 * the bucket is PRIVATE — there is no public base URL. Verifiers view a scan
 * through a short-lived signed URL.
 *
 * NOTE (#304): `getSignedUrl` is intentionally unimplemented. R2 presigned URLs
 * use S3-style SigV4 signing with R2 API credentials (access key + secret),
 * served from the R2 S3 API domain — NOT the Workers bucket binding and not a
 * custom domain. Those credentials are not provisioned until the CF account
 * migration (#304) lands. Wiring them is a follow-up; until then the adapter
 * stores/deletes via the binding and signing throws loudly.
 */
export class R2DocumentStorage implements DocumentStorage {
  constructor(private readonly bucket: R2BucketLike) {}

  async put(renterId: string, file: File): Promise<{ key: string }> {
    if (!/^[\w-]+$/.test(renterId)) {
      throw new Error('Invalid renter ID format')
    }
    const ext = EXT_BY_MIME[file.type] ?? 'bin'
    const key = `renter-documents/${renterId}/${crypto.randomUUID()}.${ext}`
    await this.bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type } })
    return { key }
  }

  async getSignedUrl(_key: string): Promise<string> {
    throw new Error(
      'R2 presigned URLs require S3 SigV4 credentials (blocked on #304). Not yet provisioned.',
    )
  }

  async getFile(key: string): Promise<{ body: ReadableStream; contentType: string } | null> {
    const obj = await this.bucket.get(key)
    if (!obj) return null
    return {
      body: obj.body,
      contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream',
    }
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key)
  }
}
