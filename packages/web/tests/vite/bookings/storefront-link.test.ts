import { buildStorefrontSearch } from '@/vite/bookings/storefront-link'
import { parseSearchRange } from '@/vite/storefronts/params'
import { describe, expect, it } from 'vitest'

describe('buildStorefrontSearch', () => {
  it('converts the booking ISO instants to wall-clock JST datetime-local strings', () => {
    // 00:00Z -> 09:00 JST; 01:30Z -> 10:30 JST (Tokyo is UTC+9, no DST).
    const search = buildStorefrontSearch({
      startAt: '2026-07-01T00:00:00.000Z',
      endAt: '2026-07-03T01:30:00.000Z',
    })
    expect(search).toEqual({ from: '2026-07-01T09:00', to: '2026-07-03T10:30' })
  })

  it('produces a range the storefront route parser accepts (no redirect to /search)', () => {
    const search = buildStorefrontSearch({
      startAt: '2026-07-01T00:00:00.000Z',
      endAt: '2026-07-03T01:30:00.000Z',
    })
    const range = parseSearchRange(search.from, search.to)
    // Non-null is the contract that keeps the storefront loader from redirecting.
    expect(range).not.toBeNull()
    expect(range?.from.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(range?.to.toISOString()).toBe('2026-07-03T01:30:00.000Z')
  })
})
