import { describe, expect, it } from 'vitest'
import { InMemoryPhotoStorage } from '../../src/repositories/in-memory/photo-storage'

describe('InMemoryPhotoStorage', () => {
  function makeFile(name: string, type: string, sizeBytes: number): File {
    const buffer = new ArrayBuffer(sizeBytes)
    return new File([buffer], name, { type })
  }

  it('put() stores a file and returns key + url', async () => {
    const storage = new InMemoryPhotoStorage()
    const file = makeFile('car.jpg', 'image/jpeg', 1024)

    const result = await storage.put('vehicle-1', file)

    expect(result.key).toMatch(/^vehicles\/vehicle-1\/[a-z0-9-]+\.jpg$/)
    expect(result.url).toContain(result.key)
  })

  it('put() generates unique keys for each upload', async () => {
    const storage = new InMemoryPhotoStorage()
    const file1 = makeFile('a.png', 'image/png', 512)
    const file2 = makeFile('b.png', 'image/png', 512)

    const r1 = await storage.put('v1', file1)
    const r2 = await storage.put('v1', file2)

    expect(r1.key).not.toBe(r2.key)
  })

  it('delete() removes a stored file by key', async () => {
    const storage = new InMemoryPhotoStorage()
    const file = makeFile('car.jpg', 'image/jpeg', 1024)
    const { key } = await storage.put('v1', file)

    await storage.delete(key)

    expect(storage.has(key)).toBe(false)
  })

  it('delete() removes a stored file by URL', async () => {
    const storage = new InMemoryPhotoStorage()
    const file = makeFile('car.jpg', 'image/jpeg', 1024)
    const { key, url } = await storage.put('v1', file)

    await storage.delete(url)

    expect(storage.has(key)).toBe(false)
  })

  it('delete() is idempotent for missing keys', async () => {
    const storage = new InMemoryPhotoStorage()
    await expect(storage.delete('nonexistent')).resolves.toBeUndefined()
  })
})
