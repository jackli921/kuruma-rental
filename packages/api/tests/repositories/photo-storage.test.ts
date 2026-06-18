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

    await storage.delete(key, 'v1')

    expect(storage.has(key)).toBe(false)
  })

  it('delete() removes a stored file by URL', async () => {
    const storage = new InMemoryPhotoStorage()
    const file = makeFile('car.jpg', 'image/jpeg', 1024)
    const { key, url } = await storage.put('v1', file)

    await storage.delete(url, 'v1')

    expect(storage.has(key)).toBe(false)
  })

  it('delete() is idempotent for missing keys', async () => {
    const storage = new InMemoryPhotoStorage()
    await expect(storage.delete('vehicles/v1/missing.jpg', 'v1')).resolves.toBeUndefined()
  })

  it('delete() does not remove an object owned by a different vehicle', async () => {
    const storage = new InMemoryPhotoStorage()
    const { key } = await storage.put('victim', makeFile('v.jpg', 'image/jpeg', 1024))

    // A delete scoped to a different vehicle must not reach victim's object.
    await storage.delete(key, 'attacker')

    expect(storage.has(key)).toBe(true)
  })
})
