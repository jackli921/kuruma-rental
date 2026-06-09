import type { DocumentStorage } from '../types'

const BASE_URL = 'https://test-documents.example.com'

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Test/local double for private renter-document storage. NEVER used in prod. */
export class InMemoryDocumentStorage implements DocumentStorage {
  private readonly store = new Map<string, ArrayBuffer>()

  async put(renterId: string, file: File): Promise<{ key: string }> {
    const ext = EXT_BY_MIME[file.type] ?? 'bin'
    const key = `renter-documents/${renterId}/${crypto.randomUUID()}.${ext}`
    this.store.set(key, await file.arrayBuffer())
    return { key }
  }

  async getSignedUrl(key: string): Promise<string> {
    return `${BASE_URL}/${key}?signed=test`
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  has(key: string): boolean {
    return this.store.has(key)
  }
}
