import { describe, expect, it } from 'vitest'
import { requestFingerprint } from './request-fingerprint'

describe('requestFingerprint (§6 replay binding)', () => {
  it('is stable across key order', async () => {
    const a = await requestFingerprint({ locationId: 'L1', fuelPercent: 80 })
    const b = await requestFingerprint({ fuelPercent: 80, locationId: 'L1' })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
  it('differs when any field differs', async () => {
    const a = await requestFingerprint({ locationId: 'L1', photoHashes: ['aa'] })
    const b = await requestFingerprint({ locationId: 'L1', photoHashes: ['bb'] })
    expect(a).not.toBe(b)
  })
  it('treats null and absent as distinct', async () => {
    const a = await requestFingerprint({ locationId: 'L1', notes: null })
    const b = await requestFingerprint({ locationId: 'L1' })
    expect(a).not.toBe(b)
  })
})
