import { persistSearchRange, readPersistedRange } from '@/vite/storefronts/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('search range session persistence', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it('round-trips a persisted range', () => {
    persistSearchRange('2026-07-01T10:00', '2026-07-03T10:00')
    expect(readPersistedRange()).toEqual({ from: '2026-07-01T10:00', to: '2026-07-03T10:00' })
  })

  it('returns null when nothing has been persisted', () => {
    expect(readPersistedRange()).toBeNull()
  })

  it('returns null when only one bound was persisted (never a half range)', () => {
    sessionStorage.setItem('kuruma.search.from', '2026-07-01T10:00')
    expect(readPersistedRange()).toBeNull()
  })

  it('overwrites a prior range with the latest one', () => {
    persistSearchRange('2026-07-01T10:00', '2026-07-03T10:00')
    persistSearchRange('2026-08-01T09:00', '2026-08-04T09:00')
    expect(readPersistedRange()).toEqual({ from: '2026-08-01T09:00', to: '2026-08-04T09:00' })
  })
})
