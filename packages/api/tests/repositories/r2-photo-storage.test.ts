import { describe, expect, it } from 'vitest'
import { type R2BucketLike, R2PhotoStorage } from '../../src/repositories/r2-photo-storage'

const BASE = 'https://cdn.example.com'

function fakeBucket() {
  const deleted: string[] = []
  const bucket: R2BucketLike = {
    async put() {
      return undefined
    },
    async delete(key) {
      deleted.push(Array.isArray(key) ? key.join(',') : key)
    },
  }
  return { bucket, deleted }
}

describe('R2PhotoStorage.put', () => {
  it('returns the object key and the derived public URL', async () => {
    const { bucket } = fakeBucket()
    const file = new File([new ArrayBuffer(8)], 'car.jpg', { type: 'image/jpeg' })

    const { key, url } = await new R2PhotoStorage(bucket, BASE).put('veh-1', file)

    expect(key).toMatch(/^vehicles\/veh-1\/[0-9a-f-]+\.jpg$/)
    expect(url).toBe(`${BASE}/${key}`)
  })
})

describe('R2PhotoStorage.delete — key recovery', () => {
  it('deletes a bare key unchanged', async () => {
    const { bucket, deleted } = fakeBucket()
    await new R2PhotoStorage(bucket, BASE).delete('vehicles/veh-1/abc.jpg')
    expect(deleted).toEqual(['vehicles/veh-1/abc.jpg'])
  })

  it('strips the public base URL to recover the key', async () => {
    const { bucket, deleted } = fakeBucket()
    await new R2PhotoStorage(bucket, BASE).delete(`${BASE}/vehicles/veh-1/abc.jpg`)
    expect(deleted).toEqual(['vehicles/veh-1/abc.jpg'])
  })

  it('recovers the key when the configured base has a trailing slash', async () => {
    const { bucket, deleted } = fakeBucket()
    await new R2PhotoStorage(bucket, `${BASE}/`).delete(`${BASE}/vehicles/veh-1/abc.jpg`)
    expect(deleted).toEqual(['vehicles/veh-1/abc.jpg'])
  })

  it('does not mis-slice a look-alike host (prefix collision)', async () => {
    const { bucket, deleted } = fakeBucket()
    const lookAlike = 'https://cdn.example.com.evil/vehicles/veh-1/abc.jpg'
    await new R2PhotoStorage(bucket, BASE).delete(lookAlike)
    // Not our object — passed through untouched, never mis-parsed into a key.
    expect(deleted).toEqual([lookAlike])
  })

  it('passes a different-origin (external) URL through untouched', async () => {
    const { bucket, deleted } = fakeBucket()
    const external = 'https://images.unsplash.com/photo-123.jpg'
    await new R2PhotoStorage(bucket, BASE).delete(external)
    expect(deleted).toEqual([external])
  })

  it('strips a base that includes a path segment', async () => {
    const { bucket, deleted } = fakeBucket()
    await new R2PhotoStorage(bucket, `${BASE}/photos`).delete(
      `${BASE}/photos/vehicles/veh-1/abc.jpg`,
    )
    expect(deleted).toEqual(['vehicles/veh-1/abc.jpg'])
  })
})
