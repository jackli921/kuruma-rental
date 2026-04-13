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

  it('put() rejects non-image MIME types', async () => {
    const storage = new InMemoryPhotoStorage()
    const file = makeFile('doc.pdf', 'application/pdf', 1024)

    await expect(storage.put('v1', file)).rejects.toThrow('Only image files are allowed')
  })

  it('put() rejects files larger than 5MB', async () => {
    const storage = new InMemoryPhotoStorage()
    const file = makeFile('huge.jpg', 'image/jpeg', 6 * 1024 * 1024)

    await expect(storage.put('v1', file)).rejects.toThrow('File must be under 5MB')
  })

  it('put() accepts exactly 5MB', async () => {
    const storage = new InMemoryPhotoStorage()
    const file = makeFile('max.jpg', 'image/jpeg', 5 * 1024 * 1024)

    const result = await storage.put('v1', file)
    expect(result.key).toMatch(/\.jpg$/)
  })

  it('delete() removes a stored file', async () => {
    const storage = new InMemoryPhotoStorage()
    const file = makeFile('car.jpg', 'image/jpeg', 1024)
    const { key } = await storage.put('v1', file)

    await storage.delete(key)

    expect(storage.has(key)).toBe(false)
  })

  it('delete() is idempotent for missing keys', async () => {
    const storage = new InMemoryPhotoStorage()
    await expect(storage.delete('nonexistent')).resolves.toBeUndefined()
  })

  it('extracts correct extension from filename', async () => {
    const storage = new InMemoryPhotoStorage()

    const jpg = await storage.put('v1', makeFile('photo.jpeg', 'image/jpeg', 100))
    expect(jpg.key).toMatch(/\.jpeg$/)

    const png = await storage.put('v1', makeFile('photo.png', 'image/png', 100))
    expect(png.key).toMatch(/\.png$/)

    const webp = await storage.put('v1', makeFile('photo.webp', 'image/webp', 100))
    expect(webp.key).toMatch(/\.webp$/)
  })
})
