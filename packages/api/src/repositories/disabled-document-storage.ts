import type { DocumentStorage } from './types'

const MESSAGE = 'Renter document storage is disabled: R2 binding missing in this environment.'

/**
 * Used in the Drizzle (production) branch when the R2 binding is absent (R2 is
 * not enabled on the current CF account — blocked on #304). Rejects loudly on
 * every operation rather than silently accepting into a per-request in-memory
 * store, which would "succeed" but point at nothing. Mirrors DisabledPhotoStorage.
 */
export class DisabledDocumentStorage implements DocumentStorage {
  async put(): Promise<{ key: string }> {
    throw new Error(MESSAGE)
  }

  async getSignedUrl(): Promise<string> {
    throw new Error(MESSAGE)
  }

  async getFile(): Promise<{ body: ReadableStream; contentType: string } | null> {
    throw new Error(MESSAGE)
  }

  async delete(): Promise<void> {
    throw new Error(MESSAGE)
  }
}
