import { describe, expect, it } from 'vitest'
import { DisabledPhotoStorage } from '../../src/repositories/disabled-photo-storage'

describe('DisabledPhotoStorage', () => {
  it('put rejects with a clear message identifying R2 as unavailable', async () => {
    const storage = new DisabledPhotoStorage()
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' })
    await expect(storage.put('veh_1', file)).rejects.toThrow(/vehicle photo storage is disabled/i)
  })

  it('delete rejects with the same message', async () => {
    const storage = new DisabledPhotoStorage()
    await expect(storage.delete('some-key')).rejects.toThrow(/vehicle photo storage is disabled/i)
  })
})
