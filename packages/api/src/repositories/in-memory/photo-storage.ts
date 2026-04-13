import type { PhotoStorage } from '../types'

const MAX_FILE_SIZE = 5 * 1024 * 1024

export class InMemoryPhotoStorage implements PhotoStorage {
  private readonly store = new Map<string, ArrayBuffer>()

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

    const buffer = await file.arrayBuffer()
    this.store.set(key, buffer)

    return { key, url: `https://test-photos.example.com/${key}` }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  has(key: string): boolean {
    return this.store.has(key)
  }
}
