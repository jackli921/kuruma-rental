import { afterEach, describe, expect, it } from 'vitest'
import {
  persistSearchRange,
  persistSearchRegion,
  readPersistedRange,
  readPersistedRegion,
} from './storage'

afterEach(() => sessionStorage.clear())

describe('search range persistence', () => {
  it('round-trips a persisted range', () => {
    persistSearchRange('2026-07-01T10:00', '2026-07-04T10:00')
    expect(readPersistedRange()).toEqual({ from: '2026-07-01T10:00', to: '2026-07-04T10:00' })
  })

  it('returns null when no range is stored', () => {
    expect(readPersistedRange()).toBeNull()
  })
})

describe('search region persistence', () => {
  it('round-trips a persisted region slug', () => {
    persistSearchRegion('namba')
    expect(readPersistedRegion()).toBe('namba')
  })

  it('returns null when no region is stored', () => {
    expect(readPersistedRegion()).toBeNull()
  })

  it('clears the stored region when persisting the "Anywhere" (null) choice', () => {
    persistSearchRegion('namba')
    persistSearchRegion(null)
    expect(readPersistedRegion()).toBeNull()
  })
})
