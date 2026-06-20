import type { PhotoStorage } from '../types'

const BASE_URL = 'https://test-photos.example.com'

export class InMemoryPhotoStorage implements PhotoStorage {
  private readonly store = new Map<string, ArrayBuffer>()

  async put(vehicleId: string, file: File): Promise<{ key: string; url: string }> {
    const ext = file.name.split('.').pop() ?? file.type.split('/').pop() ?? 'bin'
    const id = crypto.randomUUID()
    const key = `vehicles/${vehicleId}/${id}.${ext}`

    const buffer = await file.arrayBuffer()
    this.store.set(key, buffer)

    return { key, url: `${BASE_URL}/${key}` }
  }

  async delete(keyOrUrl: string, ownerVehicleId: string): Promise<void> {
    const key = keyOrUrl.startsWith(BASE_URL) ? keyOrUrl.slice(BASE_URL.length + 1) : keyOrUrl
    // Mirror R2PhotoStorage's ownership guard so dev/test behave like prod (#952).
    if (!key.startsWith(`vehicles/${ownerVehicleId}/`)) return
    this.store.delete(key)
  }

  has(key: string): boolean {
    return this.store.has(key)
  }

  /** Test helper — count stored objects to verify rollback on failed uploads. */
  size(): number {
    return this.store.size
  }
}
