import type { PhotoStorage } from './types'

/**
 * Used in production when the R2 binding is absent (R2 not enabled on the
 * CF account). Rejects on every write so the upload route returns a loud
 * error instead of silently accepting into per-request InMemoryPhotoStorage —
 * which would "succeed" but return URLs pointing at nothing.
 */
export class DisabledPhotoStorage implements PhotoStorage {
  async put(): Promise<{ key: string; url: string }> {
    throw new Error('Vehicle photo storage is disabled: R2 binding missing in this environment.')
  }

  async delete(): Promise<void> {
    throw new Error('Vehicle photo storage is disabled: R2 binding missing in this environment.')
  }
}
